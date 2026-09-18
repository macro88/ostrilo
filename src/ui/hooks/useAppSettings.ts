import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  getSettings as rpcGetSettings,
  updateSettings as rpcUpdateSettings,
  subscribeSettingsChanged,
  policySetOrigin,
  policySetKindRule,
  policyClearSession,
  policyRemoveOrigin,
  activityClear,
} from "@/infrastructure/messaging/client";
import {
  AppSettingsV1,
  DEFAULT_SETTINGS_V1,
  Theme,
  TrustLevel,
  OriginPolicy,
} from "@/domain/types";
import { getEffectiveMediumAllowKinds } from "@/domain/policy/trust-definitions";
import type { AppSettingsPatch } from "@/infrastructure/validation/schemas";

// Global settings store to prevent multiple fetches
class SettingsStore {
  private settings: AppSettingsV1 | null = null;
  private isLoading = false;
  private isInitialized = false;
  private listeners = new Set<() => void>();

  subscribe = (callback: () => void) => {
    this.listeners.add(callback);

    // Start initial load if not done
    if (!this.isInitialized && !this.isLoading) {
      this.loadSettings();
    }

    return () => {
      this.listeners.delete(callback);
    };
  };

  getSnapshot = () => {
    if (!this.isInitialized && !this.isLoading) {
      this.loadSettings();
    }
    return this.settings;
  };

  private async loadSettings() {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const settings = await rpcGetSettings();
      this.settings = settings ?? DEFAULT_SETTINGS_V1;
      this.isInitialized = true;
      this.notifyListeners();
    } catch (error) {
      console.error("Failed to load settings:", error);
      this.settings = DEFAULT_SETTINGS_V1;
      this.isInitialized = true;
      this.notifyListeners();
    } finally {
      this.isLoading = false;
    }
  }

  private notifyListeners() {
    this.listeners.forEach((callback) => callback());
  }

  // Called when settings change externally
  onSettingsChanged = () => {
    if (this.isInitialized) {
      this.loadSettings();
    }
  };
}

const settingsStore = new SettingsStore();

// Set up external change listener
let subscriptionSetup = false;
const setupSubscription = () => {
  if (!subscriptionSetup) {
    subscribeSettingsChanged(settingsStore.onSettingsChanged);
    subscriptionSetup = true;
  }
};

export function useAppSettings() {
  setupSubscription();

  const rawSettings = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    () => null // Server snapshot for SSR
  );

  // Merge defaults with stored to ensure new fields exist (simple migration)
  const settings = useMemo<AppSettingsV1>(
    () => ({ ...DEFAULT_SETTINGS_V1, ...rawSettings }),
    [rawSettings]
  );

  const isLoading = rawSettings === null;

  // Save settings to storage
  const updateSettings = useCallback(
    async (updates: Partial<AppSettingsV1>, password?: string) => {
      await rpcUpdateSettings(updates, password);
    },
    []
  );

  // Individual setting updaters for convenience
  const updateTheme = useCallback(
    (theme: Theme) => {
      return updateSettings({ theme });
    },
    [updateSettings]
  );

  const updateSidePanel = useCallback(
    (sidePanel: boolean) => {
      return updateSettings({ sidePanel });
    },
    [updateSettings]
  );

  // Password-gated in the background: lengthening the timeout buys the next
  // person at the keyboard time, so it is not a setting an unattended
  // session can change.
  const updateAutoLockMinutes = useCallback(
    (autoLockMinutes: number, password?: string) => {
      return updateSettings({ autoLockMinutes }, password);
    },
    [updateSettings]
  );

  const updateMaxActivityEntries = useCallback(
    (maxActivityEntries: number) => {
      return updateSettings({ maxActivityEntries });
    },
    [updateSettings]
  );

  const updateRelays = useCallback(
    (relays: string[]) => {
      return updateSettings({ relays });
    },
    [updateSettings]
  );

  const addRelay = useCallback(
    (relay: string) => {
      if (!settings.relays.includes(relay)) {
        return updateSettings({ relays: [...settings.relays, relay] });
      }
    },
    [settings.relays, updateSettings]
  );

  const removeRelay = useCallback(
    (relay: string) => {
      return updateSettings({
        relays: settings.relays.filter((r) => r !== relay),
      });
    },
    [settings.relays, updateSettings]
  );

  const updateMediumAllowKinds = useCallback(
    (mediumAllowKinds: number[]) => {
      return updateSettings({
        mediumAllowKinds: getEffectiveMediumAllowKinds(mediumAllowKinds),
      });
    },
    [updateSettings]
  );

  const updateSessionTTLMinutes = useCallback(
    (sessionTTLMinutes: number, password?: string) => {
      return updateSettings({ sessionTTLMinutes }, password);
    },
    [updateSettings]
  );

  // Origin policy management
  const updateOriginPolicy = useCallback(
    (origin: string, policy: Partial<OriginPolicy>, password?: string) => {
      // Delegate mutations to background PolicyService. A password is
      // required there only when the patch raises trust to `high`.
      return policySetOrigin(origin, policy, password);
    },
    []
  );

  const removeOriginPolicy = useCallback((origin: string) => {
    return policyRemoveOrigin(origin);
  }, []);

  const updateOriginTrustLevel = useCallback(
    (origin: string, trustLevel: TrustLevel, password?: string) => {
      return updateOriginPolicy(origin, { trustLevel }, password);
    },
    [updateOriginPolicy]
  );

  /**
   * Revokes a recorded identity-disclosure decision.
   *
   * Not password-gated. Revoking only ever ADDS friction - the origin goes back
   * to being asked - and a user withdrawing access should not have to find
   * their password first, the same reasoning that leaves lowering trust and
   * turning off a session grant free.
   */
  const revokeIdentityDisclosure = useCallback(
    (origin: string) => {
      // `"ask"`, NOT `undefined`. Zod strips an explicitly-undefined optional
      // key, so the patch would reach the background as `{}` and the stored
      // decision would survive untouched - a Revoke button that looks like it
      // worked and did nothing. Both `"ask"` and absent mean "prompt next
      // time"; this one is representable in a patch.
      return updateOriginPolicy(origin, { identityDisclosure: "ask" });
    },
    [updateOriginPolicy]
  );

  // Per-kind rule helper
  const setPerKindRule = useCallback(
    (
      origin: string,
      kind: number,
      mode: "allow" | "deny" | "ask",
      password?: string
    ) => {
      return policySetKindRule(origin, kind, mode, password);
    },
    []
  );

  // Session grant toggle
  const setSessionGrant = useCallback(
    async (origin: string, enabled: boolean, password?: string) => {
      // Turning a grant OFF is free. Turning one on allows every
      // unprotected kind for that origin with no further prompting.
      if (!enabled) return policyClearSession(origin);
      const { policySetSession } = await import(
        "@/infrastructure/messaging/client"
      );
      return policySetSession(origin, true, password);
    },
    []
  );

  // Reset settings to defaults
  /**
   * The reset patch includes `autoLockMinutes` and `sessionTTLMinutes`, which
   * the background password-gates in either direction. Sending it without a
   * password is refused, so the caller must supply one — previously this sent
   * the patch bare, the background refused it, and the button did nothing at
   * all with no message to the user.
   */
  const resetSettings = useCallback(async (password?: string) => {
    try {
      // Reset only the fields that are supported by AppSettingsPatch
      const resetPatch: AppSettingsPatch = {
        theme: DEFAULT_SETTINGS_V1.theme,
        sidePanel: DEFAULT_SETTINGS_V1.sidePanel,
        autoLockMinutes: DEFAULT_SETTINGS_V1.autoLockMinutes,
        maxActivityEntries: DEFAULT_SETTINGS_V1.maxActivityEntries,
        relays: DEFAULT_SETTINGS_V1.relays,
        selectedKeyId: DEFAULT_SETTINGS_V1.selectedKeyId,
        mediumAllowKinds: DEFAULT_SETTINGS_V1.mediumAllowKinds,
        sessionTTLMinutes: DEFAULT_SETTINGS_V1.sessionTTLMinutes,
        onboardingCompleted: DEFAULT_SETTINGS_V1.onboardingCompleted,
        onboardingCompletedAt: DEFAULT_SETTINGS_V1.onboardingCompletedAt,
      };
      await rpcUpdateSettings(resetPatch, password);
    } catch (error) {
      console.error("Failed to reset settings:", error);
      throw error;
    }
  }, []);

  return {
    settings,
    isLoading,

    // General settings
    updateSettings,
    updateTheme,
    updateSidePanel,
    updateAutoLockMinutes,
    updateMaxActivityEntries,
    updateSessionTTLMinutes,

    // Relay management
    updateRelays,
    addRelay,
    removeRelay,

    // Trust and permissions
    updateMediumAllowKinds,
    updateOriginPolicy,
    removeOriginPolicy,
    updateOriginTrustLevel,
    setPerKindRule,
    setSessionGrant,
    revokeIdentityDisclosure,

    // Reset
    resetSettings,

    // Activity log
    clearActivityLog: activityClear,
  };
}

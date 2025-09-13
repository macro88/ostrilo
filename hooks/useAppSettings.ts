import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  getSettings as rpcGetSettings,
  updateSettings as rpcUpdateSettings,
  subscribeSettingsChanged,
} from "@/src/infrastructure/messaging/client";
import {
  policySetOrigin,
  policySetKindRule,
  policyClearSession,
  policyRemoveOrigin,
} from "@/src/infrastructure/messaging/client";
import {
  AppSettingsV1,
  DEFAULT_SETTINGS_V1,
  Theme,
  TrustLevel,
  OriginPolicy,
} from "@/lib/settings";

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
    this.listeners.forEach(callback => callback());
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
    () => ({ ...DEFAULT_SETTINGS_V1, ...(rawSettings ?? {}) }),
    [rawSettings]
  );

  const isLoading = rawSettings === null;

  // Save settings to storage
  const updateSettings = useCallback(
    async (updates: Partial<AppSettingsV1>) => {
      const next = { ...settings, ...updates } as AppSettingsV1;
      await rpcUpdateSettings(next);
    },
    [settings]
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

  const updateAutoLockMinutes = useCallback(
    (autoLockMinutes: number) => {
      return updateSettings({ autoLockMinutes });
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
      return updateSettings({ mediumAllowKinds });
    },
    [updateSettings]
  );

  const updateSessionTTLMinutes = useCallback(
    (sessionTTLMinutes: number) => {
      return updateSettings({ sessionTTLMinutes });
    },
    [updateSettings]
  );

  // Origin policy management
  const updateOriginPolicy = useCallback(
    (origin: string, policy: Partial<OriginPolicy>) => {
      // Delegate mutations to background PolicyService
      return policySetOrigin(origin, policy as any);
    },
    []
  );

  const removeOriginPolicy = useCallback((origin: string) => {
    return policyRemoveOrigin(origin);
  }, []);

  const updateOriginTrustLevel = useCallback(
    (origin: string, trustLevel: TrustLevel) => {
      return updateOriginPolicy(origin, { trustLevel });
    },
    [updateOriginPolicy]
  );

  // Per-kind rule helper
  const setPerKindRule = useCallback(
    (origin: string, kind: number, mode: "allow" | "deny" | "ask") => {
      return policySetKindRule(origin, kind, mode);
    },
    []
  );

  // Session grant toggle
  const setSessionGrant = useCallback(
    async (origin: string, enabled: boolean) => {
      if (!enabled) return policyClearSession(origin);
      const { policySetSession } = await import(
        "@/src/infrastructure/messaging/client"
      );
      return policySetSession(origin, true);
    },
    []
  );

  // Reset settings to defaults
  const resetSettings = useCallback(async () => {
    try {
      await rpcUpdateSettings(DEFAULT_SETTINGS_V1);
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

    // Reset
    resetSettings,
  };
}

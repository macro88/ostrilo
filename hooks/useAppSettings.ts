import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  getSettings as rpcGetSettings,
  updateSettings as rpcUpdateSettings,
  subscribeSettingsChanged,
} from "@/src/infrastructure/messaging/client";
import {
  AppSettingsV1,
  DEFAULT_SETTINGS_V1,
  Theme,
  TrustLevel,
  OriginPolicy,
} from "@/lib/settings";

export function useAppSettings() {
  // External store that fetches once and updates via BG events
  const subscribe = (cb: () => void) => subscribeSettingsChanged(cb);
  const getSnapshot = () => stateCache.current;
  const getServerSnapshot = () => stateCache.current;

  const stateCache = { current: DEFAULT_SETTINGS_V1 as AppSettingsV1 } as {
    current: AppSettingsV1;
  };
  // Initial load side-effect free via lazy getter in subscribe pattern
  // We fetch eagerly once on first call
  if ((getSnapshot() as any).__init !== true) {
    (async () => {
      const s = (await rpcGetSettings()) ?? DEFAULT_SETTINGS_V1;
      stateCache.current = { ...DEFAULT_SETTINGS_V1, ...s } as AppSettingsV1;
      (stateCache.current as any).__init = true;
    })();
  }
  const rawSettings = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  // Merge defaults with stored to ensure new fields exist (simple migration)
  const settings = useMemo<AppSettingsV1>(
    () => ({ ...DEFAULT_SETTINGS_V1, ...(rawSettings as AppSettingsV1) }),
    [rawSettings]
  );

  const isLoading = !rawSettings;

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
      const existingIndex = settings.origins.findIndex(
        (o) => o.origin === origin
      );
      let newOrigins;

      if (existingIndex >= 0) {
        // Update existing policy
        newOrigins = [...settings.origins];
        newOrigins[existingIndex] = {
          ...newOrigins[existingIndex],
          ...policy,
          updatedAt: Math.floor(Date.now() / 1000),
        };
      } else {
        // Add new policy
        const newPolicy: OriginPolicy = {
          origin,
          trustLevel: "medium",
          rules: {},
          updatedAt: Math.floor(Date.now() / 1000),
          ...policy,
        };
        newOrigins = [...settings.origins, newPolicy];
      }

      return updateSettings({ origins: newOrigins });
    },
    [settings.origins, updateSettings]
  );

  const removeOriginPolicy = useCallback(
    (origin: string) => {
      const newOrigins = settings.origins.filter((o) => o.origin !== origin);
      return updateSettings({ origins: newOrigins });
    },
    [settings.origins, updateSettings]
  );

  const updateOriginTrustLevel = useCallback(
    (origin: string, trustLevel: TrustLevel) => {
      return updateOriginPolicy(origin, { trustLevel });
    },
    [updateOriginPolicy]
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

    // Reset
    resetSettings,
  };
}

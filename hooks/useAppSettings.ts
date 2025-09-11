import { useState, useEffect, useCallback } from "react";
import browser from "webextension-polyfill";
import {
  AppSettingsV1,
  DEFAULT_SETTINGS_V1,
  Theme,
  TrustLevel,
  OriginPolicy,
} from "@/lib/settings";

const SETTINGS_KEY = "appSettings";

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettingsV1>(DEFAULT_SETTINGS_V1);
  const [isLoading, setIsLoading] = useState(true);

  // Load settings from storage on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await browser.storage.sync.get([SETTINGS_KEY]);
        if (result[SETTINGS_KEY]) {
          const stored = result[SETTINGS_KEY] as AppSettingsV1;
          // Simple migration: merge with defaults to ensure new fields exist
          const merged = { ...DEFAULT_SETTINGS_V1, ...stored };
          setSettings(merged);
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  // Watch for storage changes
  useEffect(() => {
    const onChanged = (
      changes: Record<string, browser.Storage.StorageChange>
    ) => {
      if (SETTINGS_KEY in changes) {
        const newValue = changes[SETTINGS_KEY].newValue;
        if (newValue) {
          setSettings(newValue as AppSettingsV1);
        }
      }
    };

    browser.storage.onChanged.addListener(onChanged);
    return () => {
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  // Save settings to storage
  const updateSettings = useCallback(
    async (updates: Partial<AppSettingsV1>) => {
      const newSettings = { ...settings, ...updates };

      console.log("Updating settings:", newSettings);
      setSettings(newSettings);

      try {
        await browser.storage.sync.set({ [SETTINGS_KEY]: newSettings });
      } catch (error) {
        console.error("Failed to save settings:", error);
        // Revert on error
        setSettings(settings);
        throw error;
      }
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
    setSettings(DEFAULT_SETTINGS_V1);
    try {
      await browser.storage.sync.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS_V1 });
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

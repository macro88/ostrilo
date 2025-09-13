import { StorageSuite } from "@/src/application/ports/storage";
import type { AppSettingsV1, Theme } from "@/src/domain/types";

const SETTINGS_KEY = "appSettings";
export const SETTINGS_CHANGED_EVENT = "ostrilo.settings.changed";

export class SettingsService {
  constructor(private storage: StorageSuite) {}

  async get(): Promise<AppSettingsV1 | undefined> {
    const existing = await this.storage.sync.get<
      Partial<AppSettingsV1> & Record<string, any>
    >(SETTINGS_KEY);
    if (existing && existing.__version === "settings.v1")
      return existing as AppSettingsV1;
    // Initialize or migrate to defaults when missing or invalid
    const d = defaultSettings();
    const next: AppSettingsV1 = {
      ...d,
      // Preserve known fields if present
      theme: (existing?.theme ?? d.theme) as Theme,
      sidePanel: existing?.sidePanel ?? d.sidePanel,
      autoLockMinutes: existing?.autoLockMinutes ?? d.autoLockMinutes,
      relays: Array.isArray(existing?.relays)
        ? (existing!.relays as string[])
        : d.relays,
      origins: Array.isArray(existing?.origins)
        ? (existing!.origins as any)
        : d.origins,
      mediumAllowKinds: Array.isArray(existing?.mediumAllowKinds)
        ? (existing!.mediumAllowKinds as number[])
        : d.mediumAllowKinds,
      sessionTTLMinutes:
        typeof existing?.sessionTTLMinutes === "number"
          ? (existing!.sessionTTLMinutes as number)
          : d.sessionTTLMinutes,
      selectedKeyId: existing?.selectedKeyId ?? d.selectedKeyId,
      __version: "settings.v1",
    };
    await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, next);
    return next;
  }

  async update(patch: Partial<AppSettingsV1>): Promise<AppSettingsV1> {
    const current = (await this.get()) ?? defaultSettings();
    const next = {
      ...current,
      ...patch,
      __version: "settings.v1",
    } as AppSettingsV1;
    await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, next);
    // Emit a runtime event for UI stores to pick up
    try {
      const { browser } = await import("wxt/browser");
      browser.runtime.sendMessage({ __event: SETTINGS_CHANGED_EVENT });
    } catch {}
    return next;
  }
}

export function defaultSettings(): AppSettingsV1 {
  return {
    __version: "settings.v1",
    theme: "system" as Theme,
    sidePanel: false,
    autoLockMinutes: 15,
    relays: ["wss://relay.damus.io", "wss://relay.primal.net"],
    origins: [],
    mediumAllowKinds: [6, 16, 7, 10002],
    sessionTTLMinutes: 0,
    selectedKeyId: undefined,
  };
}

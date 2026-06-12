import type { StorageSuite } from "@/application/ports/storage";
import { DEFAULT_RELAY_URLS, type AppSettingsV1, type Theme } from "@/domain/types";
import { BROADCAST_EVENTS } from "@/infrastructure/messaging/events";

const SETTINGS_KEY = "appSettings";
export const SETTINGS_CHANGED_EVENT = BROADCAST_EVENTS.SETTINGS_CHANGED;

const LEGACY_DEFAULT_RELAY_SETS = [
  ["wss://relay.damus.io", "wss://relay.nostr.band", "wss://nos.lol"],
  ["wss://relay.damus.io", "wss://relay.primal.net"],
  ["wss://relay.damus.io", "wss://nostr.wine"],
];

function isLegacyDefaultRelaySet(relays: unknown): relays is string[] {
  if (!Array.isArray(relays)) {
    return false;
  }

  return LEGACY_DEFAULT_RELAY_SETS.some(
    (legacyRelays) =>
      relays.length === legacyRelays.length &&
      relays.every((relay, index) => relay === legacyRelays[index])
  );
}

export class SettingsService {
  constructor(private storage: StorageSuite) {}

  async get(): Promise<AppSettingsV1 | undefined> {
    const existing = await this.storage.sync.get<
      Partial<AppSettingsV1> & Record<string, any>
    >(SETTINGS_KEY);
    if (existing && existing.__version === "settings.v1") {
      const current = existing as AppSettingsV1;
      if (isLegacyDefaultRelaySet(current.relays)) {
        const next = { ...current, relays: [...DEFAULT_RELAY_URLS] };
        await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, next);
        return next;
      }

      return current;
    }
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
      maxActivityEntries:
        typeof existing?.maxActivityEntries === "number"
          ? existing.maxActivityEntries
          : d.maxActivityEntries,
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
    relays: [...DEFAULT_RELAY_URLS],
    origins: [],
    mediumAllowKinds: [6, 16, 7, 10002],
    sessionTTLMinutes: 0,
    maxActivityEntries: 50,
    selectedKeyId: undefined,
  };
}

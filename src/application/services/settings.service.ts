import type { StorageSuite } from "@/application/ports/storage";
import { sanitizeRelayUrls } from "@/domain/relay/url";
import {
  AUTO_LOCK_BOUNDS,
  DEFAULT_RELAY_URLS,
  normalizeAutoLockMinutes,
  type OriginPolicy,
  type AppSettingsV1,
  type Theme,
} from "@/domain/types";
import {
  DEFAULT_SESSION_TTL_MINUTES,
  resolveSessionTTLMinutes,
} from "@/domain/policy/session-grants";
import {
  DEFAULT_MEDIUM_ALLOW_KINDS,
  getEffectiveMediumAllowKinds,
} from "@/domain/policy/trust-definitions";
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
      let changed = false;
      const next = {
        ...current,
        mediumAllowKinds: Array.isArray(current.mediumAllowKinds)
          ? current.mediumAllowKinds
          : [...DEFAULT_MEDIUM_ALLOW_KINDS],
      };
      changed = next.mediumAllowKinds !== current.mediumAllowKinds;

      // Normalize the session bounds on READ, not only on write. These live
      // in storage.sync, so a value written by an older build - or by another
      // profile signed into the same account - arrives here without ever
      // having passed through AppSettingsPatchSchema. A stored 0, which used
      // to mean "never auto-lock", becomes the shipped default.
      const autoLock = normalizeAutoLockMinutes(current.autoLockMinutes);
      if (autoLock !== current.autoLockMinutes) {
        next.autoLockMinutes = autoLock;
        changed = true;
      }
      const ttl = resolveSessionTTLMinutes(current.sessionTTLMinutes);
      if (ttl !== current.sessionTTLMinutes) {
        next.sessionTTLMinutes = ttl;
        changed = true;
      }

      if (isLegacyDefaultRelaySet(current.relays)) {
        next.relays = [...DEFAULT_RELAY_URLS];
        changed = true;
      }

      // Migration for lists written before `wss:` was required everywhere.
      // A stored `ws://` or credentialed URL was already refused at connect
      // time, so nothing ever dialled it - but it persisted and Settings
      // displayed it back as though it were configured. Dropping it here
      // makes the stored list and the connected list the same list.
      const sanitized = sanitizeRelayUrls(next.relays);
      if (!Array.isArray(next.relays)) {
        // No list at all. An empty array is kept as stored: removing the last
        // relay is something the user can choose to do.
        next.relays = [...DEFAULT_RELAY_URLS];
        changed = true;
      } else if (
        sanitized.length !== next.relays.length ||
        sanitized.some((relay, i) => relay !== next.relays[i])
      ) {
        // Never leave the user with no relays at all: an empty list means
        // no profile metadata anywhere, which reads as the product being
        // broken rather than as a security decision.
        next.relays = sanitized.length > 0 ? sanitized : [...DEFAULT_RELAY_URLS];
        changed = true;
      }

      if (changed) {
        await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, next);
        return next;
      }

      return next;
    }
    // Initialize or migrate to defaults when missing or invalid
    const d = defaultSettings();
    const next: AppSettingsV1 = {
      ...d,
      // Preserve known fields if present
      theme: (existing?.theme ?? d.theme) as Theme,
      sidePanel: existing?.sidePanel ?? d.sidePanel,
      autoLockMinutes: normalizeAutoLockMinutes(existing?.autoLockMinutes),
      relays: (() => {
        const sanitized = sanitizeRelayUrls(existing?.relays);
        return sanitized.length > 0 ? sanitized : d.relays;
      })(),
      origins: Array.isArray(existing?.origins)
        ? (existing.origins as OriginPolicy[])
        : d.origins,
      mediumAllowKinds: Array.isArray(existing?.mediumAllowKinds)
        ? (existing!.mediumAllowKinds as number[])
        : [...DEFAULT_MEDIUM_ALLOW_KINDS],
      maxActivityEntries:
        typeof existing?.maxActivityEntries === "number"
          ? existing.maxActivityEntries
          : d.maxActivityEntries,
      sessionTTLMinutes: resolveSessionTTLMinutes(existing?.sessionTTLMinutes),
      selectedKeyId: existing?.selectedKeyId ?? d.selectedKeyId,
      __version: "settings.v1",
    };
    await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, next);
    return next;
  }

  async update(patch: Partial<AppSettingsV1>): Promise<AppSettingsV1> {
    const current = (await this.get()) ?? defaultSettings();
    const safePatch = { ...patch };
    if (Array.isArray(patch.mediumAllowKinds)) {
      safePatch.mediumAllowKinds = getEffectiveMediumAllowKinds(
        patch.mediumAllowKinds
      );
    }
    // The patch schema bounds these at the RPC edge; this bounds them for
    // every in-process caller too, so there is one enforced range rather than
    // one per entry point.
    if ("autoLockMinutes" in patch) {
      safePatch.autoLockMinutes = normalizeAutoLockMinutes(patch.autoLockMinutes);
    }
    if ("sessionTTLMinutes" in patch) {
      safePatch.sessionTTLMinutes = resolveSessionTTLMinutes(
        patch.sessionTTLMinutes
      );
    }

    const next = {
      ...current,
      ...safePatch,
      __version: "settings.v1",
    } as AppSettingsV1;
    await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, next);
    // Emit a runtime event for UI stores to pick up
    try {
      const { browser } = await import("wxt/browser");
      browser.runtime.sendMessage({ __event: SETTINGS_CHANGED_EVENT });
    } catch {
      // No listener is the normal case (no extension page open); the
      // broadcast is best-effort and its failure changes nothing here.
    }
    return next;
  }
}

export function defaultSettings(): AppSettingsV1 {
  return {
    __version: "settings.v1",
    theme: "system" as Theme,
    sidePanel: false,
    autoLockMinutes: AUTO_LOCK_BOUNDS.default,
    relays: [...DEFAULT_RELAY_URLS],
    origins: [],
    mediumAllowKinds: [...DEFAULT_MEDIUM_ALLOW_KINDS],
    sessionTTLMinutes: DEFAULT_SESSION_TTL_MINUTES,
    maxActivityEntries: 50,
    selectedKeyId: undefined,
  };
}

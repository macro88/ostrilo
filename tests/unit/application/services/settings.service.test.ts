import { describe, expect, it } from "vitest";
import { SettingsService } from "@/application/services/settings.service";
import type { StoragePort, StorageSuite } from "@/application/ports/storage";
import {
  AUTO_LOCK_BOUNDS,
  DEFAULT_RELAY_URLS,
  DEFAULT_SETTINGS_V1,
  type AppSettingsV1,
} from "@/domain/types";
import {
  DEFAULT_SESSION_TTL_MINUTES,
  MAX_SESSION_TTL_MINUTES,
} from "@/domain/policy/session-grants";
import { DEFAULT_MEDIUM_ALLOW_KINDS } from "@/domain/policy/trust-definitions";

class MockStorage implements StoragePort {
  private store = new Map<string, any>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function createStorageSuite(): { storage: StorageSuite; sync: MockStorage } {
  const sync = new MockStorage();
  return {
    sync,
    storage: {
      local: new MockStorage(),
      sync,
      session: new MockStorage(),
    },
  };
}

function createSettings(relays: string[]): AppSettingsV1 {
  return {
    __version: "settings.v1",
    theme: "system",
    sidePanel: false,
    autoLockMinutes: 15,
    relays,
    origins: [],
    mediumAllowKinds: [...DEFAULT_MEDIUM_ALLOW_KINDS],
    sessionTTLMinutes: 0,
    maxActivityEntries: 50,
  };
}

describe("SettingsService", () => {
  it("creates new settings with the shipped relay default", async () => {
    const { storage } = createStorageSuite();
    const service = new SettingsService(storage);

    const settings = await service.get();

    expect(settings?.relays).toEqual([...DEFAULT_RELAY_URLS]);
  });

  it("migrates relay lists that match legacy shipped defaults", async () => {
    const { storage, sync } = createStorageSuite();
    await sync.set(
      "appSettings",
      createSettings([
        "wss://relay.damus.io",
        "wss://relay.nostr.band",
        "wss://nos.lol",
      ])
    );
    const service = new SettingsService(storage);

    const settings = await service.get();

    expect(settings?.relays).toEqual([...DEFAULT_RELAY_URLS]);
  });

  it("preserves custom configured relays", async () => {
    const { storage, sync } = createStorageSuite();
    const customRelays = ["wss://relay.example.com"];
    await sync.set("appSettings", createSettings(customRelays));
    const service = new SettingsService(storage);

    const settings = await service.get();

    expect(settings?.relays).toEqual(customRelays);
  });

  it("fills medium trust defaults for older settings records", async () => {
    const { storage, sync } = createStorageSuite();
    await sync.set("appSettings", {
      ...createSettings(["wss://relay.example.com"]),
      mediumAllowKinds: undefined,
    });
    const service = new SettingsService(storage);

    const settings = await service.get();

    expect(settings?.mediumAllowKinds).toEqual([...DEFAULT_MEDIUM_ALLOW_KINDS]);
  });

  it("filters protected kinds out of normal medium trust updates", async () => {
    const { storage } = createStorageSuite();
    const service = new SettingsService(storage);

    const settings = await service.update({
      mediumAllowKinds: [1, 6, 9734, 9735],
    });

    // 1 and 9734 are protected. 9735 is unprotected but absent from the
    // high-trust allowlist, and medium trust may never exceed that ceiling, so
    // storing it would record an authority that can never take effect.
    expect(settings.mediumAllowKinds).toEqual([6]);
  });
});

describe("session bounds", () => {
  it("has one shipped auto-lock default, not two that disagree", async () => {
    // domain/types said 5 and settings.service said 15. Whichever a reader
    // found first was the one they believed, and neither was enforced.
    const { storage } = createStorageSuite();
    const settings = await new SettingsService(storage).get();

    expect(settings?.autoLockMinutes).toBe(AUTO_LOCK_BOUNDS.default);
    expect(DEFAULT_SETTINGS_V1.autoLockMinutes).toBe(AUTO_LOCK_BOUNDS.default);
  });

  it("reads a stored 0 as the shipped default, not as never-lock", async () => {
    const { storage, sync } = createStorageSuite();
    await sync.set("appSettings", { ...createSettings([]), autoLockMinutes: 0 });

    const settings = await new SettingsService(storage).get();

    expect(
      settings?.autoLockMinutes,
      "SECURITY REGRESSION: a stored 0 still disables auto-lock"
    ).toBe(AUTO_LOCK_BOUNDS.default);
  });

  it("clamps a stored value above the ceiling and persists the correction", async () => {
    const { storage, sync } = createStorageSuite();
    await sync.set("appSettings", {
      ...createSettings([]),
      autoLockMinutes: 1440,
    });

    const settings = await new SettingsService(storage).get();

    expect(settings?.autoLockMinutes).toBe(AUTO_LOCK_BOUNDS.max);
    // Written back, so the next read does not have to redo the work and the
    // UI is not showing something different from what is stored.
    const stored = await sync.get<AppSettingsV1>("appSettings");
    expect(stored?.autoLockMinutes).toBe(AUTO_LOCK_BOUNDS.max);
  });

  it("normalizes a garbage stored value rather than trusting it", async () => {
    for (const bad of [null, "15", Number.NaN, -1, 0.5]) {
      const { storage, sync } = createStorageSuite();
      await sync.set("appSettings", {
        ...createSettings([]),
        autoLockMinutes: bad,
      });
      const settings = await new SettingsService(storage).get();
      expect(
        settings?.autoLockMinutes,
        `stored ${JSON.stringify(bad)} must normalize to the default`
      ).toBe(AUTO_LOCK_BOUNDS.default);
    }
  });

  it("bounds a patch written through update()", async () => {
    // The RPC schema bounds this at the edge. This bounds it for every
    // in-process caller too, so there is one enforced range rather than one
    // per entry point.
    const { storage } = createStorageSuite();
    const service = new SettingsService(storage);

    expect((await service.update({ autoLockMinutes: 0 })).autoLockMinutes).toBe(
      AUTO_LOCK_BOUNDS.default
    );
    expect(
      (await service.update({ autoLockMinutes: 9999 })).autoLockMinutes
    ).toBe(AUTO_LOCK_BOUNDS.max);
    expect(
      (await service.update({ sessionTTLMinutes: 0 })).sessionTTLMinutes,
      "a zero TTL was an unbounded session grant"
    ).toBe(DEFAULT_SESSION_TTL_MINUTES);
    expect(
      (await service.update({ sessionTTLMinutes: 9999 })).sessionTTLMinutes
    ).toBe(MAX_SESSION_TTL_MINUTES);
  });
});

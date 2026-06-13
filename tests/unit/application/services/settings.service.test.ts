import { describe, expect, it } from "vitest";
import { SettingsService } from "@/application/services/settings.service";
import type { StoragePort, StorageSuite } from "@/application/ports/storage";
import { DEFAULT_RELAY_URLS, type AppSettingsV1 } from "@/domain/types";
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

    expect(settings.mediumAllowKinds).toEqual([6, 9735]);
  });
});

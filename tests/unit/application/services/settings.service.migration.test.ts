import { describe, it, expect, beforeEach } from "vitest";
import { SettingsService } from "@/application/services/settings.service";
import type { StorageSuite } from "@/application/ports/storage";
import { DEFAULT_RELAY_URLS, type AppSettingsV1 } from "@/domain/types";
import { DEFAULT_MEDIUM_ALLOW_KINDS } from "@/domain/policy/trust-definitions";
import { memoryStorage } from "../../../helpers/vault";

function v1(relays: string[]): AppSettingsV1 {
  return {
    __version: "settings.v1",
    theme: "dark",
    sidePanel: true,
    autoLockMinutes: 15,
    relays,
    origins: [],
    mediumAllowKinds: [...DEFAULT_MEDIUM_ALLOW_KINDS],
    sessionTTLMinutes: 30,
    maxActivityEntries: 50,
  };
}

describe("SettingsService relay and legacy-record migration", () => {
  let storage: StorageSuite;
  let service: SettingsService;

  const stored = () => storage.local.get<AppSettingsV1>("appSettings");

  beforeEach(() => {
    storage = memoryStorage();
    service = new SettingsService(storage);
  });

  it("drops cleartext relays from a stored list and persists the cleaned list", async () => {
    await storage.local.set("appSettings", v1(["ws://plain.example", "wss://good.example"]));

    const settings = await service.get();

    expect(settings?.relays).toEqual(["wss://good.example"]);
    expect((await stored())?.relays).toEqual(["wss://good.example"]);
  });

  it("restores the default relay when every stored relay is refused", async () => {
    await storage.local.set("appSettings", v1(["ws://plain.example", "https://web.example"]));

    const settings = await service.get();

    expect(settings?.relays).toEqual([...DEFAULT_RELAY_URLS]);
    expect((await stored())?.relays).toEqual([...DEFAULT_RELAY_URLS]);
  });

  it("gives a v1 record with no relay list the default relays", async () => {
    const { relays: _dropped, ...withoutRelays } = v1([]);
    await storage.local.set("appSettings", withoutRelays);

    const settings = await service.get();

    expect(settings?.relays).toEqual([...DEFAULT_RELAY_URLS]);
    expect((await stored())?.relays).toEqual([...DEFAULT_RELAY_URLS]);
  });

  it("keeps a relay list the user emptied", async () => {
    await storage.local.set("appSettings", v1([]));

    const settings = await service.get();

    expect(settings?.relays).toEqual([]);
  });

  it("carries known fields over from a record without the v1 marker", async () => {
    const origins = [{ origin: "https://a.example", trustLevel: "low", rules: {}, updatedAt: 1 }];
    await storage.local.set("appSettings", {
      theme: "dark",
      sidePanel: true,
      relays: ["wss://mine.example", "ws://dropped.example"],
      origins,
      mediumAllowKinds: [7],
      maxActivityEntries: 120,
      selectedKeyId: "key-1",
    });

    const settings = await service.get();

    expect(settings).toMatchObject({
      __version: "settings.v1",
      theme: "dark",
      sidePanel: true,
      relays: ["wss://mine.example"],
      origins,
      mediumAllowKinds: [7],
      maxActivityEntries: 120,
      selectedKeyId: "key-1",
    });
    expect(await stored()).toEqual(settings);
  });

  it("replaces unusable fields of an unmarked record with defaults", async () => {
    await storage.local.set("appSettings", {
      relays: ["ws://only-cleartext.example"],
      origins: "corrupt",
      mediumAllowKinds: "corrupt",
      maxActivityEntries: "many",
    });

    const settings = await service.get();

    expect(settings?.relays).toEqual([...DEFAULT_RELAY_URLS]);
    expect(settings?.origins).toEqual([]);
    expect(settings?.mediumAllowKinds).toEqual([...DEFAULT_MEDIUM_ALLOW_KINDS]);
    expect(settings?.maxActivityEntries).toBe(50);
  });
});

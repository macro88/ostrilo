import { describe, it, expect, beforeEach } from "vitest";
import { SettingsService } from "@/application/services/settings.service";
import type { StorageSuite } from "@/application/ports/storage";
import { DEFAULT_RELAY_URLS, type AppSettingsV1 } from "@/domain/types";
import { DEFAULT_MEDIUM_ALLOW_KINDS } from "@/domain/policy/trust-definitions";
import { memoryStorage } from "../../../helpers/vault";

function v1(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    __version: "settings.v1",
    theme: "dark",
    sidePanel: true,
    autoLockMinutes: 15,
    relays: [...DEFAULT_RELAY_URLS],
    origins: [],
    mediumAllowKinds: [...DEFAULT_MEDIUM_ALLOW_KINDS],
    sessionTTLMinutes: 30,
    maxActivityEntries: 50,
    ...extra,
  };
}

describe("SettingsService image host (blossomServer)", () => {
  let storage: StorageSuite;
  let service: SettingsService;

  const stored = () =>
    storage.local.get<Record<string, unknown>>("appSettings");

  beforeEach(() => {
    storage = memoryStorage();
    service = new SettingsService(storage);
  });

  it("starts with no image host selected", async () => {
    await storage.local.set("appSettings", v1());

    const settings = await service.get();

    expect(settings?.blossomServer).toBeUndefined();
    expect(Object.hasOwn(settings ?? {}, "blossomServer")).toBe(false);
  });

  it("keeps a listed server id", async () => {
    await storage.local.set("appSettings", v1({ blossomServer: "nostr-build" }));

    const settings = await service.get();

    expect(settings?.blossomServer).toBe("nostr-build");
    expect((await stored())?.blossomServer).toBe("nostr-build");
  });

  it("reads an id that left the list as unset and removes it from storage", async () => {
    await storage.local.set(
      "appSettings",
      v1({ blossomServer: "removed-in-a-later-release" })
    );

    const settings = await service.get();

    expect(settings?.blossomServer).toBeUndefined();
    expect(Object.hasOwn(await stored() ?? {}, "blossomServer")).toBe(false);
  });

  it.each([
    ["a URL", "https://blossom.primal.net"],
    ["an uppercase id", "PRIMAL"],
    ["a number", 7],
    ["an object", { id: "primal" }],
  ])("reads %s as unset", async (_name, value) => {
    await storage.local.set("appSettings", v1({ blossomServer: value }));

    expect((await service.get())?.blossomServer).toBeUndefined();
  });

  it("drops a stored upload endpoint and persists the cleaned record", async () => {
    await storage.local.set(
      "appSettings",
      v1({ uploadEndpoint: "https://uploads.example/api" })
    );

    const settings = await service.get();

    expect(Object.hasOwn(settings ?? {}, "uploadEndpoint")).toBe(false);
    expect(Object.hasOwn(await stored() ?? {}, "uploadEndpoint")).toBe(false);
  });

  it("leaves the rest of the record alone when it drops the endpoint", async () => {
    await storage.local.set(
      "appSettings",
      v1({ uploadEndpoint: "https://uploads.example/api", theme: "light" })
    );

    const settings = await service.get();

    expect(settings?.theme).toBe("light");
    expect(settings?.autoLockMinutes).toBe(15);
    expect(settings?.relays).toEqual([...DEFAULT_RELAY_URLS]);
  });

  it("persists a chosen server through update", async () => {
    await storage.local.set("appSettings", v1());

    const updated = await service.update({ blossomServer: "primal" });

    expect(updated.blossomServer).toBe("primal");
    expect((await stored())?.blossomServer).toBe("primal");
    expect((await service.get())?.blossomServer).toBe("primal");
  });

  it("gives an image host placed in synced storage no effect", async () => {
    await storage.local.set("appSettings", v1());
    await storage.sync.set("appSettings", v1({ blossomServer: "primal" }));

    const settings = await service.get();

    expect(settings?.blossomServer).toBeUndefined();
    expect(Object.hasOwn((await stored()) ?? {}, "blossomServer")).toBe(false);
  });

  it("does not rewrite a record that has nothing to clean", async () => {
    const record = v1({ blossomServer: "primal" });
    await storage.local.set("appSettings", record);
    const settings: AppSettingsV1 | undefined = await service.get();

    expect(settings?.blossomServer).toBe("primal");
    expect(await stored()).toEqual(record);
  });
});

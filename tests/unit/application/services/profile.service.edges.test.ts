import { describe, it, expect, beforeEach, vi, type MockInstance } from "vitest";
import { ProfileService } from "@/application/services/profile.service";
import type { StoragePort, StorageSuite } from "@/application/ports/storage";
import type {
  INostrRelay,
  NostrEOSECallback,
  NostrEvent,
  NostrEventCallback,
  NostrFilter,
} from "@/application/ports/relay";
import type { ProfileCacheEntry } from "@/domain/profile/types";
import { RELAY_BOUNDS } from "@/domain/relay";
import { memoryStorage, testVault } from "../../../helpers/vault";

const PUBKEY = "a".repeat(64);

function profileEvent(name: string, createdAt = 1_700_000_000): NostrEvent {
  return {
    id: "e".repeat(64),
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: 0,
    tags: [],
    content: JSON.stringify({ name }),
    sig: "f".repeat(128),
  };
}

class ScriptedRelay implements INostrRelay {
  closed: string[] = [];
  asked: string[] = [];
  closeFails = false;
  subId = "sub-1";

  constructor(
    private readonly events: NostrEvent[],
    private readonly urls: string[] = []
  ) {}

  async subscribe(
    _filter: NostrFilter,
    onEvent: NostrEventCallback,
    onEOSE?: NostrEOSECallback
  ): Promise<string> {
    for (const event of this.events) onEvent(event);
    onEOSE?.();
    return this.subId;
  }

  async publish(): Promise<void> {}

  async close(subId: string): Promise<void> {
    if (this.closeFails) throw new Error("relay gone");
    this.closed.push(subId);
  }

  async disconnect(): Promise<void> {}

  getRelayUrls(): string[] {
    return this.urls;
  }

  async subscribeOn(
    relayUrl: string,
    filter: NostrFilter,
    onEvent: NostrEventCallback,
    onEOSE?: NostrEOSECallback
  ): Promise<string> {
    this.asked.push(relayUrl);
    return this.subscribe(filter, onEvent, onEOSE);
  }
}

function failing(port: StoragePort, op: "get" | "set", error: unknown): StoragePort {
  return {
    get: op === "get" ? async () => Promise.reject(error) : port.get.bind(port),
    set: op === "set" ? async () => Promise.reject(error) : port.set.bind(port),
    remove: port.remove.bind(port),
  };
}

function cacheEntry(pubkey: string, fetchedAt: number, about = ""): ProfileCacheEntry {
  return { pubkey, metadata: { name: pubkey.slice(0, 4), about }, fetchedAt, ttl: 3600 };
}

describe("ProfileService edge paths", () => {
  let base: StorageSuite;
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    base = memoryStorage();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const serviceWith = (storage: StorageSuite, relay: INostrRelay) =>
    new ProfileService(storage, relay, testVault(storage).vault);

  describe("when local storage cannot be read", () => {
    it("falls back to an expired cached profile", async () => {
      await base.session.set("profileCache", {
        [PUBKEY]: cacheEntry(PUBKEY, 1, "stale"),
      });
      const storage = { ...base, local: failing(base.local, "get", new Error("read failed")) };
      const relay = new ScriptedRelay([profileEvent("fresh")], ["wss://a.example", "wss://b.example"]);

      const profile = await serviceWith(storage, relay).getProfile(PUBKEY);

      expect(profile).toEqual({ name: PUBKEY.slice(0, 4), about: "stale" });
      expect(relay.asked).toEqual([]);
    });

    it("returns null when there is no cached profile to fall back to", async () => {
      const storage = { ...base, local: failing(base.local, "get", "read failed") };
      const relay = new ScriptedRelay([profileEvent("fresh")], ["wss://a.example", "wss://b.example"]);

      expect(await serviceWith(storage, relay).getProfile(PUBKEY)).toBeNull();
    });

    it("still clears the session cache when the legacy purge cannot read", async () => {
      await base.session.set("profileCache", { [PUBKEY]: cacheEntry(PUBKEY, 1) });
      const storage = { ...base, local: failing(base.local, "get", "read failed") };

      await serviceWith(storage, new ScriptedRelay([])).clearCache();

      expect(await base.session.get("profileCache")).toBeUndefined();
    });
  });

  it("fetches on one assigned relay even when the partition salt cannot be persisted", async () => {
    const storage = { ...base, local: failing(base.local, "set", "quota") };
    const relay = new ScriptedRelay([profileEvent("fresh")], ["wss://a.example", "wss://b.example"]);

    const profile = await serviceWith(storage, relay).getProfile(PUBKEY);

    expect(profile).toEqual({ name: "fresh" });
    expect(relay.asked).toHaveLength(1);
    expect(await base.local.get("relayPartitionSalt")).toBeUndefined();
  });

  it("resolves the fetch when closing the subscription fails", async () => {
    const relay = new ScriptedRelay([profileEvent("fresh")]);
    relay.closeFails = true;

    await expect(serviceWith(base, relay).getProfile(PUBKEY, true)).resolves.toEqual({
      name: "fresh",
    });
  });

  it("closes a subscription whose ID arrives after EOSE, but never an empty ID", async () => {
    const relay = new ScriptedRelay([profileEvent("fresh")]);
    const service = serviceWith(base, relay);

    await service.getProfile(PUBKEY, true);
    await vi.waitFor(() => expect(relay.closed).toEqual(["sub-1"]));

    relay.subId = "";
    await service.getProfile(PUBKEY, true);
    await Promise.resolve();
    expect(relay.closed).toEqual(["sub-1"]);
  });

  it("returns the fetched profile when the cache write fails", async () => {
    const storage = { ...base, session: failing(base.session, "set", "session full") };
    const relay = new ScriptedRelay([profileEvent("fresh")]);

    await expect(serviceWith(storage, relay).getProfile(PUBKEY, true)).resolves.toEqual({
      name: "fresh",
    });
    expect(warn.mock.calls.map((call) => String(call[1]))).toContain("unknown error");
  });

  it("evicts the oldest cache entries until the cache fits its byte budget", async () => {
    const about = "x".repeat(100_000);
    await base.session.set("profileCache", {
      ["1".repeat(64)]: cacheEntry("1".repeat(64), 100, about),
      ["2".repeat(64)]: cacheEntry("2".repeat(64), 200, about),
      ["3".repeat(64)]: cacheEntry("3".repeat(64), 300, about),
    });
    const relay = new ScriptedRelay([profileEvent("fresh")]);

    await serviceWith(base, relay).getProfile(PUBKEY, true);

    const cache = (await base.session.get<Record<string, ProfileCacheEntry>>("profileCache")) ?? {};
    expect(Object.keys(cache).sort()).toEqual(["2".repeat(64), "3".repeat(64), PUBKEY].sort());
    expect(new TextEncoder().encode(JSON.stringify(cache)).length).toBeLessThanOrEqual(
      RELAY_BOUNDS.MAX_CACHE_BYTES
    );
  });

  it("refuses to publish when the selected key is not in the vault", async () => {
    const { vault } = testVault(base);
    await vault.importKey("11".repeat(32), "profile-edge-password");
    await vault.selectKey("ghost-key");
    const relay = new ScriptedRelay([]);
    const service = new ProfileService(base, relay, vault);

    await expect(service.updateProfile({ name: "me" })).rejects.toThrow(
      "Selected key not found"
    );
  });
});

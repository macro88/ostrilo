import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProfileService } from "@/application/services/profile.service";
import type { StorageSuite, StoragePort } from "@/application/ports/storage";
import type {
  INostrRelay,
  NostrEvent,
  NostrEventCallback,
  NostrEOSECallback,
  NostrFilter,
} from "@/application/ports/relay";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import { RELAY_BOUNDS } from "@/domain/relay";

class MockStorage implements StoragePort {
  readonly store = new Map<string, any>();
  failWrites = false;

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (this.failWrites) {
      throw new Error("QUOTA_BYTES quota exceeded");
    }
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

const PUBKEY = "a".repeat(64);

function profileEvent(
  pubkey: string,
  content: unknown,
  created_at = Math.floor(Date.now() / 1000)
): NostrEvent {
  return {
    id: "e".repeat(64),
    pubkey,
    created_at,
    kind: 0,
    tags: [],
    content: typeof content === "string" ? content : JSON.stringify(content),
    sig: "f".repeat(128),
  };
}

describe("ProfileService relay trust boundary", () => {
  let local: MockStorage;
  let session: MockStorage;
  let storage: StorageSuite;
  let relay: INostrRelay;
  let keyVault: KeyVaultService;
  let service: ProfileService;

  beforeEach(() => {
    local = new MockStorage();
    session = new MockStorage();
    storage = { local, sync: new MockStorage(), session };
    relay = {
      subscribe: vi.fn(),
      publish: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    };
    keyVault = { listKeys: vi.fn() } as any;
    service = new ProfileService(storage, relay, keyVault);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("fetch always settles", () => {
    it("does not hang when the relay sends a null event payload", async () => {
      vi.useFakeTimers();

      (relay.subscribe as any).mockImplementation(
        (_filter: NostrFilter, onEvent: NostrEventCallback) => {
          // What ["EVENT", subId, null] looks like once it reaches the service.
          onEvent(null as unknown as NostrEvent);
          // No EOSE: the relay simply stops talking.
          return Promise.resolve("sub-1");
        }
      );

      const pending = service.getProfile(PUBKEY);
      await vi.advanceTimersByTimeAsync(RELAY_BOUNDS.FETCH_DEADLINE_MS + 10);

      await expect(pending).resolves.toBeNull();
      expect(relay.close).toHaveBeenCalledTimes(1);
      expect(relay.close).toHaveBeenCalledWith("sub-1");
    });

    it("settles when subscribe never resolves, because the deadline is armed first", async () => {
      vi.useFakeTimers();

      (relay.subscribe as any).mockImplementation(
        () => new Promise<string>(() => {})
      );

      const pending = service.getProfile(PUBKEY);
      await vi.advanceTimersByTimeAsync(RELAY_BOUNDS.FETCH_DEADLINE_MS + 10);

      await expect(pending).resolves.toBeNull();
    });

    it("settles exactly once when EOSE, the cap and the deadline all fire", async () => {
      vi.useFakeTimers();

      (relay.subscribe as any).mockImplementation(
        (
          _filter: NostrFilter,
          onEvent: NostrEventCallback,
          onEOSE?: NostrEOSECallback
        ) => {
          onEvent(profileEvent(PUBKEY, { name: "Alice" }));
          onEOSE?.();
          onEOSE?.();
          onEOSE?.();
          return Promise.resolve("sub-1");
        }
      );

      const result = await service.getProfile(PUBKEY);
      await vi.advanceTimersByTimeAsync(RELAY_BOUNDS.FETCH_DEADLINE_MS + 10);

      expect(result).toEqual({ name: "Alice" });
      expect(relay.close).toHaveBeenCalledTimes(1);
    });

    it("settles when an event handler throws", async () => {
      (relay.subscribe as any).mockImplementation(
        (
          _filter: NostrFilter,
          onEvent: NostrEventCallback,
          onEOSE?: NostrEOSECallback
        ) => {
          const hostile = {
            get pubkey(): string {
              throw new TypeError("hostile getter");
            },
          };
          onEvent(hostile as unknown as NostrEvent);
          onEOSE?.();
          return Promise.resolve("sub-1");
        }
      );

      await expect(service.getProfile(PUBKEY)).resolves.toBeNull();
    });

    it("closes the subscription on the EOSE path", async () => {
      (relay.subscribe as any).mockImplementation(
        (
          _filter: NostrFilter,
          onEvent: NostrEventCallback,
          onEOSE?: NostrEOSECallback
        ) => {
          // Resolve the subscription before EOSE so the close path is the one
          // that runs with a known subscription ID.
          setTimeout(() => {
            onEvent(profileEvent(PUBKEY, { name: "Alice" }));
            onEOSE?.();
          }, 0);
          return Promise.resolve("sub-eose");
        }
      );

      const result = await service.getProfile(PUBKEY);

      expect(result).toEqual({ name: "Alice" });
      expect(relay.close).toHaveBeenCalledWith("sub-eose");
    });

    it("stops accumulating after the per-subscription event cap", async () => {
      (relay.subscribe as any).mockImplementation(
        (_filter: NostrFilter, onEvent: NostrEventCallback) => {
          for (let i = 0; i < 100; i++) {
            onEvent(
              profileEvent(
                PUBKEY,
                { name: `profile ${i}` },
                Math.floor(Date.now() / 1000) - 1000 + i
              )
            );
          }
          return Promise.resolve("sub-flood");
        }
      );

      const result = await service.getProfile(PUBKEY);

      // The 20th accepted event is the newest one the service ever saw.
      expect(result).toEqual({
        name: `profile ${RELAY_BOUNDS.MAX_EVENTS_PER_SUBSCRIPTION - 1}`,
      });
    });
  });

  describe("defensive author and kind re-check", () => {
    it("discards an event for a different author", async () => {
      (relay.subscribe as any).mockImplementation(
        (
          _filter: NostrFilter,
          onEvent: NostrEventCallback,
          onEOSE?: NostrEOSECallback
        ) => {
          onEvent(profileEvent("b".repeat(64), { name: "impostor" }));
          onEOSE?.();
          return Promise.resolve("sub-1");
        }
      );

      await expect(service.getProfile(PUBKEY)).resolves.toBeNull();
      expect(session.store.get("profileCache")).toBeUndefined();
    });

    it("discards an event of the wrong kind", async () => {
      (relay.subscribe as any).mockImplementation(
        (
          _filter: NostrFilter,
          onEvent: NostrEventCallback,
          onEOSE?: NostrEOSECallback
        ) => {
          onEvent({
            ...profileEvent(PUBKEY, { name: "note" }),
            kind: 1,
          });
          onEOSE?.();
          return Promise.resolve("sub-1");
        }
      );

      await expect(service.getProfile(PUBKEY)).resolves.toBeNull();
    });

    it("leaves a cached profile unchanged when every event is rejected", async () => {
      const now = Math.floor(Date.now() / 1000);
      await session.set("profileCache", {
        [PUBKEY]: {
          pubkey: PUBKEY,
          metadata: { name: "Known good" },
          fetchedAt: now - 4000,
          ttl: 3600,
        },
      });

      (relay.subscribe as any).mockImplementation(
        (
          _filter: NostrFilter,
          onEvent: NostrEventCallback,
          onEOSE?: NostrEOSECallback
        ) => {
          onEvent(profileEvent("c".repeat(64), { name: "attacker" }));
          onEOSE?.();
          return Promise.resolve("sub-1");
        }
      );

      const result = await service.getProfile(PUBKEY);

      expect(result).toBeNull();
      expect(session.store.get("profileCache")[PUBKEY].metadata).toEqual({
        name: "Known good",
      });
    });
  });

  describe("cache isolation", () => {
    async function cacheOneProfile() {
      (relay.subscribe as any).mockImplementation(
        (
          _filter: NostrFilter,
          onEvent: NostrEventCallback,
          onEOSE?: NostrEOSECallback
        ) => {
          onEvent(profileEvent(PUBKEY, { name: "Alice" }));
          onEOSE?.();
          return Promise.resolve("sub-1");
        }
      );
      return service.getProfile(PUBKEY);
    }

    it("writes the profile cache to session storage and never to local", async () => {
      await cacheOneProfile();

      expect(session.store.has("profileCache")).toBe(true);
      expect(local.store.has("profileCache")).toBe(false);
    });

    it("purges the legacy local profile cache on first use", async () => {
      local.store.set("profileCache", {
        [PUBKEY]: {
          pubkey: PUBKEY,
          metadata: { name: "Poisoned, never verified" },
          fetchedAt: Math.floor(Date.now() / 1000),
          ttl: 3600,
        },
      });

      await cacheOneProfile();

      expect(local.store.has("profileCache")).toBe(false);
      expect(session.store.get("profileCache")[PUBKEY].metadata).toEqual({
        name: "Alice",
      });
    });

    it("returns the fetched profile even when the cache write fails", async () => {
      session.failWrites = true;

      await expect(cacheOneProfile()).resolves.toEqual({ name: "Alice" });
      expect(session.store.has("profileCache")).toBe(false);
    });

    it("enforces the byte budget before committing the write", async () => {
      // Fill the cache with large entries whose total exceeds the budget.
      const now = Math.floor(Date.now() / 1000);
      const bulky: Record<string, unknown> = {};
      for (let i = 0; i < RELAY_BOUNDS.MAX_CACHE_ENTRIES; i++) {
        bulky[`pubkey-${i}`] = {
          pubkey: `pubkey-${i}`,
          metadata: { about: "あ".repeat(500), lud06: "ル".repeat(512) },
          fetchedAt: now - (RELAY_BOUNDS.MAX_CACHE_ENTRIES - i),
          ttl: 3600,
        };
      }
      await session.set("profileCache", bulky);

      await cacheOneProfile();

      const committed = session.store.get("profileCache");
      const bytes = new TextEncoder().encode(JSON.stringify(committed)).length;

      expect(bytes).toBeLessThanOrEqual(RELAY_BOUNDS.MAX_CACHE_BYTES);
      expect(Object.keys(committed).length).toBeLessThanOrEqual(
        RELAY_BOUNDS.MAX_CACHE_ENTRIES
      );
      // The freshly fetched entry survives; the oldest ones are evicted.
      expect(committed[PUBKEY]).toBeDefined();
      expect(committed["pubkey-0"]).toBeUndefined();
    });

    it("bounds a single cached profile to the metadata ceiling", async () => {
      (relay.subscribe as any).mockImplementation(
        (
          _filter: NostrFilter,
          onEvent: NostrEventCallback,
          onEOSE?: NostrEOSECallback
        ) => {
          onEvent(
            profileEvent(PUBKEY, {
              name: "Alice",
              about: "あ".repeat(500),
              lud06: "ル".repeat(512),
              website: `https://alice.example.com/${"w".repeat(400)}`,
              picture: `https://cdn.example.com/${"p".repeat(400)}.png`,
              banner: `https://cdn.example.com/${"b".repeat(400)}.png`,
            })
          );
          onEOSE?.();
          return Promise.resolve("sub-1");
        }
      );

      await service.getProfile(PUBKEY);

      const entry = session.store.get("profileCache")[PUBKEY];
      const bytes = new TextEncoder().encode(
        JSON.stringify(entry.metadata)
      ).length;

      expect(bytes).toBeLessThanOrEqual(RELAY_BOUNDS.MAX_METADATA_BYTES);
      expect(entry.metadata.name).toBe("Alice");
    });
  });
});

// ---------------------------------------------------------------------------
// Query partitioning
// ---------------------------------------------------------------------------

/**
 * Stand-in for `RelayManager`: it knows its relay URLs and can be asked on one
 * relay at a time, which is the capability `ProfileService` partitions through.
 */
class FakeRelayManager implements INostrRelay {
  readonly fanOutFilters: NostrFilter[] = [];
  readonly targeted: Array<{ relay: string; filter: NostrFilter }> = [];

  constructor(
    private urls: string[],
    private readonly answer: (pubkey: string) => unknown | null = (pk) => ({
      name: `profile-${pk.slice(0, 4)}`,
    })
  ) {}

  getRelayUrls(): string[] {
    return this.urls;
  }

  async subscribe(
    filter: NostrFilter,
    onEvent: NostrEventCallback,
    onEOSE?: NostrEOSECallback
  ): Promise<string> {
    this.fanOutFilters.push(filter);
    this.emit(filter, onEvent);
    onEOSE?.();
    return this.urls.map(() => "sub").join(",");
  }

  async subscribeOn(
    relayUrl: string,
    filter: NostrFilter,
    onEvent: NostrEventCallback,
    onEOSE?: NostrEOSECallback
  ): Promise<string> {
    this.targeted.push({ relay: relayUrl, filter });
    this.emit(filter, onEvent);
    onEOSE?.();
    return "sub";
  }

  private emit(filter: NostrFilter, onEvent: NostrEventCallback): void {
    const pubkey = filter.authors?.[0];
    if (!pubkey) return;
    const content = this.answer(pubkey);
    if (content === null) return;
    onEvent(profileEvent(pubkey, content));
  }

  async publish(): Promise<void> {}
  async close(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

describe("ProfileService query partitioning", () => {
  const RELAYS = [
    "wss://relay-a.example.com",
    "wss://relay-b.example.com",
    "wss://relay-c.example.com",
  ];
  const PUBKEYS = Array.from({ length: 9 }, (_, i) =>
    i.toString(16).repeat(64).slice(0, 64)
  );

  let local: MockStorage;
  let session: MockStorage;
  let storage: StorageSuite;
  let keyVault: KeyVaultService;

  beforeEach(() => {
    local = new MockStorage();
    session = new MockStorage();
    storage = { local, sync: new MockStorage(), session };
    keyVault = {
      listKeys: vi
        .fn()
        .mockResolvedValue(PUBKEYS.map((pubkey, i) => ({ id: `k${i}`, pubkey }))),
    } as any;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // A fixed salt keeps the assignment deterministic for assertions.
    local.store.set("relayPartitionSalt", "0123456789abcdef0123456789abcdef");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks exactly one relay per pubkey, one author per filter", async () => {
    const manager = new FakeRelayManager(RELAYS);
    const service = new ProfileService(storage, manager, keyVault);

    await service.getAllProfiles();

    expect(manager.fanOutFilters).toHaveLength(0);
    expect(manager.targeted).toHaveLength(PUBKEYS.length);

    for (const { filter } of manager.targeted) {
      expect(filter.authors).toHaveLength(1);
      expect(filter.kinds).toEqual([0]);
      expect(filter.limit).toBe(1);
    }

    const askedPerRelay = new Map<string, Set<string>>();
    for (const { relay, filter } of manager.targeted) {
      const set = askedPerRelay.get(relay) ?? new Set<string>();
      set.add(filter.authors![0]);
      askedPerRelay.set(relay, set);
    }

    expect(askedPerRelay.size).toBeGreaterThan(1);
    for (const [, seen] of askedPerRelay) {
      expect(seen.size).toBeLessThan(PUBKEYS.length);
    }
  });

  it("assigns a pubkey to the same relay on repeat hydrations", async () => {
    const first = new FakeRelayManager(RELAYS);
    await new ProfileService(storage, first, keyVault).getAllProfiles();

    // A fresh service and a fresh session cache, same install salt.
    session.store.clear();
    const second = new FakeRelayManager(RELAYS);
    await new ProfileService(storage, second, keyVault).getAllProfiles();

    const map = (m: FakeRelayManager) =>
      new Map(m.targeted.map(({ relay, filter }) => [filter.authors![0], relay]));

    expect(map(second)).toEqual(map(first));
  });

  it("creates and persists an install salt when none exists", async () => {
    local.store.delete("relayPartitionSalt");

    const manager = new FakeRelayManager(RELAYS);
    await new ProfileService(storage, manager, keyVault).getAllProfiles();

    expect(local.store.get("relayPartitionSalt")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("retries a failed assignment on one alternate relay, not all of them", async () => {
    const failing = new Set<string>();
    const manager = new FakeRelayManager(RELAYS, () => null);
    const service = new ProfileService(storage, manager, keyVault);

    await service.getProfile(PUBKEYS[0]);

    for (const { relay } of manager.targeted) {
      failing.add(relay);
    }

    expect(manager.targeted).toHaveLength(2);
    expect(failing.size).toBe(2);
    expect(manager.fanOutFilters).toHaveLength(0);
  });

  it("lets an explicit refresh of one identity fan out to every relay", async () => {
    const manager = new FakeRelayManager(RELAYS);
    const service = new ProfileService(storage, manager, keyVault);

    await service.getProfile(PUBKEYS[0], true);

    expect(manager.fanOutFilters).toHaveLength(1);
    expect(manager.targeted).toHaveLength(0);
    expect(manager.fanOutFilters[0].authors).toEqual([PUBKEYS[0]]);
  });

  it("falls back to an ordinary fetch when only one relay is configured", async () => {
    const manager = new FakeRelayManager(["wss://only.example.com"]);
    const service = new ProfileService(storage, manager, keyVault);

    await service.getAllProfiles();

    expect(manager.targeted).toHaveLength(0);
    expect(manager.fanOutFilters).toHaveLength(PUBKEYS.length);
    for (const filter of manager.fanOutFilters) {
      expect(filter.authors).toHaveLength(1);
    }
  });
});

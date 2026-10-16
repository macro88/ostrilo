import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProfileService } from "@/application/services/profile.service";
import type { StorageSuite, StoragePort } from "@/application/ports/storage";
import type { INostrRelay, NostrEvent } from "@/application/ports/relay";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import type { ProfileMetadata } from "@/domain/profile/types";

// Mock Storage Implementation
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

  clear() {
    this.store.clear();
  }
}

describe("ProfileService Unit Tests", () => {
  let storage: StorageSuite;
  let localStore: MockStorage;
  let sessionStore: MockStorage;
  let relay: INostrRelay;
  let keyVault: KeyVaultService;
  let service: ProfileService;

  beforeEach(() => {
    localStore = new MockStorage();
    sessionStore = new MockStorage();
    storage = {
      local: localStore,
      sync: new MockStorage(),
      session: sessionStore,
    };

    relay = {
      subscribe: vi.fn(),
      publish: vi.fn(),
      close: vi.fn(),
      disconnect: vi.fn(),
    };

    keyVault = {
      listKeys: vi.fn(),
      getSettings: vi.fn(),
      signEvent: vi.fn(),
    } as any;

    service = new ProfileService(storage, relay, keyVault);
  });

  afterEach(() => {
    localStore.clear();
    sessionStore.clear();
    vi.clearAllMocks();
  });

  describe("getProfile - Cache Hit", () => {
    it("should return cached profile without querying relay", async () => {
      const pubkey = "test-pubkey";
      const cachedProfile: ProfileMetadata = {
        name: "Alice",
        about: "Test bio",
      };
      const now = Math.floor(Date.now() / 1000);

      // Pre-populate cache
      await storage.session.set("profileCache", {
        [pubkey]: {
          pubkey,
          metadata: cachedProfile,
          fetchedAt: now - 100, // 100 seconds ago
          ttl: 3600,
        },
      });

      const result = await service.getProfile(pubkey);

      expect(result).toEqual(cachedProfile);
      expect(relay.subscribe).not.toHaveBeenCalled();
    });
  });

  describe("getProfile - Cache Miss", () => {
    it("should query relay and cache the result", async () => {
      const pubkey = "test-pubkey";
      const fetchedProfile: ProfileMetadata = {
        name: "Bob",
        about: "Fetched from relay",
      };

      // Mock relay response
      (relay.subscribe as any).mockImplementation((filter: any, onEvent: any, onEOSE: any) => {
        onEvent({
          id: "event-id",
          pubkey,
          created_at: 1000,
          kind: 0,
          tags: [],
          content: JSON.stringify(fetchedProfile),
          sig: "sig",
        } as NostrEvent);
        if (onEOSE) onEOSE();
        return Promise.resolve("sub-id");
      });

      const result = await service.getProfile(pubkey);

      expect(result).toEqual(fetchedProfile);
      expect(relay.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          kinds: [0],
          authors: [pubkey],
        }),
        expect.any(Function),
        expect.any(Function)
      );

      // Verify cache was updated
      const cache = await storage.session.get<any>("profileCache");
      expect(cache[pubkey]).toBeDefined();
      expect(cache[pubkey].metadata).toEqual(fetchedProfile);
    });
  });

  describe("getProfile - Expired Cache", () => {
    it("should refetch when cache is expired", async () => {
      const pubkey = "test-pubkey";
      const oldProfile: ProfileMetadata = { name: "Old" };
      const newProfile: ProfileMetadata = { name: "New" };
      const now = Math.floor(Date.now() / 1000);

      // Pre-populate with expired cache
      await storage.session.set("profileCache", {
        [pubkey]: {
          pubkey,
          metadata: oldProfile,
          fetchedAt: now - 4000, // More than 1 hour (3600s) ago
          ttl: 3600,
        },
      });

      // Mock relay response
      (relay.subscribe as any).mockImplementation((filter: any, onEvent: any, onEOSE: any) => {
        onEvent({
          id: "new-event-id",
          pubkey,
          created_at: 2000,
          kind: 0,
          tags: [],
          content: JSON.stringify(newProfile),
          sig: "sig",
        } as NostrEvent);
        if (onEOSE) onEOSE();
        return Promise.resolve("sub-id");
      });

      const result = await service.getProfile(pubkey);

      expect(result).toEqual(newProfile);
      expect(relay.subscribe).toHaveBeenCalled();
    });
  });

  describe("getProfile - Force Fetch", () => {
    it("should bypass cache when forceFetch is true", async () => {
      const pubkey = "test-pubkey";
      const cachedProfile: ProfileMetadata = { name: "Cached" };
      const freshProfile: ProfileMetadata = { name: "Fresh" };
      const now = Math.floor(Date.now() / 1000);

      // Pre-populate cache with valid (non-expired) entry
      await storage.session.set("profileCache", {
        [pubkey]: {
          pubkey,
          metadata: cachedProfile,
          fetchedAt: now - 100,
          ttl: 3600,
        },
      });

      // Mock relay response
      (relay.subscribe as any).mockImplementation((filter: any, onEvent: any, onEOSE: any) => {
        onEvent({
          id: "fresh-event-id",
          pubkey,
          created_at: 3000,
          kind: 0,
          tags: [],
          content: JSON.stringify(freshProfile),
          sig: "sig",
        } as NostrEvent);
        if (onEOSE) onEOSE();
        return Promise.resolve("sub-id");
      });

      const result = await service.getProfile(pubkey, true);

      expect(result).toEqual(freshProfile);
      expect(relay.subscribe).toHaveBeenCalled();
    });
  });

  describe("getProfile - Multiple Events", () => {
    it("should select event with highest created_at", async () => {
      const pubkey = "test-pubkey";
      const oldProfile: ProfileMetadata = { name: "Old" };
      const newProfile: ProfileMetadata = { name: "Newest" };
      const middleProfile: ProfileMetadata = { name: "Middle" };

      // Mock relay returning multiple events
      (relay.subscribe as any).mockImplementation((filter: any, onEvent: any, onEOSE: any) => {
        onEvent({
          id: "event-1",
          pubkey,
          created_at: 1000,
          kind: 0,
          tags: [],
          content: JSON.stringify(oldProfile),
          sig: "sig",
        } as NostrEvent);
        onEvent({
          id: "event-2",
          pubkey,
          created_at: 3000,
          kind: 0,
          tags: [],
          content: JSON.stringify(newProfile),
          sig: "sig",
        } as NostrEvent);
        onEvent({
          id: "event-3",
          pubkey,
          created_at: 2000,
          kind: 0,
          tags: [],
          content: JSON.stringify(middleProfile),
          sig: "sig",
        } as NostrEvent);
        if (onEOSE) onEOSE();
        return Promise.resolve("sub-id");
      });

      const result = await service.getProfile(pubkey);

      expect(result).toEqual(newProfile);
    });
  });

  describe("getProfile - Invalid JSON", () => {
    it("should return empty profile on JSON parse error", async () => {
      const pubkey = "test-pubkey";

      // Mock relay returning invalid JSON
      (relay.subscribe as any).mockImplementation((filter: any, onEvent: any, onEOSE: any) => {
        onEvent({
          id: "event-id",
          pubkey,
          created_at: 1000,
          kind: 0,
          tags: [],
          content: "not-valid-json{",
          sig: "sig",
        } as NostrEvent);
        if (onEOSE) onEOSE();
        return Promise.resolve("sub-id");
      });

      const result = await service.getProfile(pubkey);

      // Should return empty object instead of null
      expect(result).toEqual({});
    });
  });

  describe("getProfile - Validation Failure", () => {
    it("should handle partial profile data gracefully", async () => {
      const pubkey = "test-pubkey";
      const partialProfile = {
        name: "Test",
        // Valid fields, validator should accept
      };

      (relay.subscribe as any).mockImplementation((filter: any, onEvent: any, onEOSE: any) => {
        onEvent({
          id: "event-id",
          pubkey,
          created_at: 1000,
          kind: 0,
          tags: [],
          content: JSON.stringify(partialProfile),
          sig: "sig",
        } as NostrEvent);
        if (onEOSE) onEOSE();
        return Promise.resolve("sub-id");
      });

      const result = await service.getProfile(pubkey);

      // Should still work with partial profile
      expect(result).toBeDefined();
      expect(result?.name).toBe("Test");
    });
  });

  describe("getProfile - Relay Timeout", () => {
    it("should return null when relay fails (fetchProfileFromRelay handles error)", async () => {
      const pubkey = "test-pubkey";
      const cachedProfile: ProfileMetadata = { name: "Cached" };
      const now = Math.floor(Date.now() / 1000);

      // Pre-populate with expired cache
      await storage.session.set("profileCache", {
        [pubkey]: {
          pubkey,
          metadata: cachedProfile,
          fetchedAt: now - 4000, // Expired
          ttl: 3600,
        },
      });

      // Mock relay.subscribe to reject - fetchProfileFromRelay catches and returns null
      (relay.subscribe as any).mockRejectedValue(new Error("Connection timeout"));

      const result = await service.getProfile(pubkey);

      // Should return null as fetchProfileFromRelay catches the error and returns null
      expect(result).toBeNull();
    });

    it("should return null on relay timeout with no cache", async () => {
      const pubkey = "test-pubkey";

      // Mock relay.subscribe to reject
      (relay.subscribe as any).mockRejectedValue(new Error("Connection timeout"));

      const result = await service.getProfile(pubkey);

      expect(result).toBeNull();
    });
  });

  describe("getAllProfiles", () => {
    it("should fetch profiles for all managed keys", async () => {
      const keys = [
        { id: "key1", pubkey: "pubkey1" },
        { id: "key2", pubkey: "pubkey2" },
      ];
      const profile1: ProfileMetadata = { name: "User 1" };
      const profile2: ProfileMetadata = { name: "User 2" };

      (keyVault.listKeys as any).mockResolvedValue(keys);

      // Mock relay responses for both keys
      (relay.subscribe as any).mockImplementation((filter: any, onEvent: any, onEOSE: any) => {
        const pubkey = filter.authors[0];
        const profile = pubkey === "pubkey1" ? profile1 : profile2;
        onEvent({
          id: `event-${pubkey}`,
          pubkey,
          created_at: 1000,
          kind: 0,
          tags: [],
          content: JSON.stringify(profile),
          sig: "sig",
        } as NostrEvent);
        if (onEOSE) onEOSE();
        return Promise.resolve("sub-id");
      });

      const result = await service.getAllProfiles();

      expect(result.size).toBe(2);
      expect(result.get("pubkey1")).toEqual(profile1);
      expect(result.get("pubkey2")).toEqual(profile2);
    });
  });

  describe("updateProfile", () => {
    it("should validate, sign, publish, and cache profile", async () => {
      const metadata: ProfileMetadata = {
        name: "Alice",
        about: "Test bio",
      };
      const settings = { selectedKeyId: "key1" };
      const keys = [{ id: "key1", pubkey: "pubkey1" }];
      const signedEvent = {
        id: "signed-event-id",
        pubkey: "pubkey1",
        created_at: 1000,
        kind: 0,
        tags: [],
        content: JSON.stringify(metadata),
        sig: "signature",
      };

      (keyVault.getSettings as any).mockResolvedValue(settings);
      (keyVault.listKeys as any).mockResolvedValue(keys);
      (keyVault.signEvent as any).mockResolvedValue(signedEvent);
      (relay.publish as any).mockResolvedValue(undefined);

      await service.updateProfile(metadata);

      expect(keyVault.signEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pubkey: "pubkey1",
          kind: 0,
          content: JSON.stringify(metadata),
        }),
        "key1"
      );
      expect(relay.publish).toHaveBeenCalledWith(signedEvent);

      // Verify cache was updated
      const cache = await storage.session.get<any>("profileCache");
      expect(cache["pubkey1"]).toBeDefined();
      expect(cache["pubkey1"].metadata).toEqual(metadata);
    });

    it("should accept invalid fields but strip them (partial validation)", async () => {
      const invalidMetadata = {
        name: "A".repeat(100), // Too long (max 50) - will be stripped
        about: "Valid bio", // Valid - will be kept
      } as ProfileMetadata;

      // Mock to pass the key selection checks
      const settings = { selectedKeyId: "key1" };
      const keys = [{ id: "key1", pubkey: "pubkey1" }];
      (keyVault.getSettings as any).mockResolvedValue(settings);
      (keyVault.listKeys as any).mockResolvedValue(keys);
      
      const signedEvent = {
        id: "event-id",
        pubkey: "pubkey1",
        created_at: 1000,
        kind: 0,
        tags: [],
        content: JSON.stringify({ about: "Valid bio" }), // Only valid field
        sig: "sig",
      };
      (keyVault.signEvent as any).mockResolvedValue(signedEvent);
      (relay.publish as any).mockResolvedValue(undefined);

      // Should succeed with partial profile (invalid name stripped)
      await service.updateProfile(invalidMetadata);

      expect(relay.publish).toHaveBeenCalledWith(signedEvent);
    });

    it("should reject with validation error for completely invalid metadata", async () => {
      // Pass non-object data that validation will reject as null
      const invalidMetadata = "not an object" as any;

      await expect(service.updateProfile(invalidMetadata)).rejects.toThrow(
        "Profile metadata validation failed"
      );
    });

    it("should reject when no key is selected", async () => {
      const metadata: ProfileMetadata = { name: "Test" };
      (keyVault.getSettings as any).mockResolvedValue(null);

      await expect(service.updateProfile(metadata)).rejects.toThrow(
        "No key selected"
      );
    });

    it("should reject on publish failure", async () => {
      const metadata: ProfileMetadata = { name: "Test" };
      const settings = { selectedKeyId: "key1" };
      const keys = [{ id: "key1", pubkey: "pubkey1" }];

      (keyVault.getSettings as any).mockResolvedValue(settings);
      (keyVault.listKeys as any).mockResolvedValue(keys);
      (keyVault.signEvent as any).mockResolvedValue({
        id: "event-id",
        pubkey: "pubkey1",
        created_at: 1000,
        kind: 0,
        tags: [],
        content: JSON.stringify(metadata),
        sig: "sig",
      });
      (relay.publish as any).mockRejectedValue(new Error("Relay rejected"));

      await expect(service.updateProfile(metadata)).rejects.toThrow(
        "Relay rejected"
      );
    });
  });

  describe("clearCache", () => {
    it("should remove specific pubkey from cache", async () => {
      const cache = {
        pubkey1: {
          pubkey: "pubkey1",
          metadata: { name: "User 1" },
          fetchedAt: 1000,
          ttl: 3600,
        },
        pubkey2: {
          pubkey: "pubkey2",
          metadata: { name: "User 2" },
          fetchedAt: 1000,
          ttl: 3600,
        },
      };

      await storage.session.set("profileCache", cache);
      await service.clearCache("pubkey1");

      const updatedCache = await storage.session.get<any>("profileCache");
      expect(updatedCache.pubkey1).toBeUndefined();
      expect(updatedCache.pubkey2).toBeDefined();
    });

    it("should remove all cache when no pubkey provided", async () => {
      const cache = {
        pubkey1: {
          pubkey: "pubkey1",
          metadata: { name: "User 1" },
          fetchedAt: 1000,
          ttl: 3600,
        },
      };

      await storage.session.set("profileCache", cache);
      await service.clearCache();

      const updatedCache = await storage.session.get<any>("profileCache");
      expect(updatedCache).toBeUndefined();
    });
  });

  describe("Cache Eviction (LRU)", () => {
    it("should evict oldest entry when cache exceeds 50 entries", async () => {
      const now = Math.floor(Date.now() / 1000);

      // Pre-populate cache with 50 entries
      const cache: any = {};
      for (let i = 0; i < 50; i++) {
        cache[`pubkey${i}`] = {
          pubkey: `pubkey${i}`,
          metadata: { name: `User ${i}` },
          fetchedAt: now - (50 - i), // Earlier entries have lower fetchedAt
          ttl: 3600,
        };
      }
      await storage.session.set("profileCache", cache);

      // Add one more profile to trigger eviction
      const newProfile: ProfileMetadata = { name: "New User" };
      (relay.subscribe as any).mockImplementation((filter: any, onEvent: any, onEOSE: any) => {
        onEvent({
          id: "new-event-id",
          pubkey: "pubkey-new",
          created_at: 1000,
          kind: 0,
          tags: [],
          content: JSON.stringify(newProfile),
          sig: "sig",
        } as NostrEvent);
        if (onEOSE) onEOSE();
        return Promise.resolve("sub-id");
      });

      await service.getProfile("pubkey-new");

      const updatedCache = await storage.session.get<any>("profileCache");

      // Should still have 50 entries (oldest evicted)
      expect(Object.keys(updatedCache).length).toBe(50);

      // Oldest entry (pubkey0) should be gone
      expect(updatedCache["pubkey0"]).toBeUndefined();

      // New entry should be present
      expect(updatedCache["pubkey-new"]).toBeDefined();
    });
  });
});

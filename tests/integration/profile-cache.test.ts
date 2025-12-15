import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProfileService } from "@/application/services/profile.service";
import type { StorageSuite, StoragePort } from "@/application/ports/storage";
import type { INostrRelay } from "@/application/ports/relay";
import type { KeyVaultService } from "@/application/services/key-vault.service";

// Mock Storage
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

describe("Profile Cache Isolation", () => {
  let storage: StorageSuite;
  let relay: INostrRelay;
  let keyVault: KeyVaultService;
  let service: ProfileService;

  beforeEach(() => {
    const mockStorage = new MockStorage();
    storage = {
      local: mockStorage,
      sync: mockStorage,
      session: mockStorage,
    };

    relay = {
      subscribe: vi.fn(),
      publish: vi.fn(),
      close: vi.fn(),
      disconnect: vi.fn(),
    };

    keyVault = {} as any; // Not needed for cache tests

    service = new ProfileService(storage, relay, keyVault);
  });

  it("should cache profiles separately for different pubkeys", async () => {
    const pubkeyA = "pubkeyA";
    const pubkeyB = "pubkeyB";
    const profileA = { name: "Alice" };
    const profileB = { name: "Bob" };

    // Mock relay to return different profiles
    relay.subscribe = vi.fn((filter, onEvent, onEOSE) => {
      const author = filter.authors?.[0];
      if (author === pubkeyA) {
        onEvent({
          content: JSON.stringify(profileA),
          created_at: 100,
          kind: 0,
          pubkey: pubkeyA,
        } as any);
      } else if (author === pubkeyB) {
        onEvent({
          content: JSON.stringify(profileB),
          created_at: 100,
          kind: 0,
          pubkey: pubkeyB,
        } as any);
      }
      if (onEOSE) onEOSE?.();
      return "subId";
    });

    // Fetch profiles
    await service.getProfile(pubkeyA);
    await service.getProfile(pubkeyB);

    // Verify storage
    const cache = await storage.local.get<any>("profileCache");
    expect(cache).toBeDefined();
    expect(cache[pubkeyA]).toBeDefined();
    expect(cache[pubkeyB]).toBeDefined();
    expect(cache[pubkeyA].metadata).toEqual(profileA);
    expect(cache[pubkeyB].metadata).toEqual(profileB);
  });
});

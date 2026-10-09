import { describe, it, expect, vi, beforeEach } from "vitest";
import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import { ActivityLogService } from "@/application/services/activity-log.service";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { StoragePort } from "@/application/ports/storage";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import type { PolicyService } from "@/application/services/policy.service";

class MockStorage implements StoragePort {
  private store: Map<string, any> = new Map();
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

// No crypto mock. This file used to stub `@/domain/utils/crypto` so that
// `computeEventId` returned "mock-event-id", which meant the handler under
// test never computed an id at all. That module is gone; event ids now come
// from the one application-layer implementation, and running it for real is
// microseconds of SHA-256.

describe("Activity Log Integration", () => {
  let storage: MockStorage;
  let activityLog: ActivityLogService;
  let handler: NostrRpcHandler;
  let context: ServiceContext;
  let mockVault: Partial<KeyVaultService>;
  let mockPolicy: Partial<PolicyService>;

  beforeEach(() => {
    storage = new MockStorage();
    activityLog = new ActivityLogService(storage);
    handler = new NostrRpcHandler();

    mockVault = {
      getLockState: vi.fn().mockResolvedValue({ isLocked: false }),
      isKeyUnreadable: vi.fn().mockReturnValue(false),
      listKeys: vi
        .fn()
        .mockResolvedValue([
          { id: "key1", pubkey: "pubkey", isSelected: true },
        ]),
      sign: vi.fn().mockResolvedValue({ sigHex: "mock-signature" }),
    };

    mockPolicy = {
      evaluate: vi.fn().mockResolvedValue({ mode: "deny" }),
    };

    context = {
      activityLog,
      vault: mockVault as KeyVaultService,
      policy: mockPolicy as PolicyService,
    } as any;
  });

  it("should record denial in activity log", async () => {
    const request = {
      type: "nostr.signEvent",
      origin: "https://example.com",
      event: {
        kind: 7,
        content: "test",
        tags: [],
        created_at: 1234567890,
      },
    };

    await handler.handleRequest(request as any, context);

    const entries = await activityLog.getRecent();
    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe("deny");
    expect(entries[0].origin).toBe("https://example.com");
  });

  it("should record approval in activity log", async () => {
    mockPolicy.evaluate = vi.fn().mockResolvedValue({ mode: "allow" });

    const request = {
      type: "nostr.signEvent",
      origin: "https://example.com",
      event: {
        kind: 7,
        content: "test",
        tags: [],
        created_at: 1234567890,
      },
    };

    await handler.handleRequest(request as any, context);

    const entries = await activityLog.getRecent();
    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe("allow");
    expect(entries[0].origin).toBe("https://example.com");
  });

  it("should maintain correct order of entries", async () => {
    // First deny
    mockPolicy.evaluate = vi.fn().mockResolvedValue({ mode: "deny" });
    await handler.handleRequest(
      {
        type: "nostr.signEvent",
        origin: "https://example.com",
        event: {
          kind: 1,
          content: "deny1",
          tags: [],
          created_at: 1,
        },
      } as any,
      context
    );

    // Then allow
    mockPolicy.evaluate = vi.fn().mockResolvedValue({ mode: "allow" });
    await handler.handleRequest(
      {
        type: "nostr.signEvent",
        origin: "https://example.com",
        event: {
          kind: 7,
          content: "allow1",
          tags: [],
          created_at: 2,
        },
      } as any,
      context
    );

    const entries = await activityLog.getRecent();
    expect(entries).toHaveLength(2);
    expect(entries[0].decision).toBe("allow"); // Newest first
    expect(entries[1].decision).toBe("deny");
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import { ApprovalRpcHandler } from "@/infrastructure/messaging/handlers/approval-rpc";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";
import { PolicyService } from "@/application/services/policy.service";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { StorageSuite } from "@/application/ports/storage";

/**
 * Cross-layer consent tests: the real policy service, the real approval queue
 * and the real NIP-07 handler, with only the vault and the activity log stubbed.
 *
 * These stand in for the Playwright coverage of the same behaviour, which
 * currently cannot reach a signing request because the onboarding flow is
 * mid-refactor in a companion change. The assertions are the ones that matter:
 * what the engine decides, what gets queued, and who receives a signature.
 */

const PUBKEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

function createMemoryStorage(): StorageSuite {
  const make = () => {
    const m = new Map<string, unknown>();
    return {
      async get<T>(key: string): Promise<T | undefined> {
        return m.get(key) as T | undefined;
      },
      async set<T>(key: string, value: T): Promise<void> {
        m.set(key, value);
      },
      async remove(key: string): Promise<void> {
        m.delete(key);
      },
    };
  };
  return { local: make(), sync: make(), session: make() };
}

function unsignedEvent(overrides: Record<string, unknown> = {}) {
  return {
    kind: 7,
    content: "+",
    tags: [],
    created_at: 1_700_000_000,
    ...overrides,
  };
}

describe("consent policy integration", () => {
  let storage: StorageSuite;
  let policy: PolicyService;
  let queue: ApprovalQueueService;
  let nostr: NostrRpcHandler;
  let approval: ApprovalRpcHandler;
  let context: ServiceContext;
  let sign: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    storage = createMemoryStorage();
    policy = new PolicyService(storage);
    queue = new ApprovalQueueService();
    // Returning undefined puts the handler on the sidepanel path, so no real
    // popup window is created.
    nostr = new NostrRpcHandler(queue, vi.fn().mockResolvedValue(undefined));
    approval = new ApprovalRpcHandler(queue);
    sign = vi.fn().mockResolvedValue({ sigHex: "a".repeat(128), keyId: "key-1" });

    await storage.session.set("lockState", { isLocked: false });

    context = {
      vault: {
        getLockState: vi.fn().mockResolvedValue({ isLocked: false }),
        listKeys: vi
          .fn()
          .mockResolvedValue([{ id: "key-1", pubkey: PUBKEY, isSelected: true }]),
        sign,
      },
      policy,
      activityLog: { addEntry: vi.fn().mockResolvedValue(undefined) },
      settings: { get: vi.fn(), update: vi.fn() },
    } as unknown as ServiceContext;
  });

  function signEvent(origin: string, event: Record<string, unknown>) {
    return nostr.handleRequest(
      { type: "nostr.signEvent", event, origin } as never,
      context
    );
  }

  it("prompts for a protected kind even at high trust with an explicit allow", async () => {
    await policy.setOriginPolicy("https://a.example", { trustLevel: "high" });
    await policy.setPerKindRule("https://a.example", 1, "allow");

    const pending = signEvent("https://a.example", unsignedEvent({ kind: 1 }));

    await vi.waitFor(() => expect(queue.count()).toBe(1));
    expect(sign).not.toHaveBeenCalled();

    const request = queue.getNextPending()!;
    queue.resolve(request.id, "allow_once");

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("auto-signs an allowlisted kind at high trust but prompts for one outside it", async () => {
    await policy.setOriginPolicy("https://a.example", { trustLevel: "high" });

    const allowed = await signEvent("https://a.example", unsignedEvent({ kind: 7 }));
    expect(allowed.ok).toBe(true);
    expect(queue.count()).toBe(0);

    const pending = signEvent(
      "https://a.example",
      unsignedEvent({ kind: 30023, content: "draft" })
    );
    await vi.waitFor(() => expect(queue.count()).toBe(1));
    queue.resolve(queue.getNextPending()!.id, "deny");
    const refused = await pending;
    expect(refused.ok).toBe(false);
  });

  it("gives two origins asking for a byte-identical event two prompts", async () => {
    const event = unsignedEvent({ kind: 1, content: "same bytes" });

    const first = signEvent("https://a.example", event);
    const second = signEvent("https://b.example", event);

    await vi.waitFor(() => expect(queue.count()).toBe(2));
    const [entryA, entryB] = queue.getAllPending();
    expect(entryA.origin).toBe("https://a.example");
    expect(entryB.origin).toBe("https://b.example");
    // Same event bytes, so the hash alone would have collapsed these into one
    // prompt and returned a.example's signature to b.example too.
    expect(entryA.eventIdHash).toBe(entryB.eventIdHash);

    queue.resolve(entryA.id, "allow_once");

    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
    expect(queue.count()).toBe(1);

    queue.resolve(entryB.id, "deny");
    const secondResult = await second;
    expect(secondResult.ok).toBe(false);
    if (!secondResult.ok) {
      expect(secondResult.error.data.errorCode).toBe(RPC_ERROR_CODES.DENIED);
    }
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("does not widen authority when the user denies and remembers", async () => {
    const pending = signEvent("https://a.example", unsignedEvent({ kind: 1 }));
    await vi.waitFor(() => expect(queue.count()).toBe(1));

    const request = queue.getNextPending()!;
    const resolved = await approval.handleRequest(
      {
        type: "approval.resolve",
        requestId: request.id,
        action: "deny_remember",
      } as never,
      context
    );
    expect(resolved.ok).toBe(true);
    await pending;

    const stored = await storage.sync.get<any>("appSettings");
    const record = stored.origins.find(
      (o: any) => o.origin === "https://a.example"
    );
    expect(record.rules).toEqual({ 1: "deny" });
    expect(record.trustLevel).toBe("low");

    // Every kind the old fabricated "medium" trust level would have handed over.
    for (const kind of [6, 16, 7, 10002]) {
      const out = await policy.evaluate({ origin: "https://a.example", kind });
      expect(out.mode).toBe("ask");
    }
  });

  it("auto-signs the next request after an allow-and-remember, and only that kind", async () => {
    const pending = signEvent(
      "https://a.example",
      unsignedEvent({ kind: 10002, content: "relay list" })
    );
    await vi.waitFor(() => expect(queue.count()).toBe(1));

    const request = queue.getNextPending()!;
    await approval.handleRequest(
      { type: "approval.resolve", requestId: request.id, action: "allow" } as never,
      context
    );
    const firstResult = await pending;
    expect(firstResult.ok).toBe(true);

    const second = await signEvent(
      "https://a.example",
      unsignedEvent({ kind: 10002, content: "relay list again" })
    );
    expect(second.ok).toBe(true);
    expect(queue.count()).toBe(0);

    // The remembered decision stays scoped to kind 10002.
    const other = signEvent("https://a.example", unsignedEvent({ kind: 7 }));
    await vi.waitFor(() => expect(queue.count()).toBe(1));
    queue.resolve(queue.getNextPending()!.id, "deny");
    await other;
  });

  it("refuses a fractional kind before any policy or key work", async () => {
    const result = await signEvent(
      "https://a.example",
      unsignedEvent({ kind: 1.0000001 })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_EVENT);
    }
    expect(queue.count()).toBe(0);
    expect(sign).not.toHaveBeenCalled();
  });

  it("stops auto-signing once a session grant expires", async () => {
    await policy.setOriginPolicy("https://a.example", { trustLevel: "low" });
    await policy.setSessionGrant("https://a.example", true);

    const granted = await signEvent("https://a.example", unsignedEvent({ kind: 7 }));
    expect(granted.ok).toBe(true);
    expect(queue.count()).toBe(0);

    await storage.session.set("sessionGrants", {
      "https://a.example": Date.now() - 1000,
    });

    const pending = signEvent("https://a.example", unsignedEvent({ kind: 7 }));
    await vi.waitFor(() => expect(queue.count()).toBe(1));
    queue.resolve(queue.getNextPending()!.id, "deny");
    const refused = await pending;
    expect(refused.ok).toBe(false);
  });
});

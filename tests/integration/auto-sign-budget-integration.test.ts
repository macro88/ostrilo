import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import { ApprovalRpcHandler } from "@/infrastructure/messaging/handlers/approval-rpc";
import {
  ApprovalQueueService,
  QUEUE_LIMITS,
} from "@/application/services/approval-queue.service";
import {
  AUTO_SIGN_BUDGET,
  AutoSignBudgetService,
} from "@/application/services/auto-sign-budget.service";
import { PolicyService } from "@/application/services/policy.service";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { StorageSuite } from "@/application/ports/storage";
import { memoryStorage } from "../helpers/vault";

/**
 * The auto-sign budget, end to end: the real policy service, approval queue,
 * budget and NIP-07 handler, with only the vault and the activity log stubbed.
 *
 * What matters is what the PAGE and the USER see: a trusted site signs silently
 * up to its budget, is asked (never refused) beyond it, and gets the queue's own
 * canonical rate-limit error only when the queue itself is full.
 */

const PUBKEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const SITE = "https://trusted.example";

function reaction(n: number) {
  return { kind: 7, content: "+", tags: [], created_at: 1_700_000_000 + n };
}

interface Harness {
  storage: StorageSuite;
  policy: PolicyService;
  queue: ApprovalQueueService;
  budget: AutoSignBudgetService;
  nostr: NostrRpcHandler;
  approval: ApprovalRpcHandler;
  context: ServiceContext;
  sign: ReturnType<typeof vi.fn>;
  openWindow: ReturnType<typeof vi.fn>;
  isKeyUnreadable: ReturnType<typeof vi.fn>;
}

/** A worker's worth of services over `storage`, as background.ts composes them. */
function startWorker(storage: StorageSuite, policy: PolicyService): Harness {
  const queue = new ApprovalQueueService(undefined, storage.session);
  const budget = new AutoSignBudgetService(undefined, storage.session);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const sign = vi
    .fn()
    .mockResolvedValue({ sigHex: "a".repeat(128), keyId: "key-1" });
  const isKeyUnreadable = vi.fn().mockReturnValue(false);
  const context = {
    vault: {
      getLockState: vi.fn().mockResolvedValue({ isLocked: false }),
      isKeyUnreadable,
      listKeys: vi
        .fn()
        .mockResolvedValue([{ id: "key-1", pubkey: PUBKEY, isSelected: true }]),
      sign,
    },
    policy,
    activityLog: { addEntry: vi.fn().mockResolvedValue(undefined) },
    autoSignBudget: budget,
    settings: { get: vi.fn(), update: vi.fn() },
  } as unknown as ServiceContext;
  return {
    storage,
    policy,
    queue,
    budget,
    nostr: new NostrRpcHandler(queue, openWindow),
    approval: new ApprovalRpcHandler(queue),
    context,
    sign,
    openWindow,
    isKeyUnreadable,
  };
}

describe("auto-sign budget", () => {
  let h: Harness;

  const signEvent = (n: number, origin = SITE) =>
    h.nostr.handleRequest(
      { type: "nostr.signEvent", event: reaction(n), origin } as never,
      h.context
    );

  /** Spends the whole budget; every call must sign without a prompt. */
  async function spendBudget(origin = SITE) {
    for (let i = 0; i < AUTO_SIGN_BUDGET.perOriginPerWindow; i++) {
      const res = await signEvent(i, origin);
      expect(res.ok).toBe(true);
    }
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    const storage = memoryStorage();
    await storage.session.set("lockState", { isLocked: false });
    const policy = new PolicyService(storage);
    await policy.setOriginPolicy(SITE, { trustLevel: "high" });
    await policy.setOriginPolicy("https://other.example", {
      trustLevel: "high",
    });
    h = startWorker(storage, policy);
  });

  afterEach(() => {
    h.queue.clear();
    vi.useRealTimers();
  });

  it("signs the first 60 requests without a prompt", async () => {
    await spendBudget();

    expect(h.sign).toHaveBeenCalledTimes(60);
    expect(h.queue.count()).toBe(0);
    expect(h.openWindow).not.toHaveBeenCalled();
  });

  it("routes the 61st to the approval window, flagged, and signs nothing yet", async () => {
    await spendBudget();

    const pending = signEvent(61);
    await vi.waitFor(() => expect(h.queue.count()).toBe(1));

    expect(h.sign).toHaveBeenCalledTimes(60);
    expect(h.openWindow).toHaveBeenCalledTimes(1);
    const request = h.queue.getNextPending()!;
    expect(request.origin).toBe(SITE);
    expect(request.exceededAutoSignBudget).toBe(true);

    h.queue.resolve(request.id, "allow_once");
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(h.sign).toHaveBeenCalledTimes(61);
  });

  it("answers a refused over-budget request as a refusal by the user, not a rate limit", async () => {
    await spendBudget();

    const pending = signEvent(61);
    await vi.waitFor(() => expect(h.queue.count()).toBe(1));
    h.queue.resolve(h.queue.getNextPending()!.id, "deny");

    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.DENIED);
    }
  });

  it("does not flag a request an ordinary ask decision queued", async () => {
    const pending = h.nostr.handleRequest(
      {
        type: "nostr.signEvent",
        event: reaction(1),
        origin: "https://stranger.example",
      } as never,
      h.context
    );
    await vi.waitFor(() => expect(h.queue.count()).toBe(1));

    expect(h.queue.getNextPending()!.exceededAutoSignBudget).toBeUndefined();
    h.queue.resolve(h.queue.getNextPending()!.id, "deny");
    await pending;
  });

  it("auto-signs again once the window has rolled off", async () => {
    await spendBudget();
    vi.setSystemTime(Date.now() + AUTO_SIGN_BUDGET.windowMs);

    const res = await signEvent(100);

    expect(res.ok).toBe(true);
    expect(h.queue.count()).toBe(0);
    expect(h.sign).toHaveBeenCalledTimes(61);
  });

  it("meters each origin on its own", async () => {
    await spendBudget();

    const res = await signEvent(1, "https://other.example");

    expect(res.ok).toBe(true);
    expect(h.queue.count()).toBe(0);
  });

  it("gives the queue's own rate-limit error once the queue refuses the over-budget request", async () => {
    await spendBudget();

    const queued: Array<Promise<unknown>> = [];
    for (let i = 0; i < QUEUE_LIMITS.perOriginPending; i++) {
      queued.push(signEvent(1000 + i));
    }
    await vi.waitFor(() =>
      expect(h.queue.count()).toBe(QUEUE_LIMITS.perOriginPending)
    );

    const refused = await signEvent(2000);

    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.data.errorCode).toBe(RPC_ERROR_CODES.RATE_LIMITED);
    }
    expect(h.queue.count()).toBe(QUEUE_LIMITS.perOriginPending);

    h.queue.clear();
    await Promise.all(queued);
  });

  it("is not spent by a request refused for an unreadable key", async () => {
    h.isKeyUnreadable.mockReturnValue(true);
    for (let i = 0; i < AUTO_SIGN_BUDGET.perOriginPerWindow + 5; i++) {
      const res = await signEvent(i);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.VAULT_UNREADABLE);
      }
    }
    expect(h.queue.count()).toBe(0);

    h.isKeyUnreadable.mockReturnValue(false);
    await spendBudget();
    expect(h.queue.count()).toBe(0);
  });

  it("does not let a worker restart hand the origin a fresh budget", async () => {
    await spendBudget();
    await h.budget.settled();

    h = startWorker(h.storage, h.policy);
    const pending = signEvent(61);

    await vi.waitFor(() => expect(h.queue.count()).toBe(1));
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.queue.getNextPending()!.exceededAutoSignBudget).toBe(true);
    h.queue.resolve(h.queue.getNextPending()!.id, "deny");
    await pending;
  });

  it("does not let a worker restart reset the approval enqueue window", async () => {
    const answered: Array<Promise<unknown>> = [];
    for (let i = 0; i < QUEUE_LIMITS.perOriginPerWindow; i++) {
      answered.push(
        h.nostr.handleRequest(
          {
            type: "nostr.signEvent",
            event: { ...reaction(i), kind: 1 },
            origin: "https://stranger.example",
          } as never,
          h.context
        )
      );
      await vi.waitFor(() => expect(h.queue.count()).toBe(1));
      h.queue.resolve(h.queue.getNextPending()!.id, "deny");
    }
    await Promise.all(answered);
    await h.queue.settled();

    h = startWorker(h.storage, h.policy);
    const refused = await h.nostr.handleRequest(
      {
        type: "nostr.signEvent",
        event: { ...reaction(99), kind: 1 },
        origin: "https://stranger.example",
      } as never,
      h.context
    );

    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.data.errorCode).toBe(RPC_ERROR_CODES.RATE_LIMITED);
    }
    expect(h.queue.count()).toBe(0);
  });
});

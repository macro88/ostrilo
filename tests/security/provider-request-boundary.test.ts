import { describe, it, expect, beforeEach, vi } from "vitest";
import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import {
  ApprovalQueueService,
  QUEUE_LIMITS,
} from "@/application/services/approval-queue.service";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { MAX_EVENT_CONTENT_BYTES } from "@/infrastructure/validation/schemas";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";

// The handler touches browser.action to keep the toolbar badge in step. In
// Node there is no such API, and without this the whole approval path bails
// out into its "popup failed, deny" branch - which would make every test
// below pass for entirely the wrong reason.
vi.mock("wxt/browser", () => ({
  browser: {
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
    runtime: { id: "test", sendMessage: async () => {} },
    windows: { create: async () => ({ id: 1 }) },
  },
}));

/**
 * What a web page can make the extension do.
 *
 * The bridge between page and extension is built correctly - it refuses
 * cross-window messages, allowlists two methods, constructs the RpcRequest
 * itself and takes the origin from the content script rather than the page.
 * Everything AROUND that barrier was weaker than the barrier:
 *
 *  - `content` and `tags` had no size bound, so a page could make the service
 *    worker serialize and hash an arbitrarily large payload.
 *  - There was no rate limit, so a page could raise approval prompts as fast
 *    as it could call `signEvent`.
 *  - A locked vault caused the content script to ask the background to open
 *    the genuine password popup, so any page could summon the real master-
 *    password prompt on demand.
 */

const ORIGIN = "https://dapp.example";
const PUBKEY = "ab".repeat(32);

function makeContext(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    vault: {
      getLockState: async () => ({ isLocked: false }),
      listKeys: async () => [
        { id: "k1", pubkey: PUBKEY, isSelected: true, label: "k1" },
      ],
      sign: async () => ({ sigHex: "cd".repeat(32) }),
    },
    policy: { evaluate: async () => ({ mode: "ask" as const }) },
    activityLog: { addEntry: async () => {} },
    ...overrides,
  } as unknown as ServiceContext;
}

const event = (overrides: Record<string, unknown> = {}) => ({
  kind: 1,
  content: "gm",
  tags: [] as string[][],
  created_at: 1_735_689_600,
  ...overrides,
});

describe("oversized events are refused before any work is done", () => {
  let queue: ApprovalQueueService;
  let handler: NostrRpcHandler;
  let openedWindows: number;

  beforeEach(() => {
    queue = new ApprovalQueueService();
    openedWindows = 0;
    handler = new NostrRpcHandler(queue, async () => {
      openedWindows++;
      return 1;
    });
  });

  it("returns invalid_event and never enqueues or opens a window", async () => {
    const res = await handler.handleRequest(
      {
        type: "nostr.signEvent",
        origin: ORIGIN,
        event: event({ content: "a".repeat(MAX_EVENT_CONTENT_BYTES + 1) }),
      } as never,
      makeContext()
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_EVENT);
    }
    expect(
      queue.count(),
      "SECURITY REGRESSION: an oversized event occupied a queue slot"
    ).toBe(0);
    expect(
      openedWindows,
      "SECURITY REGRESSION: an oversized event opened an approval window"
    ).toBe(0);
  });

  it("refuses before the lock check, so it does not depend on vault state", async () => {
    const lockedContext = makeContext({
      vault: {
        getLockState: async () => ({ isLocked: true }),
        listKeys: async () => [],
      },
    });

    const res = await handler.handleRequest(
      {
        type: "nostr.signEvent",
        origin: ORIGIN,
        event: event({ content: "a".repeat(MAX_EVENT_CONTENT_BYTES + 1) }),
      } as never,
      lockedContext
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      // Validation comes first, so the size is the reported problem.
      expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_EVENT);
    }
  });
});

describe("a flooding origin is rate limited, not merely slow", () => {
  it("returns rate_limited once the origin is over its allowance", async () => {
    const queue = new ApprovalQueueService();
    const handler = new NostrRpcHandler(queue, async () => 1);
    const context = makeContext();

    // Fill the origin's pending capacity. Each of these is left unresolved,
    // which is what a hostile page does.
    const inflight: Array<Promise<unknown>> = [];
    for (let i = 0; i < QUEUE_LIMITS.perOriginPending; i++) {
      inflight.push(
        handler.handleRequest(
          {
            type: "nostr.signEvent",
            origin: ORIGIN,
            event: event({ content: `note ${i}` }),
          } as never,
          context
        )
      );
    }
    await vi.waitFor(() => expect(queue.count()).toBe(QUEUE_LIMITS.perOriginPending));

    const refused = await handler.handleRequest(
      {
        type: "nostr.signEvent",
        origin: ORIGIN,
        event: event({ content: "one too many" }),
      } as never,
      context
    );

    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(
        refused.error.data.errorCode,
        "SECURITY REGRESSION: a flooding origin got a retryable error instead of rate_limited"
      ).toBe(RPC_ERROR_CODES.RATE_LIMITED);
    }

    queue.clear();
    await Promise.allSettled(inflight);
  });
});

describe("a locked vault opens nothing", () => {
  it("returns locked without creating any window", async () => {
    const queue = new ApprovalQueueService();
    let openedWindows = 0;
    const handler = new NostrRpcHandler(queue, async () => {
      openedWindows++;
      return 1;
    });

    const res = await handler.handleRequest(
      { type: "nostr.signEvent", origin: ORIGIN, event: event() } as never,
      makeContext({
        vault: {
          getLockState: async () => ({ isLocked: true }),
          listKeys: async () => [],
        },
      })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.LOCKED);
    }
    expect(
      openedWindows,
      "SECURITY REGRESSION: a page-originated request opened an extension window while locked"
    ).toBe(0);
    expect(queue.count()).toBe(0);
  });

  it("refuses getPublicKey the same way", async () => {
    const handler = new NostrRpcHandler();
    const res = await handler.handleRequest(
      { type: "nostr.getPublicKey" } as never,
      makeContext({
        vault: {
          getLockState: async () => ({ isLocked: true }),
          listKeys: async () => [],
        },
      })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.LOCKED);
    }
  });
});

describe("the bound signing key travels with the request", () => {
  it("records the key that will sign, on the queue entry", async () => {
    const queue = new ApprovalQueueService();
    const handler = new NostrRpcHandler(queue, async () => 1);

    const inflight = handler.handleRequest(
      {
        type: "nostr.signEvent",
        origin: ORIGIN,
        event: event(),
        clientRequestId: "client-1",
      } as never,
      makeContext()
    );

    await vi.waitFor(() => expect(queue.count()).toBe(1));
    const pending = queue.getNextPending()!;

    expect(
      pending.signingPubkey,
      "the dialog must be able to show the key that will actually sign"
    ).toBe(PUBKEY);
    expect(pending.clientRequestId).toBe("client-1");

    queue.clear();
    await inflight;
  });

  it("cancels through the id the page supplied", async () => {
    const queue = new ApprovalQueueService();
    const handler = new NostrRpcHandler(queue, async () => 1);
    const context = makeContext();

    const inflight = handler.handleRequest(
      {
        type: "nostr.signEvent",
        origin: ORIGIN,
        event: event(),
        clientRequestId: "client-1",
      } as never,
      context
    );
    await vi.waitFor(() => expect(queue.count()).toBe(1));

    const cancelled = await handler.handleRequest(
      {
        type: "nostr.cancelRequest",
        origin: ORIGIN,
        clientRequestId: "client-1",
      } as never,
      context
    );

    expect(cancelled.ok).toBe(true);
    expect(queue.count()).toBe(0);

    // The signing request resolves as a denial, not as a signature.
    const result = await inflight;
    expect(result.ok).toBe(false);
  });
});

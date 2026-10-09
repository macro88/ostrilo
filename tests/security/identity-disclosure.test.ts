import { beforeEach, describe, expect, it, vi } from "vitest";
import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import {
  DisclosureRateLimitService,
  DISCLOSURE_RATE_LIMITS,
} from "@/application/services/disclosure-rate-limit.service";
import type { ActivityLogEntry } from "@/domain/types";

/**
 * `nostr.getPublicKey` had no origin, no rate limit and no audit entry. The
 * message type carried no fields at all (`rpc.ts:70`), the content script built
 * it without the origin it had already computed for `signEvent`, and the
 * dispatcher dropped the message before the handler saw it — so the handler
 * could not know who was asking even if it had wanted to.
 *
 * The harm is linkage, not secrecy. The npub is published on relays and this
 * extension publishes it there itself. What these tests protect is the user's
 * ability to know which sites tied their browsing to that identity, and the
 * bound on how fast a page may sample it.
 */

const PUBKEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

let logged: Array<Omit<ActivityLogEntry, "id" | "timestamp">>;
let rateLimit: DisclosureRateLimitService;
let recorded: Map<string, "allow" | "deny">;
let now: number;

/**
 * `consent` seeds the RECORDED decision for `https://example.com` and friends.
 * Tests about origin binding, rate limiting and logging pass `"allow"` so the
 * consent gate does not stand between them and what they are measuring; the
 * gate has its own block below.
 */
function makeContext(
  overrides: Record<string, unknown> = {},
  consent?: "allow" | "deny"
): ServiceContext {
  if (consent) {
    for (const origin of [
      "https://example.com",
      "https://poll.example",
      "https://greedy.example",
      "https://polite.example",
      "https://flood.example",
    ]) {
      recorded.set(origin, consent);
    }
  }
  return {
    vault: {
      getLockState: async () => ({ isLocked: false }),
      isKeyUnreadable: () => false,
      listKeys: async () => [
        { id: "k1", pubkey: PUBKEY, isSelected: true, label: "k1" },
      ],
    },
    policy: {
      evaluate: async () => ({ mode: "ask" as const }),
      getIdentityDisclosure: async (origin: string) => recorded.get(origin),
      setIdentityDisclosure: async (
        origin: string,
        mode: "allow" | "deny"
      ) => {
        recorded.set(origin, mode);
      },
    },
    activityLog: {
      addEntry: async (entry: Omit<ActivityLogEntry, "id" | "timestamp">) => {
        logged.push(entry);
      },
    },
    disclosureRateLimit: rateLimit,
    ...overrides,
  } as unknown as ServiceContext;
}

/** A context whose origins have already consented. */
const consented = (overrides: Record<string, unknown> = {}) =>
  makeContext(overrides, "allow");

const ask = (origin: unknown) =>
  ({ type: "nostr.getPublicKey", origin }) as never;

beforeEach(() => {
  logged = [];
  recorded = new Map();
  now = 1_735_689_600_000;
  rateLimit = new DisclosureRateLimitService(() => now);
});

describe("the public key request carries the page origin", () => {
  it("refuses a request with no origin", async () => {
    const handler = new NostrRpcHandler();

    const res = await handler.handleRequest(
      { type: "nostr.getPublicKey" } as never,
      makeContext()
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_ORIGIN);
    }
  });

  it("refuses a malformed origin", async () => {
    const handler = new NostrRpcHandler();

    const res = await handler.handleRequest(
      ask("not-a-url"),
      makeContext()
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_ORIGIN);
    }
  });

  it("discloses no key when the origin is rejected", async () => {
    const handler = new NostrRpcHandler();

    const res = await handler.handleRequest(ask(undefined), makeContext());

    expect(JSON.stringify(res)).not.toContain(PUBKEY);
  });

  it("answers a valid origin", async () => {
    const handler = new NostrRpcHandler();

    const res = await handler.handleRequest(
      ask("https://example.com"),
      consented()
    );

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ pubkey: PUBKEY });
  });
});

describe("the lock gate answers before anything per-origin", () => {
  it("returns locked and writes no disclosure entry", async () => {
    const handler = new NostrRpcHandler();

    const res = await handler.handleRequest(
      ask("https://example.com"),
      makeContext({
        vault: {
          getLockState: async () => ({ isLocked: true }),
          listKeys: async () => [],
        },
      })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.LOCKED);
    expect(logged).toHaveLength(0);
  });

  it("does not charge a locked request against the origin's allowance", async () => {
    const handler = new NostrRpcHandler();
    const locked = makeContext({
      vault: {
        getLockState: async () => ({ isLocked: true }),
        listKeys: async () => [],
      },
    });

    for (let i = 0; i < DISCLOSURE_RATE_LIMITS.perOriginPerWindow * 2; i++) {
      await handler.handleRequest(ask("https://example.com"), locked);
    }

    // A page hammering a locked vault must not be able to spend the allowance
    // the user's own next unlock will need.
    const afterUnlock = await handler.handleRequest(
      ask("https://example.com"),
      consented()
    );
    expect(afterUnlock.ok).toBe(true);
  });
});

describe("a polling origin is refused", () => {
  it("refuses once the allowance is exhausted", async () => {
    const handler = new NostrRpcHandler();
    const context = consented();

    for (let i = 0; i < DISCLOSURE_RATE_LIMITS.perOriginPerWindow; i++) {
      const ok = await handler.handleRequest(ask("https://poll.example"), context);
      expect(ok.ok).toBe(true);
    }

    const refused = await handler.handleRequest(
      ask("https://poll.example"),
      context
    );

    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.data.errorCode).toBe(RPC_ERROR_CODES.RATE_LIMITED);
    }
    expect(
      JSON.stringify(refused),
      "SECURITY REGRESSION: a rate-limited request still disclosed the public key"
    ).not.toContain(PUBKEY);
  });

  it("does not read the vault once an origin is over its allowance", async () => {
    const handler = new NostrRpcHandler();
    const listKeys = vi.fn().mockResolvedValue([
      { id: "k1", pubkey: PUBKEY, isSelected: true, label: "k1" },
    ]);
    const context = consented({
      vault: {
        getLockState: async () => ({ isLocked: false }),
        isKeyUnreadable: () => false,
        listKeys,
      },
    });

    for (let i = 0; i < DISCLOSURE_RATE_LIMITS.perOriginPerWindow + 3; i++) {
      await handler.handleRequest(ask("https://poll.example"), context);
    }

    // The limit is charged BEFORE the key is read, so a polling origin cannot
    // spend the vault's work on every call.
    expect(listKeys).toHaveBeenCalledTimes(
      DISCLOSURE_RATE_LIMITS.perOriginPerWindow
    );
  });

  it("bounds one origin without affecting another", async () => {
    const handler = new NostrRpcHandler();
    const context = consented();

    for (let i = 0; i < DISCLOSURE_RATE_LIMITS.perOriginPerWindow + 1; i++) {
      await handler.handleRequest(ask("https://greedy.example"), context);
    }

    const other = await handler.handleRequest(
      ask("https://polite.example"),
      context
    );

    expect(other.ok).toBe(true);
  });

  it("lets the allowance recover when the window elapses", async () => {
    const handler = new NostrRpcHandler();
    const context = consented();

    for (let i = 0; i < DISCLOSURE_RATE_LIMITS.perOriginPerWindow + 1; i++) {
      await handler.handleRequest(ask("https://poll.example"), context);
    }

    now += DISCLOSURE_RATE_LIMITS.windowMs + 1;

    const afterWindow = await handler.handleRequest(
      ask("https://poll.example"),
      context
    );
    expect(afterWindow.ok).toBe(true);
  });
});

describe("every outcome reaches the activity log", () => {
  it("records an allowed disclosure against its origin", async () => {
    const handler = new NostrRpcHandler();

    await handler.handleRequest(ask("https://example.com"), consented());

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      origin: "https://example.com",
      operation: "identity_disclosure",
      decision: "allow",
    });
  });

  it("records a rate-limited refusal, and says why", async () => {
    const handler = new NostrRpcHandler();
    const context = consented();

    for (let i = 0; i < DISCLOSURE_RATE_LIMITS.perOriginPerWindow + 1; i++) {
      await handler.handleRequest(ask("https://poll.example"), context);
    }

    const refusals = logged.filter((e) => e.decision === "deny");
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      origin: "https://poll.example",
      operation: "identity_disclosure",
      reason: "rate_limited",
    });
  });

  it("is distinguishable from a signing entry", async () => {
    const handler = new NostrRpcHandler();

    await handler.handleRequest(ask("https://example.com"), consented());

    // A signing entry carries a kind and no operation; a disclosure carries an
    // operation and no kind. Reading the log must not require guessing.
    expect(logged[0].operation).toBe("identity_disclosure");
    expect(logged[0].kind).toBeUndefined();
  });

  it("never writes the public key into a free-text field", async () => {
    const handler = new NostrRpcHandler();

    await handler.handleRequest(ask("https://example.com"), consented());

    expect(logged[0].contentPreview).toBeUndefined();
    expect(
      JSON.stringify(logged[0]),
      "the activity log recorded the public key itself, not just the record id"
    ).not.toContain(PUBKEY);
    // The origin is recorded verbatim: a truncated or prettified origin is not
    // evidence of who asked.
    expect(logged[0].origin).toBe("https://example.com");
  });
});

describe("a disclosure flood cannot crowd out a signature", () => {
  it("enqueues no approval request for any disclosure outcome", async () => {
    const enqueue = vi.fn();
    const handler = new NostrRpcHandler({ enqueue } as never, async () => 1);
    const context = consented();

    for (let i = 0; i < DISCLOSURE_RATE_LIMITS.perOriginPerWindow + 5; i++) {
      await handler.handleRequest(ask("https://flood.example"), context);
    }

    // Phase 1 has no prompt, so this is the strongest form of the property:
    // the disclosure path never touches the approval queue at all, and so
    // cannot consume the per-origin or global capacity a pending signature
    // from another origin needs.
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("keeps its counters out of the approval queue's", async () => {
    const handler = new NostrRpcHandler();
    const context = consented();

    for (let i = 0; i < DISCLOSURE_RATE_LIMITS.perOriginPerWindow + 1; i++) {
      await handler.handleRequest(ask("https://flood.example"), context);
    }

    // The limiter is its own service, constructed independently of
    // ApprovalQueueService, so exhausting it says nothing about queue capacity.
    expect(rateLimit.isAllowed("https://flood.example")).toBe(false);
    expect(rateLimit.isAllowed("https://other.example")).toBe(true);
  });
});

describe("public key disclosure requires per-origin consent", () => {
  /** A queue stub whose prompt answers with `decision`. */
  function queueAnswering(
    decision: "allow" | "deny",
    options: { timedOut?: boolean } = {}
  ) {
    const enqueued: Array<{ origin: string }> = [];
    return {
      enqueued,
      queue: {
        enqueueDisclosure: (
          origin: string,
          resolver: (d: string, a: string) => void
        ) => {
          enqueued.push({ origin });
          const request = { id: `req-${enqueued.length}`, origin };
          queueMicrotask(() => resolver(decision, decision));
          return request;
        },
        wasTimeout: () => options.timedOut ?? false,
        resolve: () => true,
      },
    };
  }

  it("prompts an origin with no recorded decision", async () => {
    const { queue, enqueued } = queueAnswering("allow");
    const handler = new NostrRpcHandler(queue as never, async () => 1);

    const res = await handler.handleRequest(
      ask("https://unknown.example"),
      makeContext()
    );

    expect(enqueued).toEqual([{ origin: "https://unknown.example" }]);
    expect(res.ok).toBe(true);
  });

  it("returns the key once the user approves", async () => {
    const { queue } = queueAnswering("allow");
    const handler = new NostrRpcHandler(queue as never, async () => 1);

    const res = await handler.handleRequest(
      ask("https://unknown.example"),
      makeContext()
    );

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ pubkey: PUBKEY });
  });

  it("refuses with a disclosure-specific code, not `denied`", async () => {
    const { queue } = queueAnswering("deny");
    const handler = new NostrRpcHandler(queue as never, async () => 1);

    const res = await handler.handleRequest(
      ask("https://unknown.example"),
      makeContext()
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      // A client must be able to tell a refused IDENTITY from a refused
      // SIGNATURE: retrying makes sense for one and not the other.
      expect(res.error.data.errorCode).toBe(
        RPC_ERROR_CODES.DISCLOSURE_REFUSED
      );
      expect(res.error.data.errorCode).not.toBe(RPC_ERROR_CODES.DENIED);
    }
    expect(JSON.stringify(res)).not.toContain(PUBKEY);
  });

  it("returns timeout when the prompt expires", async () => {
    const { queue } = queueAnswering("deny", { timedOut: true });
    const handler = new NostrRpcHandler(queue as never, async () => 1);

    const res = await handler.handleRequest(
      ask("https://unknown.example"),
      makeContext()
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.TIMEOUT);
    expect(JSON.stringify(res)).not.toContain(PUBKEY);
  });

  it("never answers an unconsented origin without a decision", async () => {
    // No approval queue configured at all: the gate must fail closed rather
    // than fall through to the key.
    const handler = new NostrRpcHandler();

    const res = await handler.handleRequest(
      ask("https://tracker.example"),
      makeContext()
    );

    expect(res.ok).toBe(false);
    expect(
      JSON.stringify(res),
      "SECURITY REGRESSION: an unconsented origin read the public key silently"
    ).not.toContain(PUBKEY);
  });

  it("answers a remembered allow without prompting", async () => {
    const { queue, enqueued } = queueAnswering("deny");
    const handler = new NostrRpcHandler(queue as never, async () => 1);
    recorded.set("https://known.example", "allow");

    const res = await handler.handleRequest(
      ask("https://known.example"),
      makeContext()
    );

    expect(res.ok).toBe(true);
    expect(enqueued).toHaveLength(0);
  });

  it("logs an auto-allowed read from a remembered grant", async () => {
    const handler = new NostrRpcHandler();
    recorded.set("https://known.example", "allow");

    await handler.handleRequest(ask("https://known.example"), makeContext());

    // The point of the log is that the user sees EVERY read, not only the ones
    // they were asked about.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      origin: "https://known.example",
      operation: "identity_disclosure",
      decision: "allow",
      reason: "remembered",
    });
  });

  it("refuses a remembered deny without opening a window", async () => {
    const { queue, enqueued } = queueAnswering("allow");
    const openWindow = vi.fn(async () => 1);
    const handler = new NostrRpcHandler(queue as never, openWindow);
    recorded.set("https://refused.example", "deny");

    const res = await handler.handleRequest(
      ask("https://refused.example"),
      makeContext()
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.data.errorCode).toBe(
        RPC_ERROR_CODES.DISCLOSURE_REFUSED
      );
    }
    // Without the remembered denial, any https origin could re-summon a focused
    // OS window on every page load.
    expect(enqueued).toHaveLength(0);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("cannot be made to re-summon the prompt by reloading", async () => {
    const { queue, enqueued } = queueAnswering("allow");
    const openWindow = vi.fn(async () => 1);
    const handler = new NostrRpcHandler(queue as never, openWindow);
    recorded.set("https://refused.example", "deny");
    const context = makeContext();

    for (let i = 0; i < 20; i++) {
      await handler.handleRequest(ask("https://refused.example"), context);
    }

    expect(enqueued).toHaveLength(0);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("scopes a grant to one origin", async () => {
    const { queue, enqueued } = queueAnswering("allow");
    const handler = new NostrRpcHandler(queue as never, async () => 1);
    recorded.set("https://known.example", "allow");

    await handler.handleRequest(ask("https://other.example"), makeContext());

    expect(enqueued).toEqual([{ origin: "https://other.example" }]);
  });

  it("grants nothing by migration, whatever the stored record says", async () => {
    const { queue, enqueued } = queueAnswering("allow");
    const handler = new NostrRpcHandler(queue as never, async () => 1);
    const context = makeContext();

    // An origin with a stored policy record of any shape — including one
    // written BY A REMEMBERED DENIAL, which looks identical to one written by
    // an approval. `identityDisclosure` is absent, and absent is not consent.
    await handler.handleRequest(ask("https://legacy.example"), context);

    expect(enqueued).toEqual([{ origin: "https://legacy.example" }]);
  });
});

describe("a locked vault never reaches the consent gate", () => {
  it("neither prompts nor persists a decision", async () => {
    const { queue, enqueued } = queueStub();
    const handler = new NostrRpcHandler(queue as never, async () => 1);

    const res = await handler.handleRequest(
      ask("https://example.com"),
      makeContext({
        vault: {
          getLockState: async () => ({ isLocked: true }),
          listKeys: async () => [],
        },
      })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.LOCKED);
    expect(enqueued).toHaveLength(0);
    expect(recorded.size).toBe(0);
  });

  function queueStub() {
    const enqueued: string[] = [];
    return {
      enqueued,
      queue: {
        enqueueDisclosure: (origin: string) => {
          enqueued.push(origin);
          return { id: "x", origin };
        },
        wasTimeout: () => false,
        resolve: () => true,
      },
    };
  }
});

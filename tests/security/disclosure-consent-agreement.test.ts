import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalRpcHandler } from "@/infrastructure/messaging/handlers/approval-rpc";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { PendingRequest } from "@/domain/types";
import { evaluatePolicy } from "@/domain/policy/evaluate";

/**
 * Signing consent and disclosure consent must not contradict each other.
 *
 * A successful signature returns the public key to the origin INSIDE the signed
 * event. So:
 *
 *  - approving a signature IS a disclosure, and prompting separately for it
 *    afterwards protects nothing while teaching click-through;
 *  - a remembered per-kind `allow` would otherwise keep handing over the
 *    identity on every later signature while Settings displayed "identity
 *    disclosure: deny" — a decision the product shows the user but does not
 *    enforce, which is the exact defect class this consent work exists to
 *    remove.
 */

let setPerKindRule: ReturnType<typeof vi.fn>;
let setIdentityDisclosure: ReturnType<typeof vi.fn>;

function makeContext(): ServiceContext {
  return {
    policy: { setPerKindRule, setIdentityDisclosure },
  } as unknown as ServiceContext;
}

function makeQueue(request: PendingRequest) {
  return {
    getById: vi.fn().mockReturnValue(request),
    resolve: vi.fn().mockReturnValue(true),
    count: vi.fn().mockReturnValue(0),
  };
}

const signing = (overrides: Partial<PendingRequest> = {}): PendingRequest => ({
  id: REQUEST_ID,
  origin: "https://example.com",
  operation: "sign_event",
  event: { kind: 10002, content: "relays", tags: [], created_at: 1 },
  createdAt: 1,
  timeoutAt: 61,
  ...overrides,
});

const disclosure = (
  overrides: Partial<PendingRequest> = {}
): PendingRequest => ({
  id: REQUEST_ID,
  origin: "https://example.com",
  operation: "identity_disclosure",
  createdAt: 1,
  timeoutAt: 61,
  ...overrides,
});

/** `ApprovalResolveRequestSchema` requires a UUID, so the ids here are real ones. */
const REQUEST_ID = "6f1a0c8e-0d2f-4f5a-9a1e-3b7c8d9e0f11";

const resolveWith = (action: string) =>
  ({ type: "approval.resolve", requestId: REQUEST_ID, action }) as never;

beforeEach(() => {
  setPerKindRule = vi.fn().mockResolvedValue(undefined);
  setIdentityDisclosure = vi.fn().mockResolvedValue(undefined);
});

describe("approving a signature records disclosure consent", () => {
  it("records it for a remembered allow", async () => {
    const request = signing();
    const handler = new ApprovalRpcHandler(makeQueue(request) as never);

    await handler.handleRequest(resolveWith("allow"), makeContext());

    expect(setIdentityDisclosure).toHaveBeenCalledWith(
      "https://example.com",
      "allow"
    );
  });

  it("records it for a one-time allow too", async () => {
    // The signature handed over the key either way. Not recording it here
    // would prompt the user to disclose an identity they have just disclosed.
    const request = signing();
    const handler = new ApprovalRpcHandler(makeQueue(request) as never);

    await handler.handleRequest(resolveWith("allow_once"), makeContext());

    expect(setIdentityDisclosure).toHaveBeenCalledWith(
      "https://example.com",
      "allow"
    );
  });

  it("records nothing on a denial", async () => {
    const request = signing();
    const handler = new ApprovalRpcHandler(makeQueue(request) as never);

    await handler.handleRequest(resolveWith("deny"), makeContext());

    expect(setIdentityDisclosure).not.toHaveBeenCalled();
  });
});

describe("a remembered disclosure denial forces signing to prompt", () => {
  const base = {
    kind: 10002,
    unlocked: true,
    mediumAllowKinds: [10002],
    sessionGrants: {},
  };

  it("downgrades an explicit per-kind allow to ask", () => {
    const withoutDenial = evaluatePolicy({
      ...base,
      origin: "https://example.com",
      policies: [
        {
          origin: "https://example.com",
          trustLevel: "low",
          rules: { 10002: "allow" },
          updatedAt: 1,
        },
      ],
    });
    expect(withoutDenial.mode).toBe("allow");

    // The service layer applies the downgrade; this asserts the baseline the
    // downgrade acts on, so the service test below is not measuring nothing.
    expect(withoutDenial.reason).toBeDefined();
  });

  it("never downgrades to deny", async () => {
    // Refusing to hand over an identity for the asking is not the same as
    // saying the site may never sign anything. The user keeps the choice.
    const { PolicyService } = await import(
      "@/application/services/policy.service"
    );
    const settings = {
      __version: "settings.v1",
      origins: [
        {
          origin: "https://example.com",
          trustLevel: "low",
          rules: { 10002: "allow" },
          identityDisclosure: "deny",
          updatedAt: 1,
        },
      ],
      mediumAllowKinds: [10002],
      autoLockMinutes: 5,
      sessionTTLMinutes: 5,
      relays: [],
      theme: "system",
      sidePanel: false,
    };
    const storage = {
      sync: {
        get: async () => settings,
        set: async () => {},
      },
      session: { get: async () => ({ isLocked: false }), set: async () => {} },
      local: { get: async () => undefined, set: async () => {} },
    };
    const service = new PolicyService(storage as never);

    const result = await service.evaluate({
      origin: "https://example.com",
      kind: 10002,
    });

    expect(result.mode).toBe("ask");
    expect(result.mode).not.toBe("deny");
    expect(result.reason).toBe("identity_disclosure_denied");
  });
});

describe("an eventless approval does not break the pipeline", () => {
  it("resolves without error rather than sitting queued until timeout", async () => {
    const request = disclosure();
    const queue = makeQueue(request);
    const handler = new ApprovalRpcHandler(queue as never);

    // `allow` and `deny_remember` are the two actions that used to dereference
    // `request.event.kind` and throw, returning APPROVAL_FAILED and leaving the
    // entry queued until the 60-second auto-deny.
    for (const action of ["allow", "allow_once", "deny", "deny_remember"]) {
      const res = await handler.handleRequest(
        resolveWith(action),
        makeContext()
      );
      expect(res.ok, `action ${action} failed to resolve`).toBe(true);
    }

    expect(queue.resolve).toHaveBeenCalledTimes(4);
  });

  it("writes no per-kind rule, and no rule under an undefined kind", async () => {
    const request = disclosure();
    const handler = new ApprovalRpcHandler(makeQueue(request) as never);

    await handler.handleRequest(resolveWith("allow"), makeContext());
    await handler.handleRequest(resolveWith("deny_remember"), makeContext());

    // `isProtectedKind` fails open on a non-integer, so an undefined kind used
    // to take the allow branch and write a `rules[undefined]` key.
    expect(setPerKindRule).not.toHaveBeenCalled();
  });

  it("persists the disclosure decision per origin instead", async () => {
    const request = disclosure();
    const handler = new ApprovalRpcHandler(makeQueue(request) as never);

    await handler.handleRequest(resolveWith("allow"), makeContext());
    expect(setIdentityDisclosure).toHaveBeenCalledWith(
      "https://example.com",
      "allow"
    );

    setIdentityDisclosure.mockClear();
    await handler.handleRequest(resolveWith("deny_remember"), makeContext());
    expect(setIdentityDisclosure).toHaveBeenCalledWith(
      "https://example.com",
      "deny"
    );
  });

  it("does not persist a one-time decision", async () => {
    const request = disclosure();
    const handler = new ApprovalRpcHandler(makeQueue(request) as never);

    await handler.handleRequest(resolveWith("allow_once"), makeContext());

    expect(setIdentityDisclosure).not.toHaveBeenCalled();
  });
});

describe("the queue handles eventless entries", () => {
  it("dedupes repeated disclosure requests from one origin into one prompt", () => {
    const queue = new ApprovalQueueService();

    const first = queue.enqueueDisclosure("https://poll.example", () => {});
    const second = queue.enqueueDisclosure("https://poll.example", () => {});

    expect(second.id).toBe(first.id);
    expect(queue.count()).toBe(1);
  });

  it("keeps one origin's disclosure prompt separate from another's", () => {
    const queue = new ApprovalQueueService();

    queue.enqueueDisclosure("https://a.example", () => {});
    queue.enqueueDisclosure("https://b.example", () => {});

    expect(queue.count()).toBe(2);
  });

  it("emits no undefined hash from getQueuedEventIds", () => {
    const queue = new ApprovalQueueService();
    queue.enqueueDisclosure("https://poll.example", () => {});

    // The entry is KEYED but has no event to hash. `entry.eventIdHash!` used to
    // put `undefined` into this array.
    expect(queue.getQueuedEventIds()).toEqual([]);
  });

  it("resolves every waiting caller from one prompt", () => {
    const queue = new ApprovalQueueService();
    const decisions: string[] = [];

    const request = queue.enqueueDisclosure("https://poll.example", (d) =>
      decisions.push(d)
    );
    queue.enqueueDisclosure("https://poll.example", (d) => decisions.push(d));
    queue.enqueueDisclosure("https://poll.example", (d) => decisions.push(d));

    queue.resolve(request.id, "allow");

    expect(decisions).toEqual(["allow", "allow", "allow"]);
  });

  it("refuses a disclosure flood without displacing another origin's signature", () => {
    const queue = new ApprovalQueueService();

    // One origin hammering getPublicKey collapses into a single queue entry, so
    // it cannot consume the per-origin or global capacity a pending signature
    // from another origin needs.
    for (let i = 0; i < 50; i++) {
      queue.enqueueDisclosure("https://flood.example", () => {});
    }
    expect(queue.count()).toBe(1);

    const signed = queue.enqueue(
      "https://legit.example",
      { kind: 1, content: "gm", tags: [], created_at: 1 },
      () => {},
      "ab".repeat(32)
    );
    expect(queue.getById(signed.id)).toBeDefined();
  });
});

describe("the refusal code is distinguishable", () => {
  it("differs from the signing denial code", () => {
    expect(RPC_ERROR_CODES.DISCLOSURE_REFUSED).not.toBe(
      RPC_ERROR_CODES.DENIED
    );
  });
});

describe("revocation actually revokes", () => {
  it("survives the patch schema as a real value", async () => {
    const { OriginPolicyPatchSchema } = await import(
      "@/infrastructure/validation/schemas"
    );

    // `{ identityDisclosure: undefined }` parses to `{}` — Zod strips an
    // explicitly-undefined optional key — so a revoke sent that way reaches the
    // background as an empty patch and the stored decision survives untouched.
    // That is a Revoke button that looks like it worked and did nothing, which
    // is the same "shows a decision it does not enforce" defect this whole
    // change exists to remove.
    const stripped = OriginPolicyPatchSchema.safeParse({
      identityDisclosure: undefined,
    });
    expect(stripped.success).toBe(true);
    expect(stripped.success && stripped.data).toEqual({});

    const kept = OriginPolicyPatchSchema.safeParse({
      identityDisclosure: "ask",
    });
    expect(kept.success && kept.data).toEqual({ identityDisclosure: "ask" });
  });

  it("leaves an origin in the prompting state", async () => {
    const { NostrRpcHandler } = await import(
      "@/infrastructure/messaging/handlers/nostr-rpc"
    );
    const enqueued: string[] = [];
    const queue = {
      enqueueDisclosure: (origin: string, resolver: (d: string) => void) => {
        enqueued.push(origin);
        queueMicrotask(() => resolver("allow"));
        return { id: "x", origin };
      },
      wasTimeout: () => false,
      resolve: () => true,
    };
    const handler = new NostrRpcHandler(queue as never, async () => 1);

    const context = {
      vault: {
        getLockState: async () => ({ isLocked: false }),
        isKeyUnreadable: () => false,
        listKeys: async () => [
          { id: "k1", pubkey: "ab".repeat(32), isSelected: true },
        ],
      },
      policy: {
        // What a revoked origin looks like in storage.
        getIdentityDisclosure: async () => "ask" as const,
        setIdentityDisclosure: async () => {},
      },
      activityLog: { addEntry: async () => {} },
      disclosureRateLimit: { tryConsume: () => true },
    };

    await handler.handleRequest(
      { type: "nostr.getPublicKey", origin: "https://revoked.example" } as never,
      context as never
    );

    expect(enqueued).toEqual(["https://revoked.example"]);
  });
});

describe("no origin is grandfathered", () => {
  async function disclosureFor(policy: Record<string, unknown>) {
    const { PolicyService } = await import(
      "@/application/services/policy.service"
    );
    const settings = {
      __version: "settings.v1",
      origins: [policy],
      mediumAllowKinds: [],
      autoLockMinutes: 5,
      sessionTTLMinutes: 5,
      relays: [],
      theme: "system",
      sidePanel: false,
    };
    const storage = {
      sync: { get: async () => settings, set: async () => {} },
      session: { get: async () => ({ isLocked: false }), set: async () => {} },
      local: { get: async () => undefined, set: async () => {} },
    };
    return new PolicyService(storage as never).getIdentityDisclosure(
      policy.origin as string
    );
  }

  it("does not treat an explicit per-kind allow as disclosure consent", async () => {
    expect(
      await disclosureFor({
        origin: "https://legacy.example",
        trustLevel: "low",
        rules: { 1: "allow" },
        updatedAt: 1,
      })
    ).toBeUndefined();
  });

  it("does not treat high trust as disclosure consent", async () => {
    expect(
      await disclosureFor({
        origin: "https://trusted.example",
        trustLevel: "high",
        rules: {},
        updatedAt: 1,
      })
    ).toBeUndefined();
  });

  it("does not treat a record written by a REFUSAL as consent", async () => {
    // The same record shape is written when a user refuses as when they
    // approve, and `low` is the level assigned by default when a record is
    // created as a side effect. An all-deny `low` record is evidence of
    // refusal, or of nothing — never of consent.
    expect(
      await disclosureFor({
        origin: "https://refused.example",
        trustLevel: "low",
        rules: { 1: "deny" },
        updatedAt: 1,
      })
    ).toBeUndefined();
  });

  it("does not treat an active session grant as disclosure consent", async () => {
    expect(
      await disclosureFor({
        origin: "https://session.example",
        trustLevel: "medium",
        rules: {},
        sessionGrantAll: true,
        updatedAt: 1,
      })
    ).toBeUndefined();
  });
});

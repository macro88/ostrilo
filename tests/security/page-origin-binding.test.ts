import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The background used to believe the page origin a `nostr.*` message named.
 *
 * The content script fills `origin` from `window.location.origin`, but nothing
 * compared it with the browser-attested `sender.url`, so code running in the
 * content-script process could speak for any site: read the identity a trusted
 * origin was granted, sign under its trust level, spend its rate limit, or
 * cancel its pending approval. The router now derives the origin from the
 * sender and refuses a disagreement before any service is reached.
 *
 * These tests drive the real listener, handlers and services, and read real
 * state afterwards.
 */

const RUNTIME_ID = "ostrilooriginbindingtestruntime0";

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "ostrilooriginbindingtestruntime0",
      getURL: (p: string) =>
        `chrome-extension://ostrilooriginbindingtestruntime0/${p.replace(/^\//, "")}`,
      sendMessage: async () => undefined,
    },
  },
}));

import { RpcRouter, createRpcMessageListener } from "@/infrastructure/messaging/rpc-router";
import { NostrRpcHandler } from "@/infrastructure/messaging/handlers";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { RpcResponse } from "@/infrastructure/messaging/rpc";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import {
  SECRET_ONE,
  STRONG_PASSWORD,
  errorCodeOf,
  realContext,
} from "../unit/infrastructure/messaging-fixture";

const TRUSTED = "https://trusted.example";
const ATTACKER = "https://attacker.example";

const pageSender = (origin: string) => ({
  id: RUNTIME_ID,
  tab: { id: 1 },
  frameId: 0,
  url: `${origin}/page`,
  origin,
});

const EVENT = { kind: 1, created_at: 1, tags: [], content: "hello" };

let listener: ReturnType<typeof createRpcMessageListener>;
let context: ServiceContext;
let queue: ApprovalQueueService;
let settingsSnapshot: () => Promise<string>;

function send(message: Record<string, unknown>, sender: unknown) {
  return new Promise<RpcResponse>((resolve) => {
    listener(message, sender, (r) => resolve(r));
  });
}

/** Everything per-origin the background could have touched, for both origins. */
async function perOriginState() {
  return {
    settings: await settingsSnapshot(),
    activity: await context.activityLog.getRecent(50),
    pending: queue.getAllPending().map((p) => [p.origin, p.operation]),
    trustedDisclosure: await context.policy.getIdentityDisclosure(TRUSTED),
    attackerDisclosure: await context.policy.getIdentityDisclosure(ATTACKER),
  };
}

beforeEach(async () => {
  queue = new ApprovalQueueService();
  const real = realContext();
  context = real.context;
  settingsSnapshot = async () =>
    JSON.stringify(await real.storage.sync.get("appSettings"));
  await real.vault.importKey(SECRET_ONE, STRONG_PASSWORD);
  await real.vault.unlock(STRONG_PASSWORD);

  const router = new RpcRouter();
  router.registerModule("nostr", new NostrRpcHandler(queue, async () => undefined));
  listener = createRpcMessageListener(router, context);
});

afterEach(() => {
  queue.clear();
  vi.restoreAllMocks();
});

describe("a claimed origin that disagrees with the sender", () => {
  it("cannot read the identity through getPublicKey", async () => {
    await context.policy.setIdentityDisclosure(TRUSTED, "allow");
    const consume = vi.spyOn(context.disclosureRateLimit, "tryConsume");
    const before = await perOriginState();

    const res = await send(
      { type: "nostr.getPublicKey", origin: TRUSTED },
      pageSender(ATTACKER)
    );

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_ORIGIN);
    expect(JSON.stringify(res)).not.toContain("79be667e");
    expect(consume, "no origin's rate limit may be charged").not.toHaveBeenCalled();
    expect(await perOriginState()).toEqual(before);
  });

  it("cannot queue a signature through signEvent", async () => {
    const before = await perOriginState();

    const res = await send(
      { type: "nostr.signEvent", origin: TRUSTED, event: EVENT },
      pageSender(ATTACKER)
    );

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_ORIGIN);
    expect(await perOriginState()).toEqual(before);
  });

  it("cannot cancel another origin's pending request", async () => {
    // A genuine request from the trusted origin, left waiting for the user.
    void send(
      { type: "nostr.signEvent", origin: TRUSTED, event: EVENT, clientRequestId: "r1" },
      pageSender(TRUSTED)
    );
    await vi.waitFor(() => expect(queue.count()).toBe(1));
    const before = await perOriginState();

    const res = await send(
      { type: "nostr.cancelRequest", origin: TRUSTED, clientRequestId: "r1" },
      pageSender(ATTACKER)
    );

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_ORIGIN);
    expect(queue.count()).toBe(1);
    expect(await perOriginState()).toEqual(before);
  });
});

describe("a matching origin", () => {
  it("reaches the handler with the attested origin", async () => {
    void send({ type: "nostr.getPublicKey", origin: TRUSTED }, pageSender(TRUSTED));

    await vi.waitFor(() => expect(queue.count()).toBe(1));
    expect(queue.getAllPending()[0]).toMatchObject({
      origin: TRUSTED,
      operation: "identity_disclosure",
    });
  });
});

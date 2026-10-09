import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: { getURL: (path: string) => `chrome-extension://ostrilo-test${path}` },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
  },
}));

import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import { ApprovalRpcHandler } from "@/infrastructure/messaging/handlers/approval-rpc";
import { PolicyRpcHandler } from "@/infrastructure/messaging/handlers/policy-rpc";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { RpcRequest, RpcResponse } from "@/infrastructure/messaging/rpc";
import type { KeyRecord, PendingRequest } from "@/domain/types";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import {
  PUBKEY_ONE,
  SECRET_ONE,
  SECRET_TWO,
  STRONG_PASSWORD,
  dataOf,
  errorCodeOf,
  realContext,
} from "../unit/infrastructure/messaging-fixture";

/**
 * A disclosure grant belongs to the key it was given for. These tests drive the
 * real handlers, queue, policy and vault, and switch keys the way the UI does
 * (`vault.selectKey`), because the defect was a grant that outlived the choice
 * of identity: consent for key A also answered for key B.
 */

const SITE = "https://site.example";
const OTHER = "https://other.example";
const askKey = (origin = SITE): RpcRequest => ({ type: "nostr.getPublicKey", origin });

let queue: ApprovalQueueService;
let context: ServiceContext;
let nostr: NostrRpcHandler;
let keyA: KeyRecord;
let keyB: KeyRecord;

const approvals = () => new ApprovalRpcHandler(queue);
const select = (key: KeyRecord) => context.vault.selectKey(key.id);

async function nextPending(): Promise<PendingRequest> {
  await vi.waitFor(() => expect(queue.count()).toBeGreaterThan(0));
  return queue.getNextPending()!;
}

async function resolve(request: PendingRequest, action: string) {
  return approvals().handleRequest(
    { type: "approval.resolve", requestId: request.id, action } as RpcRequest,
    context
  );
}

/** Ask, answer the prompt, and return the page's response. */
async function askAndAnswer(action: string, origin = SITE): Promise<RpcResponse> {
  const pending = nostr.handleRequest(askKey(origin), context);
  await resolve(await nextPending(), action);
  return pending;
}

/** Ask and require that nothing was queued: the answer came from stored consent. */
async function askSilently(origin = SITE): Promise<RpcResponse> {
  const res = await nostr.handleRequest(askKey(origin), context);
  expect(queue.count(), "a prompt was queued").toBe(0);
  return res;
}

/**
 * Ask and require that a prompt WAS queued - consent did not answer. The prompt
 * is then withdrawn, which refuses, so nothing is disclosed.
 */
async function expectAsks(origin = SITE): Promise<void> {
  const pending = nostr.handleRequest(askKey(origin), context);
  const request = await nextPending();
  expect(request.operation).toBe("identity_disclosure");
  expect(request.origin).toBe(origin);
  queue.clear();
  const res = await pending;
  expect(res.ok, "the key was disclosed with no decision").toBe(false);
}

beforeEach(async () => {
  queue = new ApprovalQueueService();
  const built = realContext();
  context = built.context;
  await built.vault.importKey(SECRET_ONE, STRONG_PASSWORD, "Main");
  await built.vault.importKey(SECRET_TWO, STRONG_PASSWORD, "Work");
  await built.vault.unlock(STRONG_PASSWORD);
  [keyA, keyB] = await built.vault.listKeys();
  await select(keyA);
  nostr = new NostrRpcHandler(queue, async () => 1);
});

afterEach(() => {
  queue.clear();
});

describe("consent follows the key it was given for", () => {
  it("grant for A, switch to B asks, switch back to A answers without asking", async () => {
    expect(dataOf(await askAndAnswer("allow"))).toEqual({ pubkey: keyA.pubkey });
    expect(dataOf(await askSilently())).toEqual({ pubkey: keyA.pubkey });

    await select(keyB);
    const pending = nostr.handleRequest(askKey(), context);
    const request = await nextPending();
    expect(request.operation).toBe("identity_disclosure");
    expect(request.signingPubkey).toBe(keyB.pubkey);
    expect(request.signingKeyId).toBe(keyB.id);
    await resolve(request, "deny");
    expect(errorCodeOf(await pending)).toBe(RPC_ERROR_CODES.DISCLOSURE_REFUSED);

    await select(keyA);
    expect(dataOf(await askSilently())).toEqual({ pubkey: keyA.pubkey });
  });

  it("a one-time approval for B grants nothing, for B or for A", async () => {
    await select(keyB);
    expect(dataOf(await askAndAnswer("allow_once"))).toEqual({ pubkey: keyB.pubkey });

    await expectAsks();
    await select(keyA);
    await expectAsks();
  });

  it("remembering B as well leaves both keys answering silently", async () => {
    await askAndAnswer("allow");
    await select(keyB);
    expect(dataOf(await askAndAnswer("allow"))).toEqual({ pubkey: keyB.pubkey });

    expect(dataOf(await askSilently())).toEqual({ pubkey: keyB.pubkey });
    await select(keyA);
    expect(dataOf(await askSilently())).toEqual({ pubkey: keyA.pubkey });
  });

  it("is per origin as well: a grant for A on one site does not answer another site", async () => {
    await askAndAnswer("allow");

    await expectAsks(OTHER);
  });
});

describe("a refusal stays per origin", () => {
  it("refuses every key without a prompt", async () => {
    await askAndAnswer("deny_remember");

    expect(errorCodeOf(await askSilently())).toBe(RPC_ERROR_CODES.DISCLOSURE_REFUSED);
    await select(keyB);
    expect(errorCodeOf(await askSilently())).toBe(RPC_ERROR_CODES.DISCLOSURE_REFUSED);
  });

  it("a remembered refusal replaces earlier key grants", async () => {
    await askAndAnswer("allow");
    await context.policy.setIdentityDisclosure(SITE, "deny");
    await context.policy.setIdentityDisclosure(SITE, "ask");

    await expectAsks();
  });
});

describe("a prompt is about one key", () => {
  it("a caller that arrives after a key switch gets its own prompt, not the old answer", async () => {
    const first = nostr.handleRequest(askKey(), context);
    const promptA = await nextPending();
    expect(promptA.signingKeyId).toBe(keyA.id);

    await select(keyB);
    const second = nostr.handleRequest(askKey(), context);
    await vi.waitFor(() => expect(queue.count()).toBe(2));
    const promptB = queue.getAllPending().find((p) => p.signingKeyId === keyB.id)!;
    expect(promptB.id).not.toBe(promptA.id);

    await resolve(promptA, "allow");
    expect(dataOf(await first)).toEqual({ pubkey: keyA.pubkey });
    expect(queue.count()).toBe(1);

    await resolve(promptB, "deny");
    expect(errorCodeOf(await second)).toBe(RPC_ERROR_CODES.DISCLOSURE_REFUSED);
  });

  it("repeat calls for one key still share one prompt", async () => {
    const calls = [
      nostr.handleRequest(askKey(), context),
      nostr.handleRequest(askKey(), context),
    ];
    await nextPending();
    await new Promise((r) => setTimeout(r, 10));
    expect(queue.count()).toBe(1);

    await resolve(queue.getNextPending()!, "allow_once");
    for (const res of await Promise.all(calls)) {
      expect(dataOf(res)).toEqual({ pubkey: keyA.pubkey });
    }
  });

  it("binds a remembered approval to the key the prompt named, even if the selection moved", async () => {
    const pending = nostr.handleRequest(askKey(), context);
    const request = await nextPending();
    await select(keyB);

    await resolve(request, "allow");
    expect(dataOf(await pending)).toEqual({ pubkey: keyA.pubkey });

    expect(await context.policy.getIdentityDisclosure(SITE, keyA.id)).toBe("allow");
    expect(await context.policy.getIdentityDisclosure(SITE, keyB.id)).toBeUndefined();
  });
});

describe("approving a signature discloses the key that signs", () => {
  it("records the grant for the signing key only", async () => {
    await select(keyB);
    const pending = nostr.handleRequest(
      {
        type: "nostr.signEvent",
        origin: SITE,
        event: { kind: 7, created_at: 1_700_000_000, tags: [], content: "+" },
      },
      context
    );
    await resolve(await nextPending(), "allow_once");
    await pending;

    expect(await context.policy.getIdentityDisclosure(SITE, keyB.id)).toBe("allow");
    expect(await context.policy.getIdentityDisclosure(SITE, keyA.id)).toBeUndefined();
  });
});

describe("revoking a grant", () => {
  it("per key: that key asks again and the other keeps answering", async () => {
    await askAndAnswer("allow");
    await select(keyB);
    await askAndAnswer("allow");

    const res = await new PolicyRpcHandler().handleRequest(
      { type: "policy.revokeDisclosure", origin: SITE, keyId: keyA.id },
      context
    );
    expect(res.ok).toBe(true);

    expect(dataOf(await askSilently())).toEqual({ pubkey: keyB.pubkey });
    await select(keyA);
    await expectAsks();
  });
});

describe("the activity log records which key was disclosed", () => {
  it("logs the key id on a fresh approval and on a remembered read", async () => {
    await askAndAnswer("allow");
    await askSilently();
    await select(keyB);
    await askAndAnswer("allow_once");

    const entries = (await context.activityLog.getRecent(10, 0)).filter(
      (e) => e.operation === "identity_disclosure" && e.decision === "allow"
    );
    expect(entries.map((e) => [e.keyId, e.reason]).reverse()).toEqual([
      [keyA.id, "user"],
      [keyA.id, "remembered"],
      [keyB.id, "user"],
    ]);
    expect(JSON.stringify(entries)).not.toContain(PUBKEY_ONE);
  });
});

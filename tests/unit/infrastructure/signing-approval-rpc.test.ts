import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserBoundary = vi.hoisted(() => ({
  badgeTexts: [] as string[],
  failBadge: false,
  createdUrls: [] as string[],
  createResult: { id: 7 } as { id?: number },
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: { getURL: (path: string) => `chrome-extension://ostrilo-test${path}` },
    windows: {
      create: async (opts: { url: string }) => {
        browserBoundary.createdUrls.push(opts.url);
        return browserBoundary.createResult;
      },
    },
    action: {
      setBadgeText: async ({ text }: { text: string }) => {
        if (browserBoundary.failBadge) throw new Error("no action api");
        browserBoundary.badgeTexts.push(text);
      },
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
  },
}));

import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import { ApprovalRpcHandler } from "@/infrastructure/messaging/handlers/approval-rpc";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { RpcRequest } from "@/infrastructure/messaging/rpc";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { ActivityLogService } from "@/application/services/activity-log.service";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import type { PolicyService } from "@/application/services/policy.service";
import type { StorageSuite } from "@/application/ports/storage";
import type { KeyRecord, OriginPolicy, PendingRequest, SignedEvent } from "@/domain/types";
import { computeEventId } from "@/application/crypto/event-id";
import { NobleSchnorr, NobleSha256 } from "@/infrastructure/crypto/adapters";
import { hexToBytes } from "@/domain/utils/hex";
import { memoryStorage } from "../../helpers/vault";
import {
  PUBKEY_ONE,
  SECRET_ONE,
  SECRET_TWO,
  STRONG_PASSWORD,
  dataOf,
  errorCodeOf,
  realContext,
} from "./messaging-fixture";

const SITE = "https://site.example";

let queue: ApprovalQueueService;
let context: ServiceContext;
let vault: KeyVaultService;
let policy: PolicyService;
let activityLog: ActivityLogService;
let storage: StorageSuite;
let windowsClosed: number;

const REACTION = 7;
const TEXT_NOTE = 1;

const signRequest = (origin = SITE, content = "hello", kind = REACTION): RpcRequest => ({
  type: "nostr.signEvent",
  origin,
  event: { kind, created_at: 1_700_000_000, tags: [], content },
});

function approvals(options: ConstructorParameters<typeof ApprovalRpcHandler>[1] = {}) {
  return new ApprovalRpcHandler(queue, {
    closeApprovalWindow: async () => {
      windowsClosed += 1;
    },
    ...options,
  });
}

async function nextPending(): Promise<PendingRequest> {
  await vi.waitFor(() => expect(queue.count()).toBeGreaterThan(0));
  const request = queue.getNextPending();
  if (!request) throw new Error("nothing pending");
  return request;
}

async function storedPolicy(origin: string): Promise<OriginPolicy | undefined> {
  const settings = await storage.local.get<{ origins?: OriginPolicy[] }>("appSettings");
  return settings?.origins?.find((o) => o.origin === origin);
}

async function verifies(event: SignedEvent): Promise<boolean> {
  const id = computeEventId(NobleSha256, event);
  return id === event.id && NobleSchnorr.verify(hexToBytes(event.sig), hexToBytes(id), hexToBytes(event.pubkey));
}

beforeEach(async () => {
  browserBoundary.badgeTexts = [];
  browserBoundary.failBadge = false;
  browserBoundary.createdUrls = [];
  browserBoundary.createResult = { id: 7 };
  windowsClosed = 0;
  queue = new ApprovalQueueService();
  ({ context, vault, policy, activityLog, storage } = realContext());
  await vault.importKey(SECRET_ONE, STRONG_PASSWORD, "main");
  await vault.unlock(STRONG_PASSWORD);
});

afterEach(() => {
  queue.clear();
});

describe("signing that needs approval", () => {
  it("signs with the selected key once the user allows, and remembers the kind", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    const pending = nostr.handleRequest(signRequest(), context);

    const request = await nextPending();
    expect(request.signingPubkey).toBe(PUBKEY_ONE);
    const resolved = await approvals().handleRequest(
      { type: "approval.resolve", requestId: request.id, action: "allow" },
      context
    );

    expect(dataOf(resolved)).toEqual({ resolved: true });
    const { event } = dataOf<{ event: SignedEvent }>(await pending);
    expect(event.pubkey).toBe(PUBKEY_ONE);
    expect(await verifies(event)).toBe(true);
    expect((await storedPolicy(SITE))?.rules[REACTION]).toBe("allow");
    expect((await storedPolicy(SITE))?.identityDisclosure).toBe("allow");
    expect((await storedPolicy(SITE))?.identityDisclosureKeyIds).toEqual([
      (await vault.listKeys())[0].id,
    ]);
    expect(windowsClosed).toBe(1);
  });

  it("never turns an allow on a protected kind into a standing rule", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    const pending = nostr.handleRequest(signRequest(SITE, "note", TEXT_NOTE), context);

    const request = await nextPending();
    await approvals().handleRequest(
      { type: "approval.resolve", requestId: request.id, action: "allow" },
      context
    );

    expect((await pending).ok).toBe(true);
    expect((await storedPolicy(SITE))?.rules).toEqual({});
  });

  it("returns denied and logs the refusal when the user denies", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    const pending = nostr.handleRequest(signRequest(SITE, "secret plans"), context);

    const request = await nextPending();
    await approvals().handleRequest(
      { type: "approval.resolve", requestId: request.id, action: "deny" },
      context
    );

    const res = await pending;
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.DENIED);
    const [entry] = await activityLog.getRecent(10, 0);
    expect(entry).toMatchObject({
      origin: SITE,
      decision: "deny",
      reason: "user",
      contentPreview: "secret plans",
    });
    expect(await storedPolicy(SITE)).toBeUndefined();
  });

  it("records a remembered denial as a per-kind deny rule", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    const pending = nostr.handleRequest(signRequest(), context);

    const request = await nextPending();
    await approvals().handleRequest(
      { type: "approval.resolve", requestId: request.id, action: "deny_remember" },
      context
    );

    expect(errorCodeOf(await pending)).toBe(RPC_ERROR_CODES.DENIED);
    expect((await storedPolicy(SITE))?.rules[REACTION]).toBe("deny");
  });

  it("reports an unanswered request as a timeout and logs it as denied", async () => {
    queue = new ApprovalQueueService(20);
    const nostr = new NostrRpcHandler(queue, async () => 1);

    const res = await nostr.handleRequest(signRequest(), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.TIMEOUT);
    const [entry] = await activityLog.getRecent(10, 0);
    expect(entry).toMatchObject({ origin: SITE, decision: "deny", reason: "timeout" });
  });

  it("reports approval_failed, not a user denial, when the approval window cannot be opened", async () => {
    const nostr = new NostrRpcHandler(queue, async () => {
      throw new Error("windows api unavailable");
    });

    const res = await nostr.handleRequest(signRequest(), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.APPROVAL_FAILED);
    expect(JSON.stringify(res)).not.toContain("windows api");
    expect(queue.count()).toBe(0);
  });

  it("still fails closed when the fallback badge cannot be set either", async () => {
    browserBoundary.failBadge = true;
    const nostr = new NostrRpcHandler(queue, async () => {
      throw new Error("windows api unavailable");
    });

    const res = await nostr.handleRequest(signRequest(), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.APPROVAL_FAILED);
    expect(queue.count()).toBe(0);
  });

  it("refuses a sixth concurrent request from one origin as rate limited", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    for (let i = 0; i < 5; i++) {
      void nostr.handleRequest(signRequest(SITE, `note ${i}`), context);
    }
    await vi.waitFor(() => expect(queue.count()).toBe(5));

    const res = await nostr.handleRequest(signRequest(SITE, "one too many"), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.RATE_LIMITED);
    expect(queue.count()).toBe(5);
  });

  it("opens its own approval window when no window manager is supplied", async () => {
    const nostr = new NostrRpcHandler(queue);
    const pending = nostr.handleRequest(signRequest(), context);

    const request = await nextPending();
    await vi.waitFor(() => expect(browserBoundary.badgeTexts).toContain("1"));
    expect(browserBoundary.createdUrls).toEqual([
      `chrome-extension://ostrilo-test/approval.html?requestId=${request.id}`,
    ]);

    queue.resolve(request.id, "allow_once");
    expect(dataOf<{ event: SignedEvent }>(await pending).event.pubkey).toBe(PUBKEY_ONE);
  });

  it("fails closed with approval_failed when the created approval window has no id", async () => {
    browserBoundary.createResult = {};
    const nostr = new NostrRpcHandler(queue);

    const res = await nostr.handleRequest(signRequest(), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.APPROVAL_FAILED);
    expect(queue.count()).toBe(0);
  });

  it("clears the badge when the queue emptied while the window was opening", async () => {
    const nostr = new NostrRpcHandler(queue, async () => {
      queue.clear();
      return 1;
    });

    const res = await nostr.handleRequest(signRequest(), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.DENIED);
    expect(browserBoundary.badgeTexts).toEqual([""]);
  });

  it("answers needs-approval when no approval queue is configured", async () => {
    const res = await new NostrRpcHandler().handleRequest(signRequest(), context);
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.NEEDS_APPROVAL);
  });
});

describe("why a refused signing request was refused", () => {
  const reasonLogged = async () => (await activityLog.getRecent(10, 0))[0];

  it("names a remembered deny rule when no prompt was shown", async () => {
    await policy.setPerKindRule(SITE, REACTION, "deny");

    const res = await new NostrRpcHandler(queue, async () => 1).handleRequest(signRequest(), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.DENIED);
    expect(await reasonLogged()).toMatchObject({ decision: "deny", reason: "remembered" });
    expect(queue.count()).toBe(0);
  });

  it("names the rate limit when the origin's pending slots are full", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    for (let i = 0; i < 5; i++) {
      void nostr.handleRequest(signRequest(SITE, `note ${i}`), context);
    }
    await vi.waitFor(() => expect(queue.count()).toBe(5));

    const res = await nostr.handleRequest(signRequest(SITE, "one too many"), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.RATE_LIMITED);
    expect(await reasonLogged()).toMatchObject({
      decision: "deny",
      kind: REACTION,
      reason: "rate_limited",
      contentPreview: "one too many",
    });
  });

  it("blames the lock, not the user, when the vault locks while the prompt is open", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    const pending = nostr.handleRequest(signRequest(), context);
    await nextPending();

    // What the background does on lock.
    queue.clear();

    expect(errorCodeOf(await pending)).toBe(RPC_ERROR_CODES.DENIED);
    expect(await reasonLogged()).toMatchObject({ decision: "deny", reason: "vault_locked" });
  });

  it("logs a request the page withdrew as unanswered, not as the user's denial", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    const pending = nostr.handleRequest(
      {
        type: "nostr.signEvent",
        origin: SITE,
        clientRequestId: "c1",
        event: { kind: REACTION, created_at: 1_700_000_000, tags: [], content: "hello" },
      },
      context
    );
    await nextPending();

    await nostr.handleRequest(
      { type: "nostr.cancelRequest", origin: SITE, clientRequestId: "c1" },
      context
    );
    expect(errorCodeOf(await pending)).toBe(RPC_ERROR_CODES.DENIED);

    expect(await reasonLogged()).toMatchObject({ decision: "deny", reason: "timeout" });
  });

  it("logs an approved request that could not be signed because the key was unreadable", async () => {
    await policy.setPerKindRule(SITE, REACTION, "allow");
    vi.spyOn(vault, "sign").mockRejectedValueOnce(new Error("key_unreadable"));

    const res = await new NostrRpcHandler(queue, async () => 1).handleRequest(signRequest(), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.VAULT_UNREADABLE);
    expect(await reasonLogged()).toMatchObject({ decision: "deny", reason: "key_unreadable" });
  });

  it("logs an approved request that could not be signed because the vault locked", async () => {
    await policy.setPerKindRule(SITE, REACTION, "allow");
    vi.spyOn(vault, "sign").mockRejectedValueOnce(new Error("key_locked_or_missing"));

    const res = await new NostrRpcHandler(queue, async () => 1).handleRequest(signRequest(), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.LOCKED);
    expect(await reasonLogged()).toMatchObject({ decision: "deny", reason: "vault_locked" });
  });

  it("blames the lock for a disclosure prompt the vault locked under", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    const pending = nostr.handleRequest({ type: "nostr.getPublicKey", origin: SITE }, context);
    await nextPending();

    queue.clear();

    expect(errorCodeOf(await pending)).toBe(RPC_ERROR_CODES.DISCLOSURE_REFUSED);
    expect(await reasonLogged()).toMatchObject({
      operation: "identity_disclosure",
      decision: "deny",
      reason: "vault_locked",
    });
  });
});

describe("signing refusals from vault state", () => {
  it("refuses when no key is marked selected", async () => {
    const keys = (await storage.local.get<KeyRecord[]>("encryptedKeys")) ?? [];
    await storage.local.set("encryptedKeys", keys.map((k) => ({ ...k, isSelected: false })));

    const res = await new NostrRpcHandler(queue, async () => 1).handleRequest(signRequest(), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.NO_KEY_SELECTED);
  });

  it("reports a selected key that failed to unlock as unreadable, not locked and not denied", async () => {
    await vault.importKey(SECRET_TWO, STRONG_PASSWORD, "second");
    await vault.lock();
    const [first, second] = (await storage.local.get<KeyRecord[]>("encryptedKeys")) ?? [];
    await storage.local.set("encryptedKeys", [
      { ...first, isSelected: false },
      { ...second, isSelected: true, wrappedDek: undefined },
    ]);
    const unlocked = await vault.unlock(STRONG_PASSWORD);
    expect(unlocked.damagedKeyIds).toEqual([second.id]);
    await policy.setPerKindRule(SITE, REACTION, "allow");

    const res = await new NostrRpcHandler(queue, async () => 1).handleRequest(signRequest(), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.VAULT_UNREADABLE);
  });
});

describe("identity disclosure through the approval queue", () => {
  const askKey = (origin = SITE): RpcRequest => ({ type: "nostr.getPublicKey", origin });

  it("refuses as rate limited when the origin already fills its pending slots", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    for (let i = 0; i < 5; i++) {
      void nostr.handleRequest(signRequest(SITE, `note ${i}`), context);
    }
    await vi.waitFor(() => expect(queue.count()).toBe(5));

    const res = await nostr.handleRequest(askKey(), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.RATE_LIMITED);
    const entries = await activityLog.getRecent(10, 0);
    expect(entries[0]).toMatchObject({ operation: "identity_disclosure", reason: "rate_limited" });
    expect(JSON.stringify(res)).not.toContain(PUBKEY_ONE);
  });

  it("refuses when the prompt cannot be shown, disclosing nothing", async () => {
    const nostr = new NostrRpcHandler(queue, async () => {
      throw new Error("windows api unavailable");
    });

    const res = await nostr.handleRequest(askKey(), context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.APPROVAL_FAILED);
    expect(JSON.stringify(res)).not.toContain(PUBKEY_ONE);
    expect(
      await policy.getIdentityDisclosure(SITE, (await vault.listKeys())[0].id)
    ).toBeUndefined();
  });

  it("remembers an allowed disclosure per origin without writing a kind rule", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    const pending = nostr.handleRequest(askKey(), context);

    const request = await nextPending();
    await approvals().handleRequest(
      { type: "approval.resolve", requestId: request.id, action: "allow" },
      context
    );

    expect(dataOf(await pending)).toEqual({ pubkey: PUBKEY_ONE });
    expect(await storedPolicy(SITE)).toMatchObject({
      identityDisclosure: "allow",
      identityDisclosureKeyIds: [(await vault.listKeys())[0].id],
      rules: {},
    });
  });

  it("remembers a refused disclosure so the next request is answered without a prompt", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    const pending = nostr.handleRequest(askKey(), context);

    const request = await nextPending();
    await approvals().handleRequest(
      { type: "approval.resolve", requestId: request.id, action: "deny_remember" },
      context
    );

    expect(errorCodeOf(await pending)).toBe(RPC_ERROR_CODES.DISCLOSURE_REFUSED);
    expect(errorCodeOf(await nostr.handleRequest(askKey(), context))).toBe(
      RPC_ERROR_CODES.DISCLOSURE_REFUSED
    );
    expect(queue.count()).toBe(0);
  });
});

describe("nostr.cancelRequest", () => {
  it("cancels nothing when no approval queue exists", async () => {
    const res = await new NostrRpcHandler().handleRequest(
      { type: "nostr.cancelRequest", origin: SITE, clientRequestId: "c1" },
      context
    );
    expect(dataOf(res)).toEqual({ cancelled: false });
  });
});

describe("approval queue RPC", () => {
  it("lists every pending request in arrival order", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    void nostr.handleRequest(signRequest(SITE, "first"), context);
    void nostr.handleRequest(signRequest("https://other.example", "second"), context);
    await vi.waitFor(() => expect(queue.count()).toBe(2));

    const { requests } = dataOf<{ requests: PendingRequest[] }>(
      await approvals().handleRequest({ type: "approval.getAll" }, context)
    );

    expect(requests.map((r) => r.origin)).toEqual([SITE, "https://other.example"]);
  });

  it("rejects a resolve for a request that does not exist", async () => {
    const res = await approvals().handleRequest(
      { type: "approval.resolve", requestId: "00000000-0000-4000-8000-000000000000", action: "allow" },
      context
    );
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
  });

  it("rejects an action outside the approval vocabulary", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    void nostr.handleRequest(signRequest(), context);
    const request = await nextPending();

    const res = await approvals().handleRequest(
      { type: "approval.resolve", requestId: request.id, action: "sign_anything" } as unknown as RpcRequest,
      context
    );

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    expect(queue.count()).toBe(1);
  });

  it("leaves the request pending when the remembered decision cannot be stored", async () => {
    const broken = memoryStorage();
    const brokenContext = realContext(broken).context;
    broken.local.set = async () => {
      throw new Error("quota exceeded");
    };
    const nostr = new NostrRpcHandler(queue, async () => 1);
    void nostr.handleRequest(signRequest(), context);
    const request = await nextPending();

    const res = await approvals().handleRequest(
      { type: "approval.resolve", requestId: request.id, action: "allow" },
      brokenContext
    );

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.APPROVAL_FAILED);
    expect(queue.getById(request.id)).toBeDefined();
  });

  it("resolves even when the badge update fails", async () => {
    const nostr = new NostrRpcHandler(queue, async () => 1);
    const pending = nostr.handleRequest(signRequest(), context);
    const request = await nextPending();

    const res = await approvals({
      updateBadgeCount: async () => {
        throw new Error("badge api gone");
      },
    }).handleRequest({ type: "approval.resolve", requestId: request.id, action: "allow_once" }, context);

    expect(dataOf(res)).toEqual({ resolved: true });
    expect((await pending).ok).toBe(true);
  });

  it("rejects an unknown approval method", async () => {
    const res = await approvals().handleRequest(
      { type: "approval.approveAll" } as unknown as RpcRequest,
      context
    );
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
  });
});


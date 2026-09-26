import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BackgroundListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean;

const RUNTIME_ID = "ostriloroundtriptestruntimeid000";
const ORIGIN = `chrome-extension://${RUNTIME_ID}/`;

const bus = vi.hoisted(() => ({
  background: null as BackgroundListener | null,
  pageListeners: new Set<(msg: unknown) => void>(),
  override: null as ((msg: unknown) => Promise<unknown>) | null,
  sent: [] as unknown[],
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "ostriloroundtriptestruntimeid000",
      getURL: (p: string) => `chrome-extension://ostriloroundtriptestruntimeid000/${p.replace(/^\//, "")}`,
      sendMessage: async (msg: unknown) => {
        bus.sent.push(msg);
        if (bus.override) return bus.override(msg);
        if (msg && typeof msg === "object" && "__event" in msg) {
          for (const l of bus.pageListeners) l(msg);
          return undefined;
        }
        const listener = bus.background;
        if (!listener) throw new Error("Could not establish connection. Receiving end does not exist.");
        return new Promise((resolve) => {
          listener(msg, { id: "ostriloroundtriptestruntimeid000", url: "chrome-extension://ostriloroundtriptestruntimeid000/options.html" }, resolve);
        });
      },
      onMessage: {
        addListener: (l: (msg: unknown) => void) => bus.pageListeners.add(l),
        removeListener: (l: (msg: unknown) => void) => bus.pageListeners.delete(l),
      },
    },
  },
}));

import { RpcRouter, createRpcMessageListener } from "@/infrastructure/messaging/rpc-router";
import {
  ActivityRpcHandler,
  ApprovalRpcHandler,
  CryptoRpcHandler,
  NostrRpcHandler,
  PolicyRpcHandler,
  SettingsRpcHandler,
  StateRpcHandler,
  VaultRpcHandler,
} from "@/infrastructure/messaging/handlers";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "@/infrastructure/messaging/error-codes";
import { BROADCAST_EVENTS } from "@/infrastructure/messaging/events";
import { patchNeedsReauth } from "@/infrastructure/messaging/reauth";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { RpcResponse } from "@/infrastructure/messaging/rpc";
import type { ActivityLogService } from "@/application/services/activity-log.service";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import type { PolicyService } from "@/application/services/policy.service";
import { PUBKEY_ONE, SECRET_ONE, SECRET_TWO, STRONG_PASSWORD, realContext } from "./messaging-fixture";

type Client = typeof import("@/infrastructure/messaging/client");

const SITE = "https://site.example";

let client: Client;
let context: ServiceContext;
let vault: KeyVaultService;
let policy: PolicyService;
let activityLog: ActivityLogService;
let queue: ApprovalQueueService;
let lockedPageRequests: string[];

async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Error) return e;
    throw new Error(`rejected with a non-Error: ${String(e)}`);
  }
  throw new Error("expected a rejection");
}

beforeEach(async () => {
  vi.resetModules();
  bus.override = null;
  bus.sent = [];
  bus.pageListeners.clear();
  lockedPageRequests = [];
  queue = new ApprovalQueueService();
  ({ context, vault, policy, activityLog } = realContext());
  context.onLockedPageRequest = (method) => lockedPageRequests.push(method);

  const router = new RpcRouter();
  router.registerModule("vault", new VaultRpcHandler());
  router.registerModule("keys", new VaultRpcHandler());
  router.registerModule("policy", new PolicyRpcHandler());
  router.registerModule("settings", new SettingsRpcHandler());
  router.registerModule("crypto", new CryptoRpcHandler());
  router.registerModule("state", new StateRpcHandler());
  router.registerModule("activity", new ActivityRpcHandler());
  router.registerModule("approval", new ApprovalRpcHandler(queue));
  router.registerModule("nostr", new NostrRpcHandler(queue, async () => undefined));
  bus.background = createRpcMessageListener(router, context);

  client = await import("@/infrastructure/messaging/client");
});

afterEach(() => {
  queue.clear();
  vi.useRealTimers();
});

describe("key lifecycle through the client and the real background", () => {
  it("creates, lists, renames and reveals a key", async () => {
    const created = await client.generateKey(STRONG_PASSWORD, "first");
    await client.unlockVault(STRONG_PASSWORD);

    await client.renameKey(created.id, "renamed");
    const [listed] = await client.listKeys();
    expect(listed).toMatchObject({ id: created.id, label: "renamed" });
    expect(listed.npub?.startsWith("npub1")).toBe(true);

    const imported = await client.importKey(SECRET_TWO, STRONG_PASSWORD, "second");
    await client.selectKey(imported.id);
    expect((await client.revealKey(STRONG_PASSWORD)).hex).toBe(SECRET_TWO);
    expect((await client.revealKey(STRONG_PASSWORD, created.id)).hex).not.toBe(SECRET_TWO);
  });

  it("deletes a key only with the vault password", async () => {
    await client.importKey(SECRET_ONE, STRONG_PASSWORD);
    const second = await client.importKey(SECRET_TWO, STRONG_PASSWORD);
    await client.unlockVault(STRONG_PASSWORD);

    const refused = await rejection(client.deleteKey(second.id, "wrong-password-here"));
    expect(refused).toBeInstanceOf(client.RpcClientError);
    expect(refused).toMatchObject({ errorCode: RPC_ERROR_CODES.INVALID_PASSWORD });
    expect(await vault.listKeys()).toHaveLength(2);

    await client.deleteKey(second.id, STRONG_PASSWORD);
    expect((await vault.listKeys()).map((k) => k.pubkey)).toEqual([PUBKEY_ONE]);
  });

  it("changes the master password only with the current one", async () => {
    const NEW_PASSWORD = "Lichen-Harbour-Quill-2026";
    await client.importKey(SECRET_ONE, STRONG_PASSWORD);
    await client.unlockVault(STRONG_PASSWORD);

    const refused = await rejection(client.changePassword("wrong-password-here", NEW_PASSWORD));
    expect(refused).toMatchObject({ errorCode: RPC_ERROR_CODES.INVALID_PASSWORD });

    expect(await client.changePassword(STRONG_PASSWORD, NEW_PASSWORD)).toBeNull();
    await client.lockVault();
    await expect(client.unlockVault(STRONG_PASSWORD)).rejects.toMatchObject({
      errorCode: RPC_ERROR_CODES.INVALID_PASSWORD,
    });
    await client.unlockVault(NEW_PASSWORD);
    expect((await client.revealKey(NEW_PASSWORD)).hex).toBe(SECRET_ONE);
  });

  it("redacts the key list to ids and refuses privileged calls while locked", async () => {
    const created = await client.importKey(SECRET_ONE, STRONG_PASSWORD, "labelled");
    await client.lockVault();

    expect(await client.getLockState()).toEqual({ isLocked: true, selectedKeyId: undefined });
    expect(await client.listKeys()).toEqual([{ id: created.id }]);
    const refused = await rejection(client.renameKey(created.id, "while locked"));
    expect(refused).toMatchObject({ errorCode: RPC_ERROR_CODES.LOCKED });
    expect((await vault.listKeys())[0].label).toBe("labelled");
  });
});

describe("policy through the client", () => {
  beforeEach(async () => {
    await client.importKey(SECRET_ONE, STRONG_PASSWORD);
    await client.unlockVault(STRONG_PASSWORD);
  });

  it("grants high trust only when the password travels with the patch", async () => {
    const refused = await rejection(client.policySetOrigin(SITE, { trustLevel: "high" }));
    expect(refused).toMatchObject({ errorCode: RPC_ERROR_CODES.INVALID_PASSWORD });

    await client.policySetOrigin(SITE, { trustLevel: "high" }, STRONG_PASSWORD);
    expect((await client.evaluatePolicy(SITE, 7)).mode).toBe("allow");
  });

  it("writes kind rules, session grants and removal", async () => {
    await client.policySetKindRule(SITE, 7, "deny");
    expect((await client.evaluatePolicy(SITE, 7)).mode).toBe("deny");

    await client.policySetSession(SITE, true, STRONG_PASSWORD);
    expect((await client.policyGetSessionGrants()).map((g) => g.origin)).toEqual([SITE]);
    await client.policyClearSession(SITE);
    expect(await client.policyGetSessionGrants()).toEqual([]);

    await client.policyRemoveOrigin(SITE);
    expect(await policy.getIdentityDisclosure(SITE)).toBeUndefined();
    expect((await client.evaluatePolicy(SITE, 7)).mode).toBe("ask");
  });
});

describe("crypto helpers through the client", () => {
  it("judges passwords against the background blocklist", async () => {
    expect((await client.evaluatePasswordStrength("password")).acceptable).toBe(false);
    expect((await client.evaluatePasswordStrength(STRONG_PASSWORD)).acceptable).toBe(true);
  });

  it("validates a private key without returning its bytes", async () => {
    const result = await client.parsePrivateKey(SECRET_ONE);
    expect(result).toEqual({ valid: true });
    expect(JSON.stringify(result)).not.toContain(SECRET_ONE);
  });
});

describe("approvals and activity through the client", () => {
  beforeEach(async () => {
    await client.importKey(SECRET_ONE, STRONG_PASSWORD);
    await client.unlockVault(STRONG_PASSWORD);
  });

  it("reads and resolves the approval queue", async () => {
    const decisions: string[] = [];
    const request = queue.enqueue(
      SITE,
      { kind: 7, created_at: 1_700_000_000, tags: [], content: "+" },
      (decision) => decisions.push(decision)
    );

    expect(await client.getApprovalCount()).toEqual({ count: 1 });
    expect((await client.getNextApprovalRequest()).request?.id).toBe(request.id);
    expect((await client.getAllApprovalRequests()).requests.map((r) => r.id)).toEqual([request.id]);

    expect(await client.resolveApprovalRequest(request.id, "deny")).toEqual({ resolved: true });
    expect(decisions).toEqual(["deny"]);
    expect(await client.getApprovalCount()).toEqual({ count: 0 });
  });

  it("pages, filters and clears the activity log", async () => {
    await activityLog.addEntry({ origin: SITE, kind: 1, decision: "allow" });
    await activityLog.addEntry({ origin: "https://other.example", kind: 7, decision: "deny" });

    expect((await client.activityGetRecent()).total).toBe(2);
    expect((await client.activityGetRecent({ limit: 1, offset: 1 })).entries).toHaveLength(1);
    const filtered = await client.activityFilterBy({ origin: SITE });
    expect(filtered.entries.map((e) => e.origin)).toEqual([SITE]);
    expect(filtered.total).toBe(1);

    await client.activityClear();
    expect(await activityLog.count()).toBe(0);
  });
});

describe("settings cache", () => {
  beforeEach(async () => {
    await client.importKey(SECRET_ONE, STRONG_PASSWORD);
    await client.unlockVault(STRONG_PASSWORD);
  });

  it("serves a read from cache until forced or invalidated by an update", async () => {
    expect((await client.getSettings())?.theme).toBe("system");
    await context.settings.update({ theme: "dark" });

    expect((await client.getSettings())?.theme).toBe("system");
    expect((await client.getSettings(true))?.theme).toBe("dark");

    await client.updateSettings({ theme: "light" });
    expect((await client.getSettings())?.theme).toBe("light");
  });

  it("requires the password to change the auto-lock timeout", async () => {
    const refused = await rejection(client.updateSettings({ autoLockMinutes: 60 }));
    expect(refused).toMatchObject({ errorCode: RPC_ERROR_CODES.INVALID_PASSWORD });

    const updated = await client.updateSettings({ autoLockMinutes: 60 }, STRONG_PASSWORD);
    expect(updated.autoLockMinutes).toBe(60);
  });

  it("notifies subscribers of a change broadcast by the background and drops the cache", async () => {
    await client.getSettings();
    const notified: string[] = [];
    const unsubscribe = client.subscribeSettingsChanged(() => notified.push("changed"));

    await context.settings.update({ theme: "dark" });
    for (const l of bus.pageListeners) l({ __event: BROADCAST_EVENTS.QUEUE_UPDATED });
    for (const l of bus.pageListeners) l("not an event");

    expect(notified).toEqual(["changed"]);
    expect((await client.getSettings())?.theme).toBe("dark");

    unsubscribe();
    await context.settings.update({ theme: "light" });
    expect(notified).toEqual(["changed"]);
  });
});

describe("activity reporting", () => {
  const touches = () => bus.sent.filter((m) => (m as { type?: string }).type === "state.touch").length;

  it("reports at most once per throttle window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);

    client.reportActivity();
    client.reportActivity();
    expect(touches()).toBe(1);

    vi.setSystemTime(1_800_000_031_000);
    client.reportActivity();
    expect(touches()).toBe(2);
  });

  it("reopens the window when a report fails to land", async () => {
    bus.override = async () => ({ ok: false, error: createRpcErrorResponse(RPC_ERROR_CODES.LOCKED).error });

    client.reportActivity();
    await vi.waitFor(() => expect(touches()).toBe(1));
    await new Promise((r) => setTimeout(r, 0));
    client.reportActivity();

    expect(touches()).toBe(2);
  });

  it("extends the auto-lock deadline of an unlocked vault", async () => {
    await client.importKey(SECRET_ONE, STRONG_PASSWORD);
    await client.unlockVault(STRONG_PASSWORD);
    const before = (await client.getLockState()).lockAt ?? 0;
    await new Promise((r) => setTimeout(r, 5));

    await client.touchActivity();

    expect((await client.getLockState()).lockAt ?? 0).toBeGreaterThan(before);
  });
});

describe("transport failures", () => {
  it("names a missing response", async () => {
    bus.override = async () => undefined;
    expect((await rejection(client.lockVault())).message).toBe("rpc:vault.lock:no_response");
  });

  it("names a response that is not an object", async () => {
    bus.override = async () => "ok";
    expect((await rejection(client.lockVault())).message).toBe("rpc:vault.lock:invalid_response_type");
  });

  it("treats a malformed error object as an unknown error", async () => {
    bus.override = async () => ({ ok: false, error: { code: "x" } });
    expect((await rejection(client.lockVault())).message).toBe("rpc:vault.lock:unknown_error");
  });

  it("wraps a non-warmup transport failure without retrying", async () => {
    bus.override = async () => {
      throw new Error("port exploded");
    };

    const err = await rejection(client.lockVault());

    expect(err.message).toBe("rpc:vault.lock:transport_error:port exploded");
    expect(bus.sent).toHaveLength(1);
  });

  it("wraps a thrown non-Error value", async () => {
    bus.override = async () => Promise.reject("plain string");
    expect((await rejection(client.lockVault())).message).toBe(
      "rpc:vault.lock:transport_error:plain string"
    );
  });

  it("retries while the background is warming up, then succeeds", async () => {
    let calls = 0;
    bus.override = async () => {
      calls += 1;
      if (calls < 3) throw new Error("Could not establish connection. Receiving end does not exist.");
      return { ok: true, data: null };
    };

    await expect(client.lockVault()).resolves.toBeNull();
    expect(calls).toBe(3);
  });

  it("gives up after the last warmup retry", async () => {
    bus.override = async () => {
      throw new Error("Extension context invalidated.");
    };

    const err = await rejection(client.lockVault());

    expect(err.message).toBe("rpc:vault.lock:transport_error:Extension context invalidated.");
    expect(bus.sent).toHaveLength(4);
  });
});

describe("message listener boundary", () => {
  const call = (message: unknown, sender: unknown) =>
    new Promise<RpcResponse>((resolve) => {
      bus.background?.(message, sender, (r) => resolve(r as RpcResponse));
    });
  const extensionPage = { id: RUNTIME_ID, url: `${ORIGIN}popup.html` };
  const contentScript = { id: RUNTIME_ID, url: "https://evil.example/page" };
  const siteTab = { id: RUNTIME_ID, tab: { id: 1 }, frameId: 0, url: `${SITE}/page` };

  it("rejects messages with no usable type", async () => {
    for (const message of [null, "vault.unlock", {}, { type: "" }]) {
      const res = await call(message, extensionPage);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_REQUEST);
    }
  });

  it("hides the vault from a content script as an unknown namespace", async () => {
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await vault.unlock(STRONG_PASSWORD);

    const res = await call({ type: "vault.reveal", password: STRONG_PASSWORD }, contentScript);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.UNKNOWN_NAMESPACE);
    expect(JSON.stringify(res)).not.toContain(SECRET_ONE);
  });

  it("raises the locked-page marker when a page asks to sign while locked", async () => {
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);

    const res = await call(
      { type: "nostr.signEvent", origin: SITE, event: { kind: 1, created_at: 1, tags: [], content: "" } },
      siteTab
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.LOCKED);
    expect(lockedPageRequests).toEqual(["nostr.signEvent"]);
  });

  it("does not raise the marker for a locked request from an extension page", async () => {
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);

    await call({ type: "policy.removeOrigin", origin: SITE }, extensionPage);

    expect(lockedPageRequests).toEqual([]);
  });
});

describe("reauth patch classification", () => {
  it("does not demand a password for a patch that is not an object", () => {
    expect(patchNeedsReauth(null)).toBe(false);
    expect(patchNeedsReauth("autoLockMinutes")).toBe(false);
    expect(patchNeedsReauth({ theme: "dark" })).toBe(false);
    expect(patchNeedsReauth({ sessionTTLMinutes: 5 })).toBe(true);
  });
});


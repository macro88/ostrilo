import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RpcRouter,
  isTrustedExtensionSender,
  namespaceOf,
} from "@/infrastructure/messaging/rpc-router";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";

/**
 * Privilege boundary on the RPC surface, and the logging policy that goes with
 * it.
 *
 * The defects fenced here:
 *
 *  - `vault.export` returned the raw nsec whenever the vault was unlocked, with
 *    no password, no consent and no activity-log entry. It had no caller.
 *  - `vault.sign` signed any 32-byte value with no origin, no policy check and
 *    no approval. It had no caller either.
 *  - `crypto.parsePrivateKey` returned the raw 32-byte secret scalar across the
 *    message bus into the calling page.
 *  - The message listener accepted `sender` and never read it, so a single flat
 *    router dispatched every namespace with no notion of caller privilege.
 *  - The RPC client logged every response body, so revealing a key for backup
 *    printed the nsec into the page console.
 *
 * A correction worth recording, because acting on the wrong threat model would
 * have produced the wrong fix: a co-installed browser extension CANNOT reach
 * this router. Cross-extension messages arrive at
 * `chrome.runtime.onMessageExternal`; Ostrilo registers only `onMessage` and
 * declares no `externally_connectable`. The real attacker is code running
 * INSIDE an Ostrilo extension page - most plausibly a compromised npm
 * dependency, since those bundles pull in three.js and the Radix set.
 */

const RUNTIME_ID = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${RUNTIME_ID}/`;

describe("namespace resolution", () => {
  it("resolves the namespace from the message type", () => {
    expect(namespaceOf("vault.unlock")).toBe("vault");
    expect(namespaceOf("nostr.signEvent")).toBe("nostr");
  });

  it("returns undefined for junk", () => {
    expect(namespaceOf("")).toBeUndefined();
    expect(namespaceOf(undefined)).toBeUndefined();
    expect(namespaceOf(42)).toBeUndefined();
    expect(namespaceOf(".leading")).toBeUndefined();
  });
});

describe("page-reachable namespaces", () => {
  it("exposes only `nostr` to web pages", () => {
    expect(RpcRouter.isPageReachable("nostr")).toBe(true);
  });

  it("keeps every privileged namespace off the page-reachable list", () => {
    // If someone adds one of these, this fails and says so.
    for (const ns of [
      "vault",
      "keys",
      "crypto",
      "policy",
      "settings",
      "approval",
      "activity",
      "profile",
      "state",
    ]) {
      expect(
        RpcRouter.isPageReachable(ns),
        `SECURITY REGRESSION: namespace "${ns}" became reachable from a web page`
      ).toBe(false);
    }
  });

  it("treats an unknown namespace as privileged, not as page-reachable", () => {
    expect(RpcRouter.isPageReachable("something-new")).toBe(false);
  });
});

describe("sender trust", () => {
  it("accepts the extension's own pages", () => {
    // All four surfaces, including the two that carry a sender.tab.
    for (const url of [
      `${ORIGIN}popup.html`,
      `${ORIGIN}sidepanel.html`,
      `${ORIGIN}options.html`, // options_ui.open_in_tab: true
      `${ORIGIN}approval.html`, // browser.windows.create
    ]) {
      expect(
        isTrustedExtensionSender({ id: RUNTIME_ID, url }, RUNTIME_ID, ORIGIN),
        `${url} is an extension page and must be trusted`
      ).toBe(true);
    }
  });

  it("rejects a content script even though it reports the extension id", () => {
    // This is why sender.id alone is not enough: Ostrilo's own content script
    // reports sender.id === browser.runtime.id.
    expect(
      isTrustedExtensionSender(
        { id: RUNTIME_ID, url: "https://evil.example/page" },
        RUNTIME_ID,
        ORIGIN
      )
    ).toBe(false);
  });

  it("rejects another extension's origin", () => {
    expect(
      isTrustedExtensionSender(
        { id: "otherextensionidotherextensionid", url: "chrome-extension://otherextensionidotherextensionid/x.html" },
        RUNTIME_ID,
        ORIGIN
      )
    ).toBe(false);
  });

  it("treats missing or malformed sender information as untrusted", () => {
    for (const sender of [
      undefined,
      null,
      {},
      { id: RUNTIME_ID },
      { url: `${ORIGIN}popup.html` },
      { id: RUNTIME_ID, url: "" },
      { id: 123, url: `${ORIGIN}popup.html` },
      "not-an-object",
    ]) {
      expect(
        isTrustedExtensionSender(sender, RUNTIME_ID, ORIGIN),
        `sender ${JSON.stringify(sender)} must not be trusted`
      ).toBe(false);
    }
  });

  it("is not satisfied by an origin-prefix lookalike", () => {
    expect(
      isTrustedExtensionSender(
        { id: RUNTIME_ID, url: `https://evil.example/?x=${ORIGIN}` },
        RUNTIME_ID,
        ORIGIN
      )
    ).toBe(false);
  });
});

describe("removed key-exfiltration surface", () => {
  it("no longer registers vault.export or vault.sign anywhere", async () => {
    const client = await import("@/infrastructure/messaging/client");
    expect(
      "exportKey" in client,
      "exportKey released the raw nsec with no password and had no caller"
    ).toBe(false);
    expect(
      "signHash" in client,
      "signHash was the client wrapper for the blind signing oracle"
    ).toBe(false);
  });

  it("keeps the reveal path, which re-verifies the password", async () => {
    const client = await import("@/infrastructure/messaging/client");
    expect("revealKey" in client).toBe(true);
  });

  it("routes an unregistered namespace to unknown_namespace", async () => {
    const router = new RpcRouter();
    const result = await router.handleRequest(
      { type: "vault.export" } as never,
      {} as never
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.errorCode).toBe(
        RPC_ERROR_CODES.UNKNOWN_NAMESPACE
      );
    }
  });
});

describe("logging policy", () => {
  let logged: unknown[][];

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logged.push(a);
    });
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      logged.push(a);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never logs a response body from the RPC client", async () => {
    const NSEC = "nsec1theseareexactlythebytesthatmustnotbelogged";
    vi.resetModules();
    vi.doMock("wxt/browser", () => ({
      browser: {
        runtime: {
          id: RUNTIME_ID,
          getURL: (p: string) => `${ORIGIN}${p.replace(/^\//, "")}`,
          sendMessage: async () => ({
            ok: true,
            data: { nsec: NSEC, hex: "ab".repeat(32) },
          }),
        },
      },
    }));

    const { rpc } = await import("@/infrastructure/messaging/client");
    const out = await rpc({ type: "vault.reveal", password: "pw" } as never);

    // The call still works...
    expect((out as { nsec: string }).nsec).toBe(NSEC);

    // ...but nothing about it reached the console.
    const dump = JSON.stringify(logged);
    expect(
      dump.includes(NSEC),
      "SECURITY REGRESSION: an RPC response body containing key material was logged"
    ).toBe(false);
    expect(dump).not.toContain("ab".repeat(32));

    vi.doUnmock("wxt/browser");
    vi.resetModules();
  });
});

describe("message listener enforces the boundary", () => {
  async function makeListener() {
    vi.resetModules();
    vi.doMock("wxt/browser", () => ({
      browser: {
        runtime: {
          id: RUNTIME_ID,
          getURL: (p: string) => `${ORIGIN}${p.replace(/^\//, "")}`,
        },
      },
    }));
    const mod = await import("@/infrastructure/messaging/rpc-router");
    const router = new mod.RpcRouter();
    const reached: string[] = [];
    const spyModule = {
      handleRequest: async (m: { type: string }) => {
        reached.push(m.type);
        return { ok: true as const, data: null };
      },
    };
    router.registerModule("vault", spyModule);
    router.registerModule("nostr", spyModule);
    return {
      listener: mod.createRpcMessageListener(router, {} as never),
      reached,
    };
  }

  afterEach(() => {
    vi.doUnmock("wxt/browser");
    vi.resetModules();
  });

  const collect = (listener: ReturnType<typeof Function>, msg: unknown, sender: unknown) =>
    new Promise<{ ok: boolean; code?: string }>((resolve) => {
      (listener as (m: unknown, s: unknown, r: (x: unknown) => void) => unknown)(
        msg,
        sender,
        (res: unknown) => {
          const r = res as { ok: boolean; error?: { data?: { errorCode?: string } } };
          resolve({ ok: r.ok, code: r.error?.data?.errorCode });
        }
      );
    });

  it("lets an extension page reach a UI-only namespace", async () => {
    const { listener, reached } = await makeListener();
    const res = await collect(
      listener,
      { type: "vault.unlock", password: "x" },
      { id: RUNTIME_ID, url: `${ORIGIN}popup.html` }
    );
    expect(res.ok).toBe(true);
    expect(reached).toContain("vault.unlock");
  });

  it("blocks a content-script sender from a UI-only namespace, before any handler runs", async () => {
    const { listener, reached } = await makeListener();
    const res = await collect(
      listener,
      { type: "vault.unlock", password: "x" },
      { id: RUNTIME_ID, url: "https://evil.example/page" }
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe(RPC_ERROR_CODES.UNKNOWN_NAMESPACE);
    expect(
      reached,
      "the handler must never be invoked for a rejected sender"
    ).toHaveLength(0);
  });

  it("still accepts a page-reachable nostr request from a content script", async () => {
    const { listener, reached } = await makeListener();
    const res = await collect(
      listener,
      { type: "nostr.getPublicKey" },
      { id: RUNTIME_ID, url: "https://app.example/page" }
    );
    expect(res.ok).toBe(true);
    expect(reached).toContain("nostr.getPublicKey");
  });

  it("blocks a UI-only namespace when sender information is missing entirely", async () => {
    const { listener, reached } = await makeListener();
    const res = await collect(listener, { type: "vault.unlock" }, undefined);
    expect(res.ok).toBe(false);
    expect(reached).toHaveLength(0);
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RPC_ERROR_CODES,
  createRpcErrorResponse,
} from "@/infrastructure/messaging/error-codes";

/**
 * The page boundary: whatever the content script posts back to a page is the
 * `error` of the rejection that page sees, so it must always be a canonical
 * code from `RPC_ERROR_CODES` and never the browser's own wording or an
 * exception message.
 */

const sendMessage = vi.hoisted(() => vi.fn());

vi.mock("wxt/browser", () => ({ browser: { runtime: { sendMessage } } }));

let pageMessageListener: (event: MessageEvent) => Promise<void>;
const posted: Array<{ id: string; result?: unknown; error?: string }> = [];

beforeAll(async () => {
  vi.stubGlobal("defineContentScript", (config: unknown) => config);
  vi.stubGlobal("injectScript", vi.fn().mockResolvedValue(undefined));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(window, "addEventListener").mockImplementation(((
    type: string,
    listener: unknown
  ) => {
    if (type === "message") {
      pageMessageListener = listener as typeof pageMessageListener;
    }
  }) as typeof window.addEventListener);
  const script = (await import("@/extension/content")).default as unknown as {
    main: () => Promise<void>;
  };
  await script.main();
});

beforeEach(() => {
  posted.length = 0;
  sendMessage.mockReset();
  vi.spyOn(window, "postMessage").mockImplementation(((message: unknown) => {
    posted.push(message as (typeof posted)[number]);
  }) as typeof window.postMessage);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function pageSends(data: unknown): Promise<void> {
  await pageMessageListener(
    new MessageEvent("message", {
      data,
      source: window,
      origin: window.location.origin,
    })
  );
  expect(posted.length).toBeGreaterThan(0);
}

const request = (method: string, params?: unknown) => ({
  type: "OSTRILO_NOSTR_REQUEST",
  id: "req-1",
  method,
  params,
});

describe("content script page boundary", () => {
  it("answers a signEvent without an event with invalid_event", async () => {
    await pageSends(request("signEvent"));

    expect(posted[0].error).toBe(RPC_ERROR_CODES.INVALID_EVENT);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("forwards the canonical code of a refused request, nothing else", async () => {
    sendMessage.mockResolvedValue(
      createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, {
        details: "internal detail that the page must not see",
      })
    );

    await pageSends(request("getPublicKey"));

    expect(posted[0]).toEqual({
      type: "OSTRILO_NOSTR_RESPONSE",
      id: "req-1",
      result: undefined,
      error: RPC_ERROR_CODES.LOCKED,
    });
  });

  it("delivers a successful result", async () => {
    sendMessage.mockResolvedValue({ ok: true, data: { pubkey: "abc" } });

    await pageSends(request("getPublicKey"));

    expect(posted[0].result).toEqual({ pubkey: "abc" });
    expect(posted[0].error).toBeUndefined();
  });

  it("reports approval_failed, not the browser's wording, when the background cannot answer", async () => {
    sendMessage.mockRejectedValue(
      new Error("The message port closed before a response was received.")
    );

    await pageSends(request("getPublicKey"));

    expect(posted[0].error).toBe(RPC_ERROR_CODES.APPROVAL_FAILED);
  });

  it.each([
    ["no reply", undefined],
    ["a reply that is not an RpcResponse", { hello: "world" }],
    ["a failure without an error object", { ok: false }],
    [
      "a failure carrying a code this build does not define",
      { ok: false, error: { data: { errorCode: "Error: stack trace" } } },
    ],
  ])("never forwards %s to the page", async (_name, reply) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sendMessage.mockResolvedValue(reply);

    await pageSends(request("getPublicKey"));

    expect(posted[0].error).toBe(RPC_ERROR_CODES.APPROVAL_FAILED);
    expect(Object.values(RPC_ERROR_CODES)).toContain(posted[0].error);
  });

  it("does not report a failure to post the answer as an approval failure", async () => {
    sendMessage.mockResolvedValue({ ok: true, data: { pubkey: "abc" } });
    const failure = new Error("could not clone");
    vi.mocked(window.postMessage).mockImplementation(() => {
      throw failure;
    });

    await expect(
      pageMessageListener(
        new MessageEvent("message", {
          data: request("getPublicKey"),
          source: window,
          origin: window.location.origin,
        })
      )
    ).rejects.toBe(failure);
    expect(posted).toEqual([]);
  });
});

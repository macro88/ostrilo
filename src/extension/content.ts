import { browser } from "wxt/browser";
import type { RpcRequest, RpcResponse } from "@/infrastructure/messaging/rpc";
import {
  isProviderMethod,
  type ProviderMethod,
} from "@/domain/nostr/provider-methods";
import {
  RPC_ERROR_CODES,
  type RpcErrorCode,
} from "@/infrastructure/messaging/error-codes";

/**
 * Content script for NIP-07 window.nostr provider
 *
 * This script acts as a message bridge between:
 * 1. The injected script (runs in page MAIN world) via window.postMessage
 * 2. The background script via browser.runtime.sendMessage
 *
 * Security considerations:
 * - Messages from page are untrusted, validated before forwarding
 * - Origin is captured from content script context (trusted)
 * - Only specific message types are forwarded
 */

// Message types
interface NostrRequestMessage {
  type: "OSTRILO_NOSTR_REQUEST";
  id: string;
  method: ProviderMethod;
  params?: unknown;
}

interface NostrCancelMessage {
  type: "OSTRILO_NOSTR_CANCEL";
  id: string;
}

interface NostrResponseMessage {
  type: "OSTRILO_NOSTR_RESPONSE";
  id: string;
  result?: unknown;
  error?: string;
}

// aislop-ignore-next-line eslint/no-undef -- wxt auto-import; declared in .wxt/types/imports.d.ts, which this scan excludes as generated code. pnpm run compile is the authority on undefined identifiers here.
export default defineContentScript({
  // HTTPS only.
  //
  // The provider was injected into plaintext `http://` pages, where any
  // on-path attacker - a hostile access point, a compromised router, an ISP
  // proxy - can rewrite the page and drive `window.nostr` as the origin the
  // user trusts. The approval dialog then shows that trusted origin, because
  // it IS that origin. No amount of care in the dialog fixes an attacker who
  // controls the page.
  //
  // BREAKING for dapps served over http://. Local development needs an https
  // origin; see docs/local-https-development.md.
  matches: ["https://*/*"],

  // Run at document start to inject before page scripts
  runAt: "document_start",

  async main() {
    // keepInDom: false. Leaving the injecting <script> element in the page
    // lets any script find it by src and learn both that Ostrilo is installed
    // and its extension id - a stable fingerprinting probe offered for free.
    // Removing the marker does not affect the provider.
    // aislop-ignore-next-line eslint/no-undef -- wxt auto-import; declared in .wxt/types/imports.d.ts, which this scan excludes as generated code. pnpm run compile is the authority on undefined identifiers here.
    await injectScript("/injected.js", {
      keepInDom: false,
    });

    // Listen for messages from injected script
    window.addEventListener("message", handlePageMessage);

    console.log("[Ostrilo] Content script initialized");
  },
});

/**
 * Handle messages from the injected script (page context)
 */
async function handlePageMessage(event: MessageEvent): Promise<void> {
  // Only accept messages from same window...
  if (event.source !== window) return;
  // ...and from this document's own origin. `event.source === window` is
  // the strong check, but the origin check costs nothing and makes the
  // intent explicit: this bridge speaks to one page and no other.
  if (event.origin !== window.location.origin) return;

  // A withdrawal from the page-side deadline. It can only ever DENY - see
  // cancelByClientRequestId - so the worst a hostile page achieves by
  // forging one is cancelling its own prompt.
  const cancel = event.data as NostrCancelMessage;
  if (cancel?.type === "OSTRILO_NOSTR_CANCEL") {
    if (typeof cancel.id !== "string") return;
    void browser.runtime.sendMessage({
      type: "nostr.cancelRequest",
      origin: window.location.origin,
      clientRequestId: cancel.id,
    });
    return;
  }

  const data = event.data as NostrRequestMessage;

  // Validate message structure
  if (data?.type !== "OSTRILO_NOSTR_REQUEST") return;
  if (typeof data.id !== "string") return;
  if (!isProviderMethod(data.method)) return;

  const built = buildRpcRequest(data, window.location.origin);
  if ("errorCode" in built) {
    sendResponse(data.id, undefined, built.errorCode);
    return;
  }

  await forwardToBackground(data.id, built.request);
}

type BuiltRequest =
  | { request: RpcRequest }
  | { errorCode: RpcErrorCode };

type SignEventRequest = Extract<RpcRequest, { type: "nostr.signEvent" }>;

/**
 * The RPC request for a validated page message, or the canonical code to send
 * the page instead. `origin` is the page origin (trusted source).
 */
function buildRpcRequest(
  data: NostrRequestMessage,
  origin: string
): BuiltRequest {
  switch (data.method) {
    case "getPublicKey":
      // The SAME origin `signEvent` uses, computed from
      // `window.location.origin` in this isolated world. Never from
      // `data`/`event.data`: the page owns that object and would simply
      // name whichever origin it wanted to be treated as.
      return {
        request: {
          type: "nostr.getPublicKey",
          origin,
          clientRequestId: data.id,
        },
      };

    case "signEvent":
      if (!data.params || typeof data.params !== "object") {
        return { errorCode: RPC_ERROR_CODES.INVALID_EVENT };
      }
      return {
        request: {
          type: "nostr.signEvent",
          event: data.params as SignEventRequest["event"],
          origin,
          // The page's own correlation id, carried so an abandoned request
          // can be withdrawn. The page cannot use it to approve anything.
          clientRequestId: data.id,
        },
      };

    default: {
      // Exhaustive over `ProviderMethod`: a method added to the list without a
      // case above fails to compile. At runtime it still fails closed.
      const unhandled: never = data.method;
      void unhandled;
      return { errorCode: RPC_ERROR_CODES.UNKNOWN_METHOD };
    }
  }
}

/** Ask the background and relay its answer, as a canonical code on failure. */
async function forwardToBackground(
  id: string,
  rpcRequest: RpcRequest
): Promise<void> {
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage(rpcRequest);
  } catch {
    // The background did not answer: it was ended while the request was open
    // (the queue entry and this request's message port live in its memory), or
    // the extension was reloaded under a page that was already open. The
    // browser's own wording for that ("the message channel closed before a
    // response was received") is internal and unstable, and a dapp cannot act on
    // it. A fixed code says the request did not complete; a retry then reports
    // whether the vault is locked.
    //
    // Only the call is inside this try. A failure to read the answer or to
    // post it back is a different fault and must not be reported as this one.
    sendResponse(id, undefined, RPC_ERROR_CODES.APPROVAL_FAILED);
    return;
  }

  const answer = readRpcAnswer(response);
  if (answer === undefined) {
    // No reply, or one that is not an RpcResponse: the page gets the same
    // "did not complete" code as a missing background. The shape is not
    // echoed, since the page is not entitled to the background's internals.
    console.warn("[Ostrilo] Background returned an unreadable response");
    sendResponse(id, undefined, RPC_ERROR_CODES.APPROVAL_FAILED);
    return;
  }

  if (answer.ok) {
    sendResponse(id, answer.data);
  } else {
    // A locked vault returns `locked` and nothing else happens.
    //
    // This used to send `openUnlockPrompt`, which opened the genuine
    // password popup. Any page could therefore make the real password
    // prompt appear on demand, as often as it liked, with no throttle -
    // which is both a nuisance and a training exercise in typing the
    // master password at an unexpected prompt. The extension signals a
    // refused-while-locked request through the toolbar badge instead,
    // which the page cannot drive.
    sendResponse(id, undefined, answer.errorCode);
  }
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.values(RPC_ERROR_CODES)
);

type RpcAnswer =
  | { ok: true; data: unknown }
  | { ok: false; errorCode: RpcErrorCode };

/**
 * The background's reply as something safe to act on, or undefined when it is
 * not a well-formed RpcResponse. A failure carries only a canonical code out:
 * a code this build does not define is treated as unreadable, so what reaches
 * the page is always one of `RPC_ERROR_CODES`.
 */
function readRpcAnswer(response: unknown): RpcAnswer | undefined {
  const reply = response as Partial<RpcResponse> | null | undefined;
  if (reply?.ok === true) return { ok: true, data: reply.data };
  if (reply?.ok !== false) return undefined;

  const errorCode = reply.error?.data?.errorCode;
  if (typeof errorCode !== "string" || !KNOWN_ERROR_CODES.has(errorCode)) {
    return undefined;
  }
  return { ok: false, errorCode: errorCode as RpcErrorCode };
}

/**
 * Send response back to injected script
 */
function sendResponse(id: string, result?: unknown, error?: string): void {
  const response: NostrResponseMessage = {
    type: "OSTRILO_NOSTR_RESPONSE",
    id,
    result,
    error,
  };
  // Targeted at this page's origin, not "*". A wildcard target means the
  // message is delivered whatever the document's origin turns out to be at
  // delivery time - including after a navigation - so a signed event could
  // be posted into a document the user never authorized.
  window.postMessage(response, window.location.origin);
}

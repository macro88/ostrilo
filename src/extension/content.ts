import { browser } from "wxt/browser";
import type { RpcRequest, RpcResponse } from "@/infrastructure/messaging/rpc";

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
  method: "getPublicKey" | "signEvent";
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
  if (!["getPublicKey", "signEvent"].includes(data.method)) return;

  // Get the page origin (trusted source)
  const origin = window.location.origin;

  try {
    let rpcRequest: RpcRequest;

    switch (data.method) {
      case "getPublicKey":
        // The SAME origin `signEvent` uses, computed above from
        // `window.location.origin` in this isolated world. Never from
        // `data`/`event.data`: the page owns that object and would simply
        // name whichever origin it wanted to be treated as.
        rpcRequest = {
          type: "nostr.getPublicKey",
          origin,
          clientRequestId: data.id,
        };
        break;

      case "signEvent":
        if (!data.params || typeof data.params !== "object") {
          sendResponse(data.id, undefined, "Invalid event parameter");
          return;
        }
        rpcRequest = {
          type: "nostr.signEvent",
          event: data.params as any,
          origin,
          // The page's own correlation id, carried so an abandoned request
          // can be withdrawn. The page cannot use it to approve anything.
          clientRequestId: data.id,
        };
        break;

      default:
        sendResponse(data.id, undefined, "Unknown method");
        return;
    }

    // Forward to background script
    const response = (await browser.runtime.sendMessage(
      rpcRequest
    )) as RpcResponse;

    if (response.ok) {
      sendResponse(data.id, response.data);
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
      const errorCode = response.error.data.errorCode;
      sendResponse(data.id, undefined, errorCode);
    }
  } catch (error) {
    sendResponse(
      data.id,
      undefined,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
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

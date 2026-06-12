import { browser } from "wxt/browser";
import type { RpcRequest, RpcResponse } from "@/infrastructure/messaging/rpc";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";

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

interface NostrResponseMessage {
  type: "OSTRILO_NOSTR_RESPONSE";
  id: string;
  result?: unknown;
  error?: string;
}

export default defineContentScript({
  // Match all HTTP/HTTPS origins for NIP-07 provider
  matches: ["http://*/*", "https://*/*"],

  // Run at document start to inject before page scripts
  runAt: "document_start",

  async main() {
    // Inject the window.nostr provider script into the MAIN world
    // Using WXT's injectScript helper which handles web_accessible_resources
    await injectScript("/injected.js", {
      keepInDom: true,
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
  // Only accept messages from same window
  if (event.source !== window) return;

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
        rpcRequest = { type: "nostr.getPublicKey" };
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
      const errorCode = response.error.data.errorCode;
      // Handle locked vault - prompt user to unlock
      if (errorCode === RPC_ERROR_CODES.LOCKED) {
        console.log(
          "[Ostrilo Content] Vault is locked, attempting to open unlock prompt"
        );
        try {
          // Try to open the extension popup to prompt unlock
          await browser.runtime.sendMessage({ type: "openUnlockPrompt" });
          // Send error to page script with helpful message
          sendResponse(data.id, undefined, errorCode);
        } catch (err) {
          console.warn(
            "[Ostrilo Content] Failed to open unlock prompt:",
            err
          );
          sendResponse(data.id, undefined, errorCode);
        }
      } else {
        sendResponse(data.id, undefined, errorCode);
      }
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
  window.postMessage(response, "*");
}

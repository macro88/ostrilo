/**
 * NIP-07 window.nostr provider injection script
 * This script runs in the MAIN world (page context) to expose window.nostr API
 *
 * Communication flow:
 * 1. Page calls window.nostr.getPublicKey() or window.nostr.signEvent(event)
 * 2. This script sends a message to content script via window.postMessage
 * 3. Content script relays to background via browser.runtime.sendMessage
 * 4. Background processes and returns result through same chain
 */

export default defineUnlistedScript(() => {
  // Message types for communication with content script
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

  // Pending request tracking
  const pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  // Generate unique request ID
  function generateRequestId(): string {
    return `ostrilo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Send request to content script and wait for response
  function sendRequest(
    method: "getPublicKey" | "signEvent",
    params?: unknown
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = generateRequestId();

      // Set timeout for request (30 seconds for signing which may need user approval)
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error("Request timeout"));
      }, 30000);

      // Wrap resolve/reject to clear timeout
      const wrappedResolve = (value: unknown) => {
        clearTimeout(timeout);
        resolve(value);
      };
      const wrappedReject = (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      };

      pendingRequests.set(id, {
        resolve: wrappedResolve,
        reject: wrappedReject,
      });

      // Send message to content script
      const message: NostrRequestMessage = {
        type: "OSTRILO_NOSTR_REQUEST",
        id,
        method,
        params,
      };

      window.postMessage(message, "*");
    });
  }

  // Listen for responses from content script
  window.addEventListener("message", (event) => {
    // Only accept messages from same window
    if (event.source !== window) return;

    const data = event.data as NostrResponseMessage;
    if (data?.type !== "OSTRILO_NOSTR_RESPONSE") return;

    const pending = pendingRequests.get(data.id);
    if (!pending) return;

    pendingRequests.delete(data.id);

    if (data.error) {
      pending.reject(new Error(data.error));
    } else {
      pending.resolve(data.result);
    }
  });

  // NIP-07 window.nostr implementation
  const nostr = {
    /**
     * Get the public key of the currently selected identity
     * @returns Promise resolving to hex-encoded public key
     */
    async getPublicKey(): Promise<string> {
      const result = (await sendRequest("getPublicKey")) as { pubkey: string };
      return result.pubkey;
    },

    /**
     * Sign an unsigned Nostr event
     * @param event - The unsigned event to sign
     * @returns Promise resolving to the signed event
     */
    async signEvent(event: {
      kind: number;
      content: string;
      tags: string[][];
      created_at: number;
      pubkey?: string;
    }): Promise<{
      id: string;
      pubkey: string;
      created_at: number;
      kind: number;
      tags: string[][];
      content: string;
      sig: string;
    }> {
      const result = (await sendRequest("signEvent", event)) as {
        event: {
          id: string;
          pubkey: string;
          created_at: number;
          kind: number;
          tags: string[][];
          content: string;
          sig: string;
        };
      };
      return result.event;
    },

    // NIP-04 placeholder - to be implemented in future
    nip04: {
      async encrypt(_pubkey: string, _plaintext: string): Promise<string> {
        throw new Error("NIP-04 encryption not yet implemented");
      },
      async decrypt(_pubkey: string, _ciphertext: string): Promise<string> {
        throw new Error("NIP-04 decryption not yet implemented");
      },
    },

    // NIP-44 placeholder - to be implemented in future
    nip44: {
      async encrypt(_pubkey: string, _plaintext: string): Promise<string> {
        throw new Error("NIP-44 encryption not yet implemented");
      },
      async decrypt(_pubkey: string, _ciphertext: string): Promise<string> {
        throw new Error("NIP-44 decryption not yet implemented");
      },
    },
  };

  // Define window.nostr as non-writable, non-configurable to prevent tampering
  Object.defineProperty(window, "nostr", {
    value: nostr,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  console.log("[Ostrilo] NIP-07 window.nostr provider injected");
});

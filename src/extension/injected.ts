import {
  APPROVAL_TIMEOUT_MS,
  PROVIDER_TIMEOUT_GRACE_MS,
} from "@/application/services/approval-queue.service";
import {
  PROVIDER_METHODS,
  type ProviderMethod,
} from "@/domain/nostr/provider-methods";

/**
 * NIP-07 window.nostr provider injection script
 * This script runs in the MAIN world (page context) to expose window.nostr API
 *
 * Communication flow:
 * 1. Page calls window.nostr.getPublicKey() or window.nostr.signEvent(event)
 * 2. This script sends a message to content script via window.postMessage
 * 3. Content script relays to background via browser.runtime.sendMessage
 * 4. Background processes and returns result through same chain
 *
 * This script runs in the PAGE's realm, alongside whatever the page loaded. It
 * therefore cannot trust anything it reaches through a global after page script
 * has run: a page can replace `window.postMessage`, `JSON.stringify` or
 * `Promise` and observe or rewrite everything that passes through. The
 * intrinsics are captured once, at document_start, before page script executes.
 *
 * None of that protects the user's KEY - the key never enters this realm. It
 * protects the integrity of the request the user is shown in the approval
 * dialog, and it stops a page silently intercepting another script's signature.
 */

// aislop-ignore-next-line eslint/no-undef -- wxt auto-import; declared in .wxt/types/imports.d.ts, which this scan excludes as generated code. pnpm run compile is the authority on undefined identifiers here.
export default defineUnlistedScript(() => {
  // Intrinsics captured at injection time, before page script can run.
  const postMessage = window.postMessage.bind(window);
  const addEventListener = window.addEventListener.bind(window);
  const setTimeout = window.setTimeout.bind(window);
  const clearTimeout = window.clearTimeout.bind(window);
  const randomUUID = crypto.randomUUID.bind(crypto);
  const NativePromise = Promise;
  const freeze = Object.freeze;
  const pageOrigin = window.location.origin;

  // Message types for communication with content script
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

  // Pending request tracking
  const pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  /**
   * The page-side backstop deadline.
   *
   * The extension-side approval deadline is authoritative. This one fires
   * strictly later, and only exists so a page is not left with a promise that
   * never settles if the extension goes away mid-request.
   *
   * It used to be a hard-coded 30 seconds against an extension-side 60. A user
   * who approved at 45 seconds produced a real signature over a real event
   * that this side had already rejected and discarded. The signature existed;
   * nobody received it.
   */
  const PROVIDER_DEADLINE_MS = APPROVAL_TIMEOUT_MS + PROVIDER_TIMEOUT_GRACE_MS;

  // Send request to content script and wait for response
  function sendRequest(
    method: ProviderMethod,
    params?: unknown
  ): Promise<unknown> {
    return new NativePromise((resolve, reject) => {
      // Unguessable. The old ids were `ostrilo_<Date.now()>_<Math.random()>`,
      // which another script in the same page could predict closely enough to
      // post a forged OSTRILO_NOSTR_RESPONSE and resolve someone else's
      // signEvent with a value of its choosing.
      const id = randomUUID();

      const timeout = setTimeout(() => {
        if (!pendingRequests.delete(id)) return;
        // Tell the extension to withdraw the prompt. Without this, the user is
        // still looking at a dialog for a request nobody is waiting for, and
        // approving it produces a signature that goes nowhere.
        postMessage(
          { type: "OSTRILO_NOSTR_CANCEL", id } as NostrCancelMessage,
          pageOrigin
        );
        reject(new Error("timeout"));
      }, PROVIDER_DEADLINE_MS);

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

      const message: NostrRequestMessage = {
        type: "OSTRILO_NOSTR_REQUEST",
        id,
        method,
        params,
      };

      postMessage(message, pageOrigin);
    });
  }

  // Listen for responses from content script
  addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.origin !== pageOrigin) return;

    const data = event.data as NostrResponseMessage;
    if (data?.type !== "OSTRILO_NOSTR_RESPONSE") return;

    // A request id that is not pending has already settled - by response, by
    // deadline, or because it was never ours. A late or duplicate response for
    // it is dropped rather than resolving anything a second time.
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
  //
  // `nip04` and `nip44` are deliberately absent. They were advertised as
  // capabilities whose every method threw, so NIP-07 feature detection - the
  // whole point of which is `if (window.nostr.nip44)` - returned true and then
  // failed at call time. An honest absence is a working feature check.
  //
  // `satisfies Record<ProviderMethod, unknown>` makes the compiler reject a
  // method missing from, or extra to, `PROVIDER_METHODS`, which is also what
  // `capabilities.methods` reports.
  const methods = {
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
  } satisfies Record<ProviderMethod, unknown>;

  // What a dApp can feature-detect. Only names the provider implements: no
  // extension version, build id or anything else that tells a page more about
  // the user's setup than the methods it can already call.
  //
  // Built with indexed reads and writes, not spread or `for...of`: those go
  // through `Array.prototype[Symbol.iterator]`, which page script can replace,
  // and a replaced iterator is page code running in the middle of building the
  // provider.
  const advertisedMethods: ProviderMethod[] = [];
  for (let i = 0; i < PROVIDER_METHODS.length; i++) {
    advertisedMethods[i] = PROVIDER_METHODS[i];
  }
  const capabilities = freeze({ methods: freeze(advertisedMethods) });

  const nostr = { ...methods, capabilities };

  // Never overwrite an existing provider: another signer may have got here
  // first, and silently replacing it would hijack the user's chosen extension.
  if ("nostr" in window) {
    console.warn(
      "[Ostrilo] window.nostr already defined; leaving the existing provider in place."
    );
    return;
  }

  for (let i = 0; i < PROVIDER_METHODS.length; i++) {
    freeze(methods[PROVIDER_METHODS[i]]);
  }
  freeze(nostr);

  try {
    // Non-writable and non-configurable. A plain assignment left `window.nostr`
    // as an ordinary writable property, so any script that ran afterwards could
    // replace `signEvent` with its own and sit between the page and the user's
    // signer - reading every event before it was signed, or substituting one.
    Object.defineProperty(window, "nostr", {
      value: nostr,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  // aislop-ignore-next-line ai-slop/silent-recovery -- reaching this catch means another extension defined a non-configurable `window.nostr` between the `in` check and here. Leaving it alone is the correct behavior: replacing it would hijack the user's chosen signer, and throwing would throw into the page. The caught value comes from the untrusted page realm and is deliberately not logged; a fixed warning string is emitted instead.
  } catch {
    // Already non-configurable, defined by something else between the `in`
    // check and here. Leave it alone rather than throwing into the page.
    console.warn("[Ostrilo] Could not define window.nostr.");
  }
});

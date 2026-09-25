import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";
import type {
  SignedEvent,
  UnsignedEvent,
  ApprovalDecision,
  ApprovalAction,
} from "@/domain/types";
import {
  UnsignedEventSchema,
  OriginSchema,
} from "@/infrastructure/validation/schemas";
import { computeEventId } from "@/application/crypto/event-id";
import { NobleSha256 } from "@/infrastructure/crypto/adapters";
import { isProtectedKind } from "@/domain/policy/trust-definitions";
import {
  ApprovalQueueService,
  ApprovalRateLimitError,
} from "@/application/services/approval-queue.service";
import { browser } from "wxt/browser";

/** Approval popup dimensions */
const POPUP_WIDTH = 960;
const POPUP_HEIGHT = 640;
const APPROVAL_BADGE_COLOR = "#5f50a0";

/**
 * RPC handler for NIP-07 Nostr operations
 * Handles: nostr.getPublicKey, nostr.signEvent
 */
/**
 * The vault errors that mean "locked", not "refused".
 *
 * `no_unlocked_key` used to fall through to the generic handler and surface
 * as `denied`, which told a dapp its request had been rejected on policy
 * grounds. It retried instead of prompting the user to unlock, and the raw
 * message went out on a wire a web page can read.
 */
export const VAULT_LOCKED_ERRORS: readonly string[] = [
  // aislop-ignore-next-line ai-slop/hardcoded-id -- internal error contract: the service error string this handler recognises as "vault is locked". Not a deployment identifier or credential.
  "key_locked_or_missing",
  "no_unlocked_key",
];

export function isVaultLockedError(message: unknown): boolean {
  return typeof message === "string" && VAULT_LOCKED_ERRORS.includes(message);
}

export class NostrRpcHandler implements RpcModule {
  constructor(
    private approvalQueue?: ApprovalQueueService,
    private windowManager?: () => Promise<number | undefined>
  ) {}

  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const method = message.type;
    switch (message.type) {
      case "nostr.getPublicKey":
        return this.handleGetPublicKey(message, context);

      case "nostr.cancelRequest":
        return this.handleCancelRequest(message);

      case "nostr.signEvent":
        return this.handleSignEvent(message, context);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: method,
          method,
        });
    }
  }

  /**
   * Handle nostr.getPublicKey - returns hex public key of selected key.
   *
   * This used to take only `context`: the message type carried no fields and
   * the dispatcher dropped it, so the handler could not know who was asking
   * even if it had wanted to. It answered any https page, silently, as often
   * as it was called.
   *
   * The order below is fixed and must stay fixed:
   *
   *   origin validation -> locked -> rate limit -> selected key
   *
   * Origin first, because everything after it is per-origin and a request with
   * no usable origin cannot be rate limited, logged or consented to. The rate
   * limit is charged BEFORE the key is read, so a polling origin cannot spend
   * the vault's work on every call.
   */
  private async handleGetPublicKey(
    message: Extract<RpcRequest, { type: "nostr.getPublicKey" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate origin, matching handleSignEvent. Note OriginSchema accepts
    // http: as well as https: - the https guarantee comes from the content
    // script's match pattern, not from here.
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
        details: originValidation.error.issues[0]?.message,
        method: message.type,
      });
    }
    const origin = message.origin;

    // Defence in depth. The router's lock gate already refuses this method
    // while locked, because it is absent from LOCKED_REACHABLE_METHODS, so in
    // practice a locked vault never reaches here. Keeping the check means the
    // handler is still correct if that allowlist ever changes.
    const lockState = await context.vault.getLockState();
    if (lockState.isLocked) {
      return createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, {
        method: message.type,
      });
    }

    // Charged before the key is read, and never when the origin is over its
    // allowance. A refusal here queues nothing and prompts nobody.
    if (!context.disclosureRateLimit.tryConsume(origin)) {
      await context.activityLog.addEntry({
        origin,
        operation: "identity_disclosure",
        decision: "deny",
        reason: "rate_limited",
      });
      return createRpcErrorResponse(RPC_ERROR_CODES.RATE_LIMITED, {
        details: "Too many identity requests from this site.",
        method: message.type,
      });
    }

    // Get the selected key
    const keys = await context.vault.listKeys();
    const selectedKey = keys.find((k) => k.isSelected);

    if (!selectedKey) {
      return createRpcErrorResponse(RPC_ERROR_CODES.NO_KEY_SELECTED, {
        method: message.type,
      });
    }

    // Recorded consent. UNDEFINED IS NOT CONSENT - it is the prompting state.
    // Nothing infers consent from a stored policy record, a trust level or a
    // per-kind rule: such a record is written whenever a signing decision is
    // made, INCLUDING a refusal, and `low` is the level assigned by default
    // when one is created as a side effect. So its existence is evidence of a
    // signing decision and of nothing else. No origin is grandfathered.
    const recorded = await context.policy.getIdentityDisclosure(origin);

    if (recorded === "deny") {
      // Answered without a prompt. Without this, any https origin could
      // re-summon a focused OS window on every page load - the abuse shape this
      // codebase removed once already when it deleted `openUnlockPrompt`.
      await context.activityLog.addEntry({
        origin,
        operation: "identity_disclosure",
        decision: "deny",
        reason: "remembered",
      });
      return createRpcErrorResponse(RPC_ERROR_CODES.DISCLOSURE_REFUSED, {
        details: "This site is not allowed to read your public key.",
        method: message.type,
      });
    }

    if (recorded !== "allow") {
      if (!this.approvalQueue) {
        return createRpcErrorResponse(RPC_ERROR_CODES.NEEDS_APPROVAL, {
          method: message.type,
        });
      }

      let decision: ApprovalDecision | "timeout";
      try {
        decision = await this.requestDisclosureApproval(
          origin,
          selectedKey.pubkey,
          message.clientRequestId
        );
      } catch (error) {
        // A flooding origin gets a distinct, honest code, matching signEvent.
        if (error instanceof ApprovalRateLimitError) {
          await context.activityLog.addEntry({
            origin,
            operation: "identity_disclosure",
            decision: "deny",
            reason: "rate_limited",
          });
          return createRpcErrorResponse(RPC_ERROR_CODES.RATE_LIMITED, {
            details: "Too many pending requests from this site.",
            method: message.type,
          });
        }
        return createRpcErrorResponse(RPC_ERROR_CODES.APPROVAL_FAILED, {
          details: "Could not ask for approval",
          method: message.type,
        });
      }

      if (decision === "timeout") {
        await context.activityLog.addEntry({
          origin,
          operation: "identity_disclosure",
          decision: "deny",
          reason: "timeout",
        });
        return createRpcErrorResponse(RPC_ERROR_CODES.TIMEOUT, {
          details: "Approval request timed out",
          method: message.type,
        });
      }

      if (decision !== "allow") {
        await context.activityLog.addEntry({
          origin,
          operation: "identity_disclosure",
          decision: "deny",
          reason: "user",
        });
        return createRpcErrorResponse(RPC_ERROR_CODES.DISCLOSURE_REFUSED, {
          details: "You refused to share your public key with this site.",
          method: message.type,
        });
      }
    }

    // The origin is recorded verbatim. The public key is NOT written into any
    // free-text field: `keyId` is the record identifier, not the key. An
    // auto-allowed read from a remembered grant is logged exactly like a
    // freshly approved one - the point of the log is that the user can see
    // every read, not only the ones they were asked about.
    await context.activityLog.addEntry({
      origin,
      operation: "identity_disclosure",
      decision: "allow",
      reason: recorded === "allow" ? "remembered" : "user",
      keyId: selectedKey.id,
    });

    return {
      ok: true,
      data: { pubkey: selectedKey.pubkey },
    };
  }

  /**
   * Queue a prompt asking whether this origin may read the public key.
   *
   * De-duplicates on `(origin, "identity_disclosure")` inside the queue, so a
   * page calling `getPublicKey` in a loop produces ONE prompt whose answer fans
   * out to every waiting caller - not one prompt per call.
   */
  private async requestDisclosureApproval(
    origin: string,
    pubkey: string,
    clientRequestId?: string
  ): Promise<ApprovalDecision | "timeout"> {
    return new Promise<ApprovalDecision | "timeout">((resolve, reject) => {
      const pendingRequest = this.approvalQueue!.enqueueDisclosure(
        origin,
        (decision: ApprovalDecision, _action: ApprovalAction) => {
          if (
            decision === "deny" &&
            this.approvalQueue!.wasTimeout(pendingRequest.id)
          ) {
            resolve("timeout");
          } else {
            resolve(decision);
          }
        },
        { signingPubkey: pubkey, clientRequestId }
      );

      this.openApprovalPopup(pendingRequest.id).catch((err) => {
        // Popup failed: deny. A disclosure that cannot be asked about must not
        // be granted.
        this.approvalQueue!.resolve(pendingRequest.id, "deny");
        reject(new Error(`Failed to open approval popup: ${err.message}`));
      });
    });
  }

  /**
   * Handle nostr.signEvent - sign an event with the selected key
   */
  private async handleSignEvent(
    message: Extract<RpcRequest, { type: "nostr.signEvent" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate the event FIRST, before the lock check, the policy
    // evaluation, the event-id hash or any queue entry. The schema now
    // carries size bounds, and the point of checking here is that an
    // oversized payload never reaches computeEventId inside the service
    // worker and never occupies a slot in the approval queue.
    const eventValidation = UnsignedEventSchema.safeParse(message.event);
    if (!eventValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_EVENT, {
        details: eventValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Validate origin
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
        details: originValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Check if vault is unlocked
    const lockState = await context.vault.getLockState();
    if (lockState.isLocked) {
      // Just the error. Nothing opens: the page-triggered unlock popup is
      // gone, and the background raises a toolbar marker instead.
      console.log("[NostrRpcHandler] Vault is locked, refusing to sign");
      return createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, {
        details: "Extension is locked. Please unlock to sign events.",
        method: message.type,
      });
    }

    // Get the selected key
    const keys = await context.vault.listKeys();
    const selectedKey = keys.find((k) => k.isSelected);

    if (!selectedKey) {
      return createRpcErrorResponse(RPC_ERROR_CODES.NO_KEY_SELECTED, {
        method: message.type,
      });
    }

    const event = message.event as UnsignedEvent;
    const pubkey = selectedKey.pubkey;

    // Evaluate policy for this origin and event kind
    const policyResult = await context.policy.evaluate({
      origin: message.origin,
      kind: event.kind,
    });

    if (policyResult.mode === "deny") {

      // If policy denied due to lock state mismatch, return LOCKED error instead
      if (policyResult.reason === "locked") {
        console.warn(
          "[NostrRpcHandler] Policy denied due to lock state - vault check passed but policy check failed!"
        );
        return createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, {
          details: "Extension is locked. Please unlock to sign events.",
          method: message.type,
        });
      }

      // Record denial in activity log
      await context.activityLog.addEntry({
        origin: message.origin,
        kind: event.kind,
        decision: "deny",
        contentPreview: event.content.substring(0, 100),
      });

      return createRpcErrorResponse(RPC_ERROR_CODES.DENIED, {
        details: `Policy denied: ${policyResult.reason}`,
        method: message.type,
      });
    }

    const requiresApproval =
      policyResult.mode === "ask" ||
      (policyResult.mode === "allow" && isProtectedKind(event.kind));

    if (requiresApproval) {
      // Need approval - queue the request and open popup
      if (!this.approvalQueue) {
        // No queue configured - fall back to error
        console.log("[NostrRpcHandler] No approval queue configured!");
        return createRpcErrorResponse(RPC_ERROR_CODES.NEEDS_APPROVAL, {
          method: message.type,
        });
      }

      try {
        // Compute event ID for de-duplication
        const eventIdHash = computeEventId(NobleSha256, {
          pubkey,
          created_at: event.created_at,
          kind: event.kind,
          tags: event.tags,
          content: event.content,
        });

        // Wait for user approval
        const decision = await this.requestApproval(
          message.origin,
          event,
          pubkey,
          eventIdHash,
          message.clientRequestId
        );

        console.log("[NostrRpcHandler] Approval decision:", decision);

        // Handle timeout separately
        if (decision === "timeout") {
          // Record timeout as denial
          await context.activityLog.addEntry({
            origin: message.origin,
            kind: event.kind,
            decision: "deny",
            contentPreview: event.content.substring(0, 100),
          });

          return createRpcErrorResponse(RPC_ERROR_CODES.TIMEOUT, {
            details: "Approval request timed out",
            method: message.type,
          });
        }

        if (decision !== "allow") {
          // Record user denial
          await context.activityLog.addEntry({
            origin: message.origin,
            kind: event.kind,
            decision: "deny",
            contentPreview: event.content.substring(0, 100),
          });

          return createRpcErrorResponse(RPC_ERROR_CODES.DENIED, {
            details: "user rejected",
            method: message.type,
          });
        }
        // Fall through to signing if approved
      } catch (error) {
        // A flooding origin gets a distinct, honest code. Reporting this as
        // a generic failure would tell a well-behaved dapp to retry, which
        // is exactly the wrong advice.
        if (error instanceof ApprovalRateLimitError) {
          console.warn(
            `[NostrRpcHandler] Refused enqueue from ${message.origin}: ${error.reason}`
          );
          return createRpcErrorResponse(RPC_ERROR_CODES.RATE_LIMITED, {
            details: "Too many pending approval requests",
            method: message.type,
          });
        }
        console.error("[NostrRpcHandler] Approval error:", error);
        return createRpcErrorResponse(RPC_ERROR_CODES.APPROVAL_FAILED, {
          // Fixed string: the raw message is internal and this response
          // reaches a web page.
          details: "Approval failed",
          method: message.type,
        });
      }
    }

    // Policy allows (or user approved) - proceed with signing
    try {
      // Compute event ID using NIP-01 format
      const eventId = computeEventId(NobleSha256, {
        pubkey,
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags,
        content: event.content,
      });

      // Sign the event hash with the selected key
      const signResult = await context.vault.sign(eventId, selectedKey.id);

      if (!signResult || !signResult.sigHex) {
        return createRpcErrorResponse(RPC_ERROR_CODES.SIGNING_FAILED, {
          method: message.type,
        });
      }

      // Construct the signed event
      const signedEvent: SignedEvent = {
        id: eventId,
        pubkey,
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags,
        content: event.content,
        sig: signResult.sigHex,
      };

      // Record successful signing in activity log
      await context.activityLog.addEntry({
        origin: message.origin,
        kind: event.kind,
        decision: "allow",
        contentPreview: event.content.substring(0, 100),
        keyId: selectedKey.id,
      });

      // Postpone the auto-lock, but only if a person is actually here.
      //
      // Reacting to a post is kind 7, which high trust signs without a prompt,
      // so a user working through a feed generates no interaction the
      // extension used to count - and got locked out mid-read. Counting every
      // silent signature instead would let a pinned tab publishing a relay
      // list on a timer hold an unattended vault open forever. The idle state
      // is the only evidence here that the requesting page cannot fabricate.
      //
      // AFTER the signature, and deliberately not awaited into the result: the
      // vault was unlocked and policy allowed this request, so the signature is
      // owed regardless of where the user's mouse has been. A presence check
      // must never become a way to refuse one.
      // try/catch, not `.catch()`: a missing or misconfigured presence service
      // throws on property access, before any promise exists, and a rejection
      // handler would never see it. The event is already signed at this point,
      // so anything that escapes here would convert a completed signature into
      // an error response - the exact failure this whole block must not cause.
      // Not recording is the safe outcome: the deadline stands and the vault
      // locks on the old schedule.
      try {
        await context.presence.recordIfPresent(() =>
          context.vault.touchActivity()
        );
      } catch (err) {
        console.warn("[NostrRpcHandler] activity not recorded:", err);
      }

      return {
        ok: true,
        data: { event: signedEvent },
      };
    } catch (error) {
      // Translate service errors to RPC codes
      if (error instanceof Error) {
        if (isVaultLockedError(error.message)) {
          return createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, {
            method: message.type,
          });
        }
        if (error.message === "hash_must_be_32_bytes") {
          return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_HASH, {
            details: "Event ID must be 32 bytes",
            method: message.type,
          });
        }
      }
      // Generic signing error fallback
      // Fixed string. The raw message is an internal identifier and does
      // not belong on a wire a web page can read.
      return createRpcErrorResponse(RPC_ERROR_CODES.DENIED, {
        details: "Signing failed",
        method: message.type,
      });
    }
  }

  /**
   * Request user approval for signing an event
   * Opens the approval popup and waits for user decision
   *
   * @param origin - The origin of the requesting dapp
   * @param event - The unsigned event to sign
   * @returns Promise resolving to the user's decision or "timeout" if timed out
   */
  /**
   * Request user approval for signing an event
   * Opens the approval popup and waits for user decision
   *
   * @param origin - The origin of the requesting dapp
   * @param event - The unsigned event to sign
   * @param pubkey - The public key hex that will sign the event
   * @param eventIdHash - Computed event ID hash for de-duplication
   * @returns Promise resolving to the user's decision or "timeout" if timed out
   */
  /**
   * Withdraw a request the page abandoned. Always a denial.
   *
   * There is no approving counterpart and there must not be: a page-
   * reachable path that resolved an approval as allowed would be a way to
   * sign without asking anyone. The origin comes from the content script,
   * not from the page, so one site cannot cancel another's prompt.
   */
  private async handleCancelRequest(
    message: Extract<RpcRequest, { type: "nostr.cancelRequest" }>
  ): Promise<RpcResponse> {
    const cancelled =
      this.approvalQueue?.cancelByClientRequestId(
        message.origin,
        message.clientRequestId
      ) ?? false;
    return { ok: true, data: { cancelled } };
  }

  private async requestApproval(
    origin: string,
    event: UnsignedEvent,
    pubkey: string,
    eventIdHash: string,
    clientRequestId?: string
  ): Promise<ApprovalDecision | "timeout"> {
    return new Promise<ApprovalDecision | "timeout">((resolve, reject) => {
      // Enqueue the request with event ID hash for de-duplication
      const pendingRequest = this.approvalQueue!.enqueue(
        origin,
        event,
        (decision: ApprovalDecision, _action: ApprovalAction) => {

          // Check if this was a timeout
          if (
            decision === "deny" &&
            this.approvalQueue!.wasTimeout(pendingRequest.id)
          ) {
            resolve("timeout");
          } else {
            resolve(decision);
          }
        },
        eventIdHash,
        // The key that will actually sign, bound to the request here, so the
        // dialog cannot show a different one if the user switches keys while
        // the prompt is open.
        { signingPubkey: pubkey, clientRequestId }
      );

      // Open approval popup
      this.openApprovalPopup(pendingRequest.id).catch((err) => {
        console.error(
          "[NostrRpcHandler] Popup open failed, denying request:",
          err
        );
        // If popup fails to open, reject the request
        this.approvalQueue!.resolve(pendingRequest.id, "deny");
        reject(new Error(`Failed to open approval popup: ${err.message}`));
      });
    });
  }

  /**
   * Open or focus the approval popup window
   * Uses window manager callback if provided, otherwise creates new window
   * @param requestId - The ID of the pending request
   */
  private async openApprovalPopup(requestId: string): Promise<void> {

    try {
      let windowId: number | undefined;

      if (this.windowManager) {
        // Use window manager callback to focus/create window (may return undefined in sidepanel mode)
        windowId = await this.windowManager();
      } else {
        // Fallback: Create new popup window (old behavior)
        const approvalUrl = browser.runtime.getURL(
          `/approval.html?requestId=${encodeURIComponent(
            requestId
          )}` as `/popup.html${string}`
        );

        const win = await browser.windows.create({
          url: approvalUrl,
          type: "popup",
          width: POPUP_WIDTH,
          height: POPUP_HEIGHT,
          focused: true,
        });

        if (typeof win?.id !== "number") {
          throw new Error("Approval popup was created without a window ID");
        }

        windowId = win.id;
      }

      // If windowId is undefined, we're in sidepanel mode and the message was sent to switch tabs
      if (windowId === undefined) {
        return;
      }

      // Update badge with pending count
      await this.updateBadgeCount();

    } catch (err) {
      console.error("[NostrRpcHandler] Failed to open approval popup:", err);

      // Fallback: Update badge to alert user
      try {
        await this.updateBadgeCount();
        console.log("[NostrRpcHandler] Badge updated as fallback");
      } catch (badgeErr) {
        console.error("[NostrRpcHandler] Failed to update badge:", badgeErr);
      }

      throw err;
    }
  }

  /**
   * Update badge to show count of pending approval requests
   * Shows number on extension icon when there are pending requests
   */
  private async updateBadgeCount(): Promise<void> {
    try {
      const count = this.approvalQueue?.count() ?? 0;

      if (count > 0) {
        await Promise.all([
          browser.action.setBadgeText({ text: count.toString() }),
          browser.action.setBadgeBackgroundColor({
            color: APPROVAL_BADGE_COLOR,
          }),
          browser.action.setTitle({
            title: `Ostrilo - ${count} approval${count > 1 ? "s" : ""} pending`,
          }),
        ]);
      } else {
        // Clear badge when no pending requests
        await Promise.all([
          browser.action.setBadgeText({ text: "" }),
          browser.action.setTitle({ title: "Ostrilo Signer" }),
        ]);
      }
    } catch (err) {
      console.error("[NostrRpcHandler] Failed to update badge:", err);
      throw err;
    }
  }
}

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
    switch (message.type) {
      case "nostr.getPublicKey":
        return this.handleGetPublicKey(context);

      case "nostr.cancelRequest":
        return this.handleCancelRequest(message);

      case "nostr.signEvent":
        return this.handleSignEvent(message, context);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: (message as any).type,
          method: (message as any).type,
        });
    }
  }

  /**
   * Handle nostr.getPublicKey - returns hex public key of selected key
   */
  private async handleGetPublicKey(
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Check if vault is unlocked
    const lockState = await context.vault.getLockState();
    if (lockState.isLocked) {
      return createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, {
        method: "nostr.getPublicKey",
      });
    }

    // Get the selected key
    const keys = await context.vault.listKeys();
    const selectedKey = keys.find((k) => k.isSelected);

    if (!selectedKey) {
      return createRpcErrorResponse(RPC_ERROR_CODES.NO_KEY_SELECTED, {
        method: "nostr.getPublicKey",
      });
    }

    return {
      ok: true,
      data: { pubkey: selectedKey.pubkey },
    };
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
    console.log(
      "[NostrRpcHandler] Vault lock state:",
      lockState.isLocked ? "LOCKED" : "UNLOCKED"
    );
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

    console.log(
      "[NostrRpcHandler] Policy result for",
      message.origin,
      "kind",
      event.kind,
      ":",
      policyResult
    );

    if (policyResult.mode === "deny") {
      console.log(
        "[NostrRpcHandler] Policy denied request. Reason:",
        policyResult.reason
      );

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

      console.log(
        "[NostrRpcHandler] Policy requires approval, opening popup..."
      );

      try {
        // Compute event ID for de-duplication
        const eventIdHash = computeEventId(NobleSha256, {
          pubkey,
          created_at: event.created_at,
          kind: event.kind,
          tags: event.tags,
          content: event.content,
        });

        console.log(
          `[NostrRpcHandler] Computed event ID hash: ${eventIdHash.substring(
            0,
            16
          )}...`
        );

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
          console.log(
            "[NostrRpcHandler] Request resolved with decision:",
            decision
          );

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

      console.log(
        "[NostrRpcHandler] Queued approval request:",
        pendingRequest.id
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
    console.log(
      `[NostrRpcHandler] Opening/focusing approval window for request ${requestId}`
    );
    console.log(
      "[NostrRpcHandler] windowManager available:",
      !!this.windowManager
    );

    try {
      let windowId: number | undefined;

      if (this.windowManager) {
        // Use window manager callback to focus/create window (may return undefined in sidepanel mode)
        console.log("[NostrRpcHandler] Calling windowManager...");
        windowId = await this.windowManager();
        console.log("[NostrRpcHandler] windowManager returned:", windowId);
      } else {
        // Fallback: Create new popup window (old behavior)
        console.log(
          "[NostrRpcHandler] No windowManager, creating popup directly"
        );
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
        console.log(
          "[NostrRpcHandler] Sidepanel mode - message sent to switch to Activity tab"
        );
        return;
      }

      // Update badge with pending count
      await this.updateBadgeCount();

      console.log(
        `[NostrRpcHandler] Approval window ready, window id: ${windowId}`
      );
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

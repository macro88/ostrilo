import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES } from "../error-codes";
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
import {
  computeEventId,
  signEventHash,
  publicKeyToHex,
} from "@/domain/utils/crypto";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";
import { browser } from "wxt/browser";

/** Approval popup dimensions */
const POPUP_WIDTH = 640;
const POPUP_HEIGHT = 640;

/**
 * RPC handler for NIP-07 Nostr operations
 * Handles: nostr.getPublicKey, nostr.signEvent
 */
export class NostrRpcHandler implements RpcModule {
  constructor(private approvalQueue?: ApprovalQueueService) {}

  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "nostr.getPublicKey":
        return this.handleGetPublicKey(context);

      case "nostr.signEvent":
        return this.handleSignEvent(message, context);

      default:
        return {
          ok: false,
          error: RPC_ERROR_CODES.UNKNOWN_METHOD,
          details: (message as any).type,
        };
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
      return {
        ok: false,
        error: RPC_ERROR_CODES.LOCKED,
      };
    }

    // Get the selected key
    const keys = await context.vault.listKeys();
    const selectedKey = keys.find((k) => k.isSelected);

    if (!selectedKey) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.NO_KEY_SELECTED,
      };
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
    // Validate event
    const eventValidation = UnsignedEventSchema.safeParse(message.event);
    if (!eventValidation.success) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.INVALID_EVENT,
        details: eventValidation.error.issues[0]?.message,
      };
    }

    // Validate origin
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.INVALID_ORIGIN,
        details: originValidation.error.issues[0]?.message,
      };
    }

    // Check if vault is unlocked
    const lockState = await context.vault.getLockState();
    console.log(
      "[NostrRpcHandler] Vault lock state:",
      lockState.isLocked ? "LOCKED" : "UNLOCKED"
    );
    if (lockState.isLocked) {
      console.log(
        "[NostrRpcHandler] Vault is locked, returning LOCKED error to trigger unlock prompt"
      );
      return {
        ok: false,
        error: RPC_ERROR_CODES.LOCKED,
        details: "Extension is locked. Please unlock to sign events.",
      };
    }

    // Get the selected key
    const keys = await context.vault.listKeys();
    const selectedKey = keys.find((k) => k.isSelected);

    if (!selectedKey) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.NO_KEY_SELECTED,
      };
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
        return {
          ok: false,
          error: RPC_ERROR_CODES.LOCKED,
          details: "Extension is locked. Please unlock to sign events.",
        };
      }

      // Record denial in activity log
      await context.activityLog.addEntry({
        origin: message.origin,
        kind: event.kind,
        decision: "deny",
        contentPreview: event.content.substring(0, 100),
      });

      return {
        ok: false,
        error: RPC_ERROR_CODES.DENIED,
        details: `Policy denied: ${policyResult.reason}`,
      };
    }

    if (policyResult.mode === "ask") {
      // Need approval - queue the request and open popup
      if (!this.approvalQueue) {
        // No queue configured - fall back to error
        console.log("[NostrRpcHandler] No approval queue configured!");
        return {
          ok: false,
          error: RPC_ERROR_CODES.NEEDS_APPROVAL,
        };
      }

      console.log(
        "[NostrRpcHandler] Policy requires approval, opening popup..."
      );

      try {
        // Wait for user approval
        const decision = await this.requestApproval(message.origin, event);

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

          return {
            ok: false,
            error: RPC_ERROR_CODES.TIMEOUT,
            details: "Approval request timed out",
          };
        }

        if (decision !== "allow") {
          // Record user denial
          await context.activityLog.addEntry({
            origin: message.origin,
            kind: event.kind,
            decision: "deny",
            contentPreview: event.content.substring(0, 100),
          });

          return {
            ok: false,
            error: RPC_ERROR_CODES.DENIED,
            details: "user rejected",
          };
        }
        // Fall through to signing if approved
      } catch (error) {
        console.error("[NostrRpcHandler] Approval error:", error);
        return {
          ok: false,
          error: RPC_ERROR_CODES.APPROVAL_FAILED,
          details: error instanceof Error ? error.message : "approval failed",
        };
      }
    }

    // Policy allows (or user approved) - proceed with signing
    try {
      // Compute event ID using NIP-01 format
      const eventId = computeEventId(
        pubkey,
        event.created_at,
        event.kind,
        event.tags,
        event.content
      );

      // Sign the event hash with the selected key
      const signResult = await context.vault.sign(eventId, selectedKey.id);

      if (!signResult || !signResult.sigHex) {
        return {
          ok: false,
          error: RPC_ERROR_CODES.SIGNING_FAILED,
        };
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
        if (error.message === "key_locked_or_missing") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.LOCKED,
          };
        }
        if (error.message === "hash_must_be_32_bytes") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.INVALID_HASH,
            details: "Event ID must be 32 bytes",
          };
        }
      }
      // Generic signing error fallback
      return {
        ok: false,
        error: RPC_ERROR_CODES.DENIED,
        details: error instanceof Error ? error.message : "Signing failed",
      };
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
  private async requestApproval(
    origin: string,
    event: UnsignedEvent
  ): Promise<ApprovalDecision | "timeout"> {
    return new Promise<ApprovalDecision | "timeout">((resolve, reject) => {
      // Enqueue the request with a resolver callback
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
        }
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
   * Open the approval popup window
   *
   * @param requestId - The ID of the pending request
   */
  private async openApprovalPopup(requestId: string): Promise<void> {
    // Get the extension URL for the approval page
    // Use type assertion since approval.html is dynamically registered
    const approvalUrl = browser.runtime.getURL(
      `/approval.html?requestId=${encodeURIComponent(
        requestId
      )}` as `/popup.html${string}`
    );

    console.log("[NostrRpcHandler] Opening approval popup at:", approvalUrl);

    try {
      // Get current window to center the popup
      let left: number | undefined;
      let top: number | undefined;

      try {
        const currentWindow = await browser.windows.getCurrent();
        if (
          currentWindow.left !== undefined &&
          currentWindow.top !== undefined &&
          currentWindow.width !== undefined &&
          currentWindow.height !== undefined
        ) {
          // Center popup on current window
          left =
            currentWindow.left +
            Math.floor((currentWindow.width - POPUP_WIDTH) / 2);
          top =
            currentWindow.top +
            Math.floor((currentWindow.height - POPUP_HEIGHT) / 2);
        }
      } catch (err) {
        console.warn(
          "[NostrRpcHandler] Could not get current window for centering:",
          err
        );
      }

      const win = await browser.windows.create({
        url: approvalUrl,
        type: "popup",
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
        left,
        top,
        focused: true,
      });

      // Update badge with pending count
      await this.updateBadgeCount();

      console.log(
        "[NostrRpcHandler] Approval popup opened, window id:",
        win?.id
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
        // Show count on badge
        await browser.action.setBadgeText({ text: count.toString() });

        // Set badge background color to primary/accent color
        await browser.action.setBadgeBackgroundColor({ color: "#9333ea" });

        // Update title to inform user
        await browser.action.setTitle({
          title: `Ostrilo - ${count} approval${count > 1 ? "s" : ""} pending`,
        });
      } else {
        // Clear badge when no pending requests
        await browser.action.setBadgeText({ text: "" });
        await browser.action.setTitle({ title: "Ostrilo Signer" });
      }
    } catch (err) {
      console.error("[NostrRpcHandler] Failed to update badge:", err);
      throw err;
    }
  }
}

import type { RpcRequest, RpcResponse } from "../rpc";
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
const POPUP_WIDTH = 400;
const POPUP_HEIGHT = 520;

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
          error: `unsupported_method: ${(message as any).type}`,
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
        error: "vault_locked",
      };
    }

    // Get the selected key
    const keys = await context.vault.listKeys();
    const selectedKey = keys.find((k) => k.isSelected);

    if (!selectedKey) {
      return {
        ok: false,
        error: "no_key_selected",
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
        error: `invalid_event: ${eventValidation.error.issues[0]?.message}`,
      };
    }

    // Validate origin
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return {
        ok: false,
        error: `invalid_origin: ${originValidation.error.issues[0]?.message}`,
      };
    }

    // Check if vault is unlocked
    const lockState = await context.vault.getLockState();
    if (lockState.isLocked) {
      return {
        ok: false,
        error: "vault_locked",
      };
    }

    // Get the selected key
    const keys = await context.vault.listKeys();
    const selectedKey = keys.find((k) => k.isSelected);

    if (!selectedKey) {
      return {
        ok: false,
        error: "no_key_selected",
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
      return {
        ok: false,
        error: "policy_denied",
      };
    }

    if (policyResult.mode === "ask") {
      // Need approval - queue the request and open popup
      if (!this.approvalQueue) {
        // No queue configured - fall back to error
        console.log("[NostrRpcHandler] No approval queue configured!");
        return {
          ok: false,
          error: "approval_required",
        };
      }

      console.log(
        "[NostrRpcHandler] Policy requires approval, opening popup..."
      );

      try {
        // Wait for user approval
        const decision = await this.requestApproval(message.origin, event);

        console.log("[NostrRpcHandler] Approval decision:", decision);

        if (decision !== "allow") {
          return {
            ok: false,
            error: "user_denied",
          };
        }
        // Fall through to signing if approved
      } catch (error) {
        console.error("[NostrRpcHandler] Approval error:", error);
        return {
          ok: false,
          error: error instanceof Error ? error.message : "approval_failed",
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

      if (!signResult || typeof signResult !== "string") {
        return {
          ok: false,
          error: "signing_failed",
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
        sig: signResult,
      };

      return {
        ok: true,
        data: { event: signedEvent },
      };
    } catch (error) {
      return {
        ok: false,
        error: `signing_error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  /**
   * Request user approval for signing an event
   * Opens the approval popup and waits for user decision
   *
   * @param origin - The origin of the requesting dapp
   * @param event - The unsigned event to sign
   * @returns Promise resolving to the user's decision
   */
  private async requestApproval(
    origin: string,
    event: UnsignedEvent
  ): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve, reject) => {
      // Enqueue the request with a resolver callback
      const pendingRequest = this.approvalQueue!.enqueue(
        origin,
        event,
        (decision: ApprovalDecision, _action: ApprovalAction) => {
          console.log(
            "[NostrRpcHandler] Request resolved with decision:",
            decision
          );
          resolve(decision);
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
      const win = await browser.windows.create({
        url: approvalUrl,
        type: "popup",
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
        focused: true,
      });
      console.log(
        "[NostrRpcHandler] Approval popup opened, window id:",
        win?.id
      );
    } catch (err) {
      console.error("[NostrRpcHandler] Failed to open approval popup:", err);
      throw err;
    }
  }
}

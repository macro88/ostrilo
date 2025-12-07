import type { RpcRequest, RpcResponse } from "../rpc";
import type { RpcModule, ServiceContext } from "../rpc-router";
import type { SignedEvent, UnsignedEvent } from "@/domain/types";
import {
  UnsignedEventSchema,
  OriginSchema,
} from "@/infrastructure/validation/schemas";
import {
  computeEventId,
  signEventHash,
  publicKeyToHex,
} from "@/domain/utils/crypto";

/**
 * RPC handler for NIP-07 Nostr operations
 * Handles: nostr.getPublicKey, nostr.signEvent
 */
export class NostrRpcHandler implements RpcModule {
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

    if (policyResult.mode === "deny") {
      return {
        ok: false,
        error: "policy_denied",
      };
    }

    if (policyResult.mode === "ask") {
      // For now, return pending - the approval prompt feature will handle this
      return {
        ok: false,
        error: "approval_required",
      };
    }

    // Policy allows - proceed with signing
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
}

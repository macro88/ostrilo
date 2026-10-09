import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";
import {
  AvatarPubkeySchema,
  AvatarSaveParamsSchema,
} from "@/infrastructure/validation/schemas";

/**
 * RPC handler for the local copy of a key's profile picture.
 * Handles: avatar.get, avatar.save, avatar.remove
 *
 * UI-only (the `avatar` namespace is not page-reachable) and lock-gated. The
 * background never fetches a picture: the Profile page loads it once, on an
 * explicit save or refresh, and sends the shrunken result here to be stored.
 * Nothing in this handler makes a network request.
 *
 * Only a key the vault holds can have a copy, so the record cannot be filled
 * with entries for public keys that were never here and have no deletion to
 * clear them.
 */
export class AvatarRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "avatar.get":
        return this.handleGet(message, context);

      case "avatar.save":
        return this.handleSave(message, context);

      case "avatar.remove":
        return this.handleRemove(message, context);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: message.type,
          method: message.type,
        });
    }
  }

  private async handleGet(
    message: Extract<RpcRequest, { type: "avatar.get" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const pubkey = AvatarPubkeySchema.safeParse(message.pubkey);
    if (!pubkey.success) {
      return this.invalid(message.type, pubkey.error.issues[0]?.message);
    }

    return {
      ok: true,
      data: { avatar: await context.vault.profileAvatar.get(pubkey.data) },
    };
  }

  private async handleSave(
    message: Extract<RpcRequest, { type: "avatar.save" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const params = AvatarSaveParamsSchema.safeParse({
      pubkey: message.pubkey,
      sourceUrl: message.sourceUrl,
      dataUrl: message.dataUrl,
    });
    if (!params.success) {
      return this.invalid(message.type, params.error.issues[0]?.message);
    }

    const vaultPubkeys = (await context.vault.listKeys()).map(
      (record) => record.pubkey
    );
    if (!vaultPubkeys.includes(params.data.pubkey)) {
      return createRpcErrorResponse(RPC_ERROR_CODES.KEY_NOT_FOUND, {
        details: "No key in the vault has this public key",
        method: message.type,
      });
    }

    await context.vault.profileAvatar.save(
      params.data.pubkey,
      { dataUrl: params.data.dataUrl, sourceUrl: params.data.sourceUrl },
      vaultPubkeys
    );
    return { ok: true, data: null };
  }

  private async handleRemove(
    message: Extract<RpcRequest, { type: "avatar.remove" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const pubkey = AvatarPubkeySchema.safeParse(message.pubkey);
    if (!pubkey.success) {
      return this.invalid(message.type, pubkey.error.issues[0]?.message);
    }

    await context.vault.profileAvatar.remove(pubkey.data);
    return { ok: true, data: null };
  }

  private invalid(method: string, details?: string): RpcResponse {
    return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
      details,
      method,
    });
  }
}

import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";
import { KeyIdSchema } from "@/infrastructure/validation/schemas";

/**
 * RPC handler for per-key backup status.
 * Handles: backup.list, backup.markVerified
 *
 * Both are UI-only (the `backup` namespace is not page-reachable) and
 * lock-gated, so a vault that locks in the middle of a backup cannot have the
 * key marked verified afterwards.
 *
 * There is no request that sets `pending` or clears a record. `pending` is
 * written by the vault when it creates a key and the record is dropped when it
 * deletes one, so the status cannot drift from the key's existence by a UI
 * call.
 */
export class BackupRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "backup.list":
        return { ok: true, data: { statuses: await context.vault.backupStatus.list() } };

      case "backup.markVerified":
        return this.handleMarkVerified(message, context);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: message.type,
          method: message.type,
        });
    }
  }

  private async handleMarkVerified(
    message: Extract<RpcRequest, { type: "backup.markVerified" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const keyId = KeyIdSchema.safeParse(message.keyId);
    if (!keyId.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: keyId.error.issues[0]?.message,
        method: message.type,
      });
    }

    // A record for a key that is not in the vault would never be removed, since
    // removal rides on deleting the key.
    const keys = await context.vault.listKeys();
    if (!keys.some((key) => key.id === keyId.data)) {
      return createRpcErrorResponse(RPC_ERROR_CODES.KEY_NOT_FOUND, {
        details: "The specified key does not exist",
        method: message.type,
      });
    }

    await context.vault.backupStatus.markVerified(keyId.data);
    return { ok: true, data: null };
  }
}

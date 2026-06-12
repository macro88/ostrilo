import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import { KeyIdSchema } from "../../validation/schemas.js";
import type { RpcModule, ServiceContext } from "../rpc-router";

/**
 * RPC handler for state-related operations
 * Handles: state.getLock
 */
export class StateRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "state.getLock":
        return this.handleGetLock(context);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: (message as any).type,
          method: (message as any).type,
        });
    }
  }

  private async handleGetLock(context: ServiceContext): Promise<RpcResponse> {
    const data = await context.vault.getLockState();
    return { ok: true, data };
  }
}

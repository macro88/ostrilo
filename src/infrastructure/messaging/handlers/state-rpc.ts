import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";

/**
 * RPC handler for state-related operations
 * Handles: state.getLock, state.touch
 */
export class StateRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "state.getLock":
        return this.handleGetLock(context);

      case "state.touch":
        return this.handleTouch(context);

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

  /**
   * Records genuine user activity, pushing the auto-lock deadline out.
   *
   * Deliberately a no-op on a locked vault: polling lock state from a locked UI
   * must never revive the session. Background bookkeeping, broadcasts and relay
   * traffic do not call this - only real interaction does.
   */
  private async handleTouch(context: ServiceContext): Promise<RpcResponse> {
    await context.vault.touchActivity();
    const rearm = (
      globalThis as unknown as { __ostriloArmAutoLock?: () => Promise<void> }
    ).__ostriloArmAutoLock;
    if (rearm) await rearm();
    return { ok: true, data: null };
  }
}

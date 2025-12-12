import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";

/**
 * RPC handler for activity log operations
 * Handles: activity.getRecent, activity.filterBy, activity.clear
 */
export class ActivityRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "activity.getRecent":
        return this.handleGetRecent(message, context);

      case "activity.filterBy":
        return this.handleFilterBy(message, context);

      case "activity.clear":
        return this.handleClear(context);

      default:
        return {
          ok: false,
          error: RPC_ERROR_CODES.UNKNOWN_METHOD,
          details: (message as any).type,
        };
    }
  }

  private async handleGetRecent(
    message: Extract<RpcRequest, { type: "activity.getRecent" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const limit = message.limit ?? 10;
    const offset = message.offset ?? 0;

    const entries = await context.activityLog.getRecent(limit, offset);
    const total = await context.activityLog.count();

    return {
      ok: true,
      data: { entries, total },
    };
  }

  private async handleFilterBy(
    message: Extract<RpcRequest, { type: "activity.filterBy" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const filters = {
      origin: message.origin,
      kind: message.kind,
      limit: message.limit ?? 10,
      offset: message.offset ?? 0,
    };

    const entries = await context.activityLog.filterBy(filters);
    const total = await context.activityLog.count({
      origin: message.origin,
      kind: message.kind,
    });

    return {
      ok: true,
      data: { entries, total },
    };
  }

  private async handleClear(context: ServiceContext): Promise<RpcResponse> {
    await context.activityLog.clearAll();
    return { ok: true, data: null };
  }
}

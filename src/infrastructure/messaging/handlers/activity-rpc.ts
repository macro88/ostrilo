import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";
import {
  ActivityGetRecentRequestSchema,
  ActivityFilterByRequestSchema,
} from "@/infrastructure/validation/schemas";

/**
 * RPC handler for activity log operations
 * Handles: activity.getRecent, activity.filterBy, activity.clear
 */
export class ActivityRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const method = message.type;
    switch (message.type) {
      case "activity.getRecent":
        return this.handleGetRecent(message, context);

      case "activity.filterBy":
        return this.handleFilterBy(message, context);

      case "activity.clear":
        return this.handleClear(context);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: method,
          method,
        });
    }
  }

  private async handleGetRecent(
    message: Extract<RpcRequest, { type: "activity.getRecent" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const validation = ActivityGetRecentRequestSchema.safeParse({
      limit: message.limit,
      offset: message.offset,
    });

    if (!validation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: validation.error.issues[0]?.message,
        method: message.type,
      });
    }

    const limit = validation.data.limit ?? 10;
    const offset = validation.data.offset ?? 0;

    const [entries, total] = await Promise.all([
      context.activityLog.getRecent(limit, offset),
      context.activityLog.count(),
    ]);

    return {
      ok: true,
      data: { entries, total },
    };
  }

  private async handleFilterBy(
    message: Extract<RpcRequest, { type: "activity.filterBy" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const validation = ActivityFilterByRequestSchema.safeParse({
      origin: message.origin,
      kind: message.kind,
      limit: message.limit,
      offset: message.offset,
    });

    if (!validation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: validation.error.issues[0]?.message,
        method: message.type,
      });
    }

    const filters = {
      origin: validation.data.origin,
      kind: validation.data.kind,
      limit: validation.data.limit ?? 10,
      offset: validation.data.offset ?? 0,
    };

    const [entries, total] = await Promise.all([
      context.activityLog.filterBy(filters),
      context.activityLog.count({
        origin: message.origin,
        kind: message.kind,
      }),
    ]);

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

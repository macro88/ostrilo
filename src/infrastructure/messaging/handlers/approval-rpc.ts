import type { RpcRequest, RpcResponse } from "@/infrastructure/messaging/rpc";
import type {
  RpcModule,
  ServiceContext,
} from "@/infrastructure/messaging/rpc-router";
import type { ApprovalAction } from "@/domain/types";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";

/**
 * RPC handler for approval queue operations
 *
 * Handles:
 * - approval.getNext: Get the next pending approval request
 * - approval.resolve: Resolve a pending request with user's action
 * - approval.count: Get the count of pending requests
 */
export class ApprovalRpcHandler implements RpcModule {
  constructor(private queue: ApprovalQueueService) {}

  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "approval.getNext":
        return this.handleGetNext();

      case "approval.resolve":
        return this.handleResolve(message.requestId, message.action, context);

      case "approval.count":
        return this.handleCount();

      default:
        return {
          ok: false,
          error: `unsupported_method: ${(message as any).type}`,
        };
    }
  }

  /**
   * Handle approval.getNext RPC request
   * Returns the next pending request (oldest first) or null if queue is empty
   */
  private async handleGetNext(): Promise<RpcResponse> {
    try {
      const request = this.queue.getNextPending() ?? null;
      return { ok: true, data: { request } };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error ? err.message : "Failed to get next request",
      };
    }
  }

  /**
   * Handle approval.resolve RPC request
   * Resolves a pending request with the user's action
   *
   * @param requestId - The unique request ID
   * @param action - The user's action (allow, allow_once, deny, deny_remember)
   * @param context - Service context for policy updates
   */
  private async handleResolve(
    requestId: string,
    action: ApprovalAction,
    context: ServiceContext
  ): Promise<RpcResponse> {
    try {
      // Get the request before resolving (for deny_remember)
      const request = this.queue.getById(requestId);

      if (!request) {
        return { ok: false, error: "Request not found" };
      }

      // If deny_remember, update policy before resolving
      if (action === "deny_remember") {
        await context.policy.setPerKindRule(
          request.origin,
          request.event.kind,
          "deny"
        );
      }

      // Resolve the request
      const resolved = this.queue.resolve(requestId, action);

      return { ok: true, data: { resolved } };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to resolve request",
      };
    }
  }

  /**
   * Handle approval.count RPC request
   * Returns the count of pending requests in the queue
   */
  private async handleCount(): Promise<RpcResponse> {
    try {
      const count = this.queue.count();
      return { ok: true, data: { count } };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to get count",
      };
    }
  }
}

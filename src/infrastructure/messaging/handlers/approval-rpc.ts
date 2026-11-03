import type { RpcRequest, RpcResponse } from "@/infrastructure/messaging/rpc";
import {
  RPC_ERROR_CODES,
  createRpcErrorResponse,
} from "@/infrastructure/messaging/error-codes";
import type {
  RpcModule,
  ServiceContext,
} from "@/infrastructure/messaging/rpc-router";
import type { ApprovalAction } from "@/domain/types";
import {
  isDisclosureRequest,
  isSigningRequest,
} from "@/domain/types";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";
import { ApprovalResolveRequestSchema } from "@/infrastructure/validation/schemas";
import { isProtectedKind } from "@/domain/policy/trust-definitions";

interface ApprovalRpcHandlerOptions {
  closeApprovalWindow?: () => Promise<void>;
  updateBadgeCount?: () => Promise<void>;
}

/**
 * RPC handler for approval queue operations
 *
 * Handles:
 * - approval.getNext: Get the next pending approval request
 * - approval.resolve: Resolve a pending request with user's action
 * - approval.count: Get the count of pending requests
 */
export class ApprovalRpcHandler implements RpcModule {
  constructor(
    private queue: ApprovalQueueService,
    private options: ApprovalRpcHandlerOptions = {}
  ) {}

  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const method = message.type;
    switch (message.type) {
      case "approval.getNext":
        return this.handleGetNext();

      case "approval.getAll":
        return this.handleGetAll();

      case "approval.resolve":
        return this.handleResolve(message.requestId, message.action, context);

      case "approval.count":
        return this.handleCount();

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: method,
          method,
        });
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
      return createRpcErrorResponse(RPC_ERROR_CODES.APPROVAL_FAILED, {
        details:
          err instanceof Error ? err.message : "Failed to get next request",
        method: "approval.getNext",
      });
    }
  }

  /**
   * Handle approval.getAll RPC request
   * Returns all pending requests in the queue (FIFO order)
   */
  private async handleGetAll(): Promise<RpcResponse> {
    try {
      const requests = this.queue.getAllPending();
      return { ok: true, data: { requests } };
    } catch (err) {
      return createRpcErrorResponse(RPC_ERROR_CODES.APPROVAL_FAILED, {
        details:
          err instanceof Error ? err.message : "Failed to get all requests",
        method: "approval.getAll",
      });
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
    // Validate input
    const validation = ApprovalResolveRequestSchema.safeParse({
      requestId,
      action,
    });

    if (!validation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: validation.error.issues[0]?.message,
        method: "approval.resolve",
      });
    }

    try {
      // Get the request before resolving (for deny_remember)
      const request = this.queue.getById(validation.data.requestId);

      if (!request) {
        return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
          details: "Request not found",
          method: "approval.resolve",
        });
      }

      // BRANCH ON THE DISCRIMINATOR FIRST.
      //
      // This block used to dereference `request.event.kind` unconditionally.
      // For a request with no event that throws inside the surrounding `try`,
      // returns APPROVAL_FAILED, and leaves the entry queued until the
      // 60-second auto-deny - so the user's click appears to do nothing. Worse,
      // it did so only for `allow` and `deny_remember`: `allow_once` and plain
      // `deny` short-circuit past both reads and resolve normally, so the SAME
      // request succeeded or hung depending on which button was pressed.
      //
      // An optional chain would not fix it. `isProtectedKind` fails open on a
      // non-integer (`trust-definitions.ts:81-86`), so an undefined kind takes
      // the allow branch and writes a `rules[undefined]` key through
      // `policy.service.ts:140`.
      if (isDisclosureRequest(request)) {
        // A remembered refusal is per ORIGIN, not per kind: there is no kind.
        // A remembered allow is per KEY - the one the prompt named, captured
        // when it was queued, not whichever key is selected now. No per-kind
        // rule is written here, ever.
        if (validation.data.action === "allow" && request.signingKeyId) {
          await context.policy.grantIdentityDisclosure(
            request.origin,
            request.signingKeyId
          );
        }
        if (validation.data.action === "deny_remember") {
          await context.policy.setIdentityDisclosure(request.origin, "deny");
        }
      } else if (isSigningRequest(request)) {
        // Persist remembered decisions before resolving so the request only
        // succeeds when the requested durable policy update succeeds.
        if (
          validation.data.action === "allow" &&
          !isProtectedKind(request.event.kind)
        ) {
          await context.policy.setPerKindRule(
            request.origin,
            request.event.kind,
            "allow"
          );
        }

        if (validation.data.action === "deny_remember") {
          await context.policy.setPerKindRule(
            request.origin,
            request.event.kind,
            "deny"
          );
        }

        // A signature hands the public key to the origin inside the signed
        // event, so approving one IS disclosure. Recording it here keeps
        // Settings from displaying a decision the product does not enforce,
        // and stops the user being asked twice for something they have
        // already granted in the stronger direction.
        //
        // It discloses the key that signed, so that is the key recorded. A
        // request that does not name one records nothing: the grant is never
        // guessed from the current selection.
        if (
          (validation.data.action === "allow" ||
            validation.data.action === "allow_once") &&
          request.signingKeyId
        ) {
          await context.policy.grantIdentityDisclosure(
            request.origin,
            request.signingKeyId
          );
        }
      }

      // Resolve the request
      const resolved = this.queue.resolve(
        validation.data.requestId,
        validation.data.action
      );

      // Update badge count after resolving
      await this.updateBadgeCount();

      if (this.queue.count() === 0) {
        await this.options.closeApprovalWindow?.();
      }

      return { ok: true, data: { resolved } };
    } catch (err) {
      return createRpcErrorResponse(RPC_ERROR_CODES.APPROVAL_FAILED, {
        details:
          err instanceof Error ? err.message : "Failed to resolve request",
        method: "approval.resolve",
      });
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
      return createRpcErrorResponse(RPC_ERROR_CODES.APPROVAL_FAILED, {
        details: err instanceof Error ? err.message : "Failed to get count",
        method: "approval.count",
      });
    }
  }

  /**
   * Update badge to show count of pending approval requests
   */
  private async updateBadgeCount(): Promise<void> {
    try {
      await this.options.updateBadgeCount?.();
    } catch (err) {
      console.error("[ApprovalRpcHandler] Failed to update badge:", err);
    }
  }
}

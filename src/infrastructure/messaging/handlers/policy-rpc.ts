import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";
import {
  validateOriginPolicyPatch,
  OriginSchema,
  EventKindSchema,
  AuthorisationSchema,
} from "@/infrastructure/validation/schemas";

/**
 * RPC handler for policy-related operations
 * Handles: policy.evaluate, policy.setOrigin, policy.setKindRule, policy.clearSession, policy.setSession, policy.removeOrigin
 */
export class PolicyRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "policy.evaluate":
        return this.handleEvaluate(message, context);

      case "policy.setOrigin":
        return this.handleSetOrigin(message, context);

      case "policy.setKindRule":
        return this.handleSetKindRule(message, context);

      case "policy.clearSession":
        return this.handleClearSession(message, context);

      case "policy.setSession":
        return this.handleSetSession(message, context);

      case "policy.removeOrigin":
        return this.handleRemoveOrigin(message, context);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: (message as any).type,
          method: (message as any).type,
        });
    }
  }

  private async handleEvaluate(
    message: Extract<RpcRequest, { type: "policy.evaluate" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate origin
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
        details: originValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Validate event kind
    const kindValidation = EventKindSchema.safeParse(message.kind);
    if (!kindValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: kindValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    const data = await context.policy.evaluate({
      origin: message.origin,
      kind: message.kind,
    });
    return { ok: true, data };
  }

  private async handleSetOrigin(
    message: Extract<RpcRequest, { type: "policy.setOrigin" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate origin
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
        details: originValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Validate patch data
    const validationResult = validateOriginPolicyPatch(message.patch);
    if (!validationResult.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: validationResult.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(", "),
        method: message.type,
      });
    }

    await context.policy.setOriginPolicy(message.origin, validationResult.data);
    return { ok: true, data: null };
  }

  private async handleSetKindRule(
    message: Extract<RpcRequest, { type: "policy.setKindRule" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate origin
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
        details: originValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Validate event kind
    const kindValidation = EventKindSchema.safeParse(message.kind);
    if (!kindValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: kindValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Validate mode (should be valid authorisation)
    const modeValidation = AuthorisationSchema.safeParse(message.mode);
    if (!modeValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: modeValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    await context.policy.setPerKindRule(
      message.origin,
      message.kind,
      message.mode as any
    );
    return { ok: true, data: null };
  }

  private async handleClearSession(
    message: Extract<RpcRequest, { type: "policy.clearSession" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate origin
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
        details: originValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    await context.policy.clearSessionGrant(message.origin);
    return { ok: true, data: null };
  }

  private async handleSetSession(
    message: Extract<RpcRequest, { type: "policy.setSession" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate origin
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
        details: originValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    await context.policy.setSessionGrant(message.origin, message.enabled);
    return { ok: true, data: null };
  }

  private async handleRemoveOrigin(
    message: Extract<RpcRequest, { type: "policy.removeOrigin" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate origin
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
        details: originValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    await context.policy.removeOriginPolicy(message.origin);
    return { ok: true, data: null };
  }
}

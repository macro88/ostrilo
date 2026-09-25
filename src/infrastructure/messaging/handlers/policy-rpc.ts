import type { RpcRequest, RpcResponse } from "../rpc";
import { requireReauth } from "@/infrastructure/messaging/reauth";
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
    const method = message.type;
    switch (message.type) {
      case "policy.evaluate":
        return this.handleEvaluate(message, context);

      case "policy.setOrigin":
        return this.handleSetOrigin(message, context);

      case "policy.setKindRule":
        return this.handleSetKindRule(message, context);

      case "policy.getSessionGrants":
        return { ok: true, data: await context.policy.getSessionGrants() };

      case "policy.clearSession":
        return this.handleClearSession(message, context);

      case "policy.setSession":
        return this.handleSetSession(message, context);

      case "policy.removeOrigin":
        return this.handleRemoveOrigin(message, context);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: method,
          method,
        });
    }
  }

  private async handleEvaluate(
    message: Extract<RpcRequest, { type: "policy.evaluate" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
        details: originValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

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
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
        details: originValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    const validationResult = validateOriginPolicyPatch(message.patch);
    if (!validationResult.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: validationResult.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(", "),
        method: message.type,
      });
    }

    // `high` trust signs without prompting from then on. Granting it is a
    // one-way decision the user will not be reminded of, so it costs a
    // password. Lowering trust, renaming, and clearing do not.
    if (validationResult.data.trustLevel === "high") {
      const reauth = await requireReauth(
        message.password,
        message.type,
        context
      );
      if (reauth) return reauth;
    }

    await context.policy.setOriginPolicy(message.origin, validationResult.data);
    return { ok: true, data: null };
  }

  private async handleSetKindRule(
    message: Extract<RpcRequest, { type: "policy.setKindRule" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
        details: originValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

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

    // `allow` is a standing, silent permission for that kind. `deny` and
    // `ask` only ever add friction, so they stay free.
    if (message.mode === "allow") {
      const reauth = await requireReauth(
        message.password,
        message.type,
        context
      );
      if (reauth) return reauth;
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
    const originValidation = OriginSchema.safeParse(message.origin);
    if (!originValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
        details: originValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Enabling a session grant allows every unprotected kind for that
    // origin with no further prompting. Turning one OFF is free.
    if (message.enabled) {
      const reauth = await requireReauth(
        message.password,
        message.type,
        context
      );
      if (reauth) return reauth;
    }

    await context.policy.setSessionGrant(message.origin, message.enabled);
    return { ok: true, data: null };
  }

  private async handleRemoveOrigin(
    message: Extract<RpcRequest, { type: "policy.removeOrigin" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
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

import type { RpcRequest, RpcResponse } from "../rpc";
import {
  patchNeedsReauth,
  requireReauth,
} from "@/infrastructure/messaging/reauth";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";
import { validateAppSettingsPatch } from "@/infrastructure/validation/schemas";
import { getEffectiveMediumAllowKinds } from "@/domain/policy/trust-definitions";

/**
 * RPC handler for settings-related operations
 * Handles: settings.get, settings.update
 */
export class SettingsRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "settings.get":
        return this.handleGet(context);

      case "settings.update":
        return this.handleUpdate(message, context);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: (message as any).type,
          method: (message as any).type,
        });
    }
  }

  private async handleGet(context: ServiceContext): Promise<RpcResponse> {
    const data = await context.settings.get();
    return { ok: true, data };
  }

  private async handleUpdate(
    message: Extract<RpcRequest, { type: "settings.update" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Runtime validation of patch data
    const validationResult = validateAppSettingsPatch(message.patch);
    if (!validationResult.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: validationResult.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(", "),
        method: message.type,
      });
    }

    // Lengthening the auto-lock timeout, or the session-grant TTL, buys
    // the next person at the keyboard time. Both are therefore
    // password-gated, in either direction: a value is a value, and
    // reasoning about "only when it gets weaker" is how gates get bypassed.
    if (patchNeedsReauth(validationResult.data)) {
      const reauth = await requireReauth(
        message.password,
        message.type,
        context
      );
      if (reauth) return reauth;
    }

    const patch = { ...validationResult.data };
    if (Array.isArray(patch.mediumAllowKinds)) {
      patch.mediumAllowKinds = getEffectiveMediumAllowKinds(
        patch.mediumAllowKinds
      );
    }

    const data = await context.settings.update(patch);

    if (patch.maxActivityEntries !== undefined) {
      try {
        await context.activityLog.setMaxEntries(
          patch.maxActivityEntries
        );
      } catch (error) {
        console.warn("Failed to update activity log max entries", error);
      }
    }
    return { ok: true, data };
  }
}

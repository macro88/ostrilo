import type { RpcRequest, RpcResponse } from "../rpc";
import type { RpcModule, ServiceContext } from "../rpc-router";
import { validateAppSettingsPatch } from "@/infrastructure/validation/schemas";

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
        return {
          ok: false,
          error: `unsupported_method: ${(message as any).type}`,
        };
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
      return {
        ok: false,
        error: `invalid_patch: ${validationResult.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(", ")}`,
      };
    }

    const data = await context.settings.update(validationResult.data);
    return { ok: true, data };
  }
}

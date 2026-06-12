import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";
import { ProfileMetadataSchema } from "@/domain/profile/types";

/**
 * RPC handler for profile-related operations
 * Handles: profile.get, profile.getAll, profile.update, profile.clearCache
 */
export class ProfileRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "profile.get":
        return this.handleGet(message, context);

      case "profile.getAll":
        return this.handleGetAll(context);

      case "profile.update":
        return this.handleUpdate(message, context);

      case "profile.clearCache":
        return this.handleClearCache(message, context);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: (message as any).type,
          method: (message as any).type,
        });
    }
  }

  private async handleGet(
    message: Extract<RpcRequest, { type: "profile.get" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    try {
      const { pubkey, forceFetch } = (message as any).params || {};

      if (!pubkey || typeof pubkey !== "string") {
        return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
          details: "pubkey parameter is required and must be a string",
          method: message.type,
        });
      }

      const data = await context.profile.getProfile(pubkey, forceFetch);
      return { ok: true, data };
    } catch (error) {
      return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
        details: error instanceof Error ? error.message : "Unknown error",
        method: message.type,
      });
    }
  }

  private async handleGetAll(context: ServiceContext): Promise<RpcResponse> {
    try {
      const profilesMap = await context.profile.getAllProfiles();

      // Convert Map to plain object for JSON serialization
      const data = Object.fromEntries(profilesMap);

      return { ok: true, data };
    } catch (error) {
      return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
        details: error instanceof Error ? error.message : "Unknown error",
        method: "profile.getAll",
      });
    }
  }

  private async handleUpdate(
    message: Extract<RpcRequest, { type: "profile.update" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    try {
      const { metadata } = (message as any).params || {};

      if (!metadata || typeof metadata !== "object") {
        return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
          details: "metadata parameter is required and must be an object",
          method: message.type,
        });
      }

      // Validate metadata with Zod
      const validationResult = ProfileMetadataSchema.safeParse(metadata);
      if (!validationResult.success) {
        return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
          details: `Invalid metadata: ${validationResult.error.issues
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join(", ")}`,
          method: message.type,
        });
      }

      // Update profile (signs and publishes to relays)
      await context.profile.updateProfile(validationResult.data);

      // Get selected key for activity log
      const settings = await context.settings.get();
      const selectedKeyId = settings?.selectedKeyId;

      // Log the profile update activity
      await context.activityLog.addEntry({
        origin: "extension://profile", // Internal origin for extension UI actions
        kind: 0, // NIP-01 kind:0 for profile metadata
        decision: "allow",
        contentPreview: JSON.stringify(validationResult.data).substring(0, 100),
        keyId: selectedKeyId,
      });

      return { ok: true, data: null };
    } catch (error) {
      return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
        details: error instanceof Error ? error.message : "Unknown error",
        method: message.type,
      });
    }
  }

  private async handleClearCache(
    message: Extract<RpcRequest, { type: "profile.clearCache" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    try {
      const { pubkey } = (message as any).params || {};

      await context.profile.clearCache(pubkey);
      return { ok: true, data: null };
    } catch (error) {
      return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
        details: error instanceof Error ? error.message : "Unknown error",
        method: message.type,
      });
    }
  }
}

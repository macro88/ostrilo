import type { RpcRequest, RpcResponse } from "./rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "./error-codes";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import type { PolicyService } from "@/application/services/policy.service";
import type { SettingsService } from "@/application/services/settings.service";
import type { ActivityLogService } from "@/application/services/activity-log.service";
import type { ProfileService } from "@/application/services/profile.service";

/**
 * Service context passed to RPC handlers containing all application services
 */
export interface ServiceContext {
  vault: KeyVaultService;
  policy: PolicyService;
  settings: SettingsService;
  activityLog: ActivityLogService;
  profile: ProfileService;
}

/**
 * Base interface that all RPC modules must implement
 */
export interface RpcModule {
  /**
   * Handle an RPC request for this module
   * @param message - The RPC request message
   * @param context - Service context with all application services
   * @returns Promise resolving to RPC response
   */
  handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse>;
}

/**
 * RPC router that delegates requests to appropriate modules based on namespace
 */
export class RpcRouter {
  private modules: Record<string, RpcModule> = {};

  /**
   * Register an RPC module for a specific namespace
   * @param namespace - The namespace prefix (e.g., "vault", "policy")
   * @param module - The RPC module to handle requests for this namespace
   */
  registerModule(namespace: string, module: RpcModule): void {
    this.modules[namespace] = module;
  }

  /**
   * Handle an incoming RPC request by routing to the appropriate module
   * @param message - The RPC request message
   * @param context - Service context with all application services
   * @returns Promise resolving to RPC response
   */
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    try {
      // Extract namespace from message type (e.g., "vault.unlock" -> "vault")
      const [namespace] = message.type.split(".");

      if (!namespace) {
        return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_REQUEST);
      }

      const module = this.modules[namespace];
      if (!module) {
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_NAMESPACE, {
          details: namespace,
          method: message.type,
        });
      }

      return await module.handleRequest(message, context);
    } catch (error: any) {
      console.error("[RPC Router] Error handling request:", error);
      return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
        details: error?.message ?? String(error),
        method: message.type,
      });
    }
  }

  /**
   * Get list of registered namespaces
   */
  getRegisteredNamespaces(): string[] {
    return Object.keys(this.modules);
  }
}

/**
 * Create a browser runtime message listener that uses the RPC router
 * @param router - The RPC router instance
 * @param context - Service context with all application services
 * @returns Message listener function compatible with browser.runtime.onMessage
 */
export function createRpcMessageListener(
  router: RpcRouter,
  context: ServiceContext
) {
  return (
    message: any,
    sender: any,
    sendResponse: (response: RpcResponse) => void
  ) => {
    console.log("[RPC] Received message:", message?.type || "unknown");

    // Validate message format
    if (!message || typeof message !== "object" || !("type" in message)) {
      console.log("[RPC] Invalid request format");
      sendResponse(createRpcErrorResponse(RPC_ERROR_CODES.INVALID_REQUEST));
      return false;
    }

    // Handle request asynchronously
    (async () => {
      try {
        const result = await router.handleRequest(
          message as RpcRequest,
          context
        );
        const status = result.ok
          ? "success"
          : result.error.data.errorCode;
        console.log(
          "[RPC] Sending response for",
          message.type,
          ":",
          status
        );
        sendResponse(result);
      } catch (error: any) {
        const errorResult: RpcResponse = createRpcErrorResponse(
          RPC_ERROR_CODES.UNKNOWN_METHOD,
          {
            details: error?.message ?? String(error),
            method: message.type,
          }
        );
        console.log(
          "[RPC] Error handling",
          message.type,
          ":",
          errorResult.error.data.errorCode
        );
        sendResponse(errorResult);
      }
    })();

    return true; // Keep message port open for async response
  };
}

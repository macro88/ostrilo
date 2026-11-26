import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";
import { isVaultLockedError } from "./nostr-rpc";
import {
  BlossomAuthService,
  UploadAuthKeyNotFoundError,
} from "@/application/services/blossom-auth.service";
import { BlossomAuthorizeUploadParamsSchema } from "@/infrastructure/validation/blossom-schemas";

/**
 * RPC handler for upload authorisation.
 * Handles: blossom.authorizeUpload
 *
 * UI-only (the `blossom` namespace is not page-reachable) and lock-gated by the
 * router. It builds and signs one kind of event, for one purpose, and returns
 * only the header value: the caller cannot choose a kind, a tag or the content.
 * Nothing here makes a network request. The page sends the upload itself.
 */
export class BlossomRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "blossom.authorizeUpload":
        return this.handleAuthorizeUpload(message, context);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: message.type,
          method: message.type,
        });
    }
  }

  private async handleAuthorizeUpload(
    message: Extract<RpcRequest, { type: "blossom.authorizeUpload" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    const { type, ...fields } = message;
    const params = BlossomAuthorizeUploadParamsSchema.safeParse(fields);
    if (!params.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: params.error.issues[0]?.message,
        method: type,
      });
    }

    try {
      const authorization = await new BlossomAuthService(
        context.vault,
        context.activityLog
      ).authorizeUpload(params.data);
      return { ok: true, data: { authorization } };
    } catch (error) {
      if (error instanceof UploadAuthKeyNotFoundError) {
        return createRpcErrorResponse(RPC_ERROR_CODES.KEY_NOT_FOUND, {
          details: error.message,
          method: type,
        });
      }
      if (error instanceof Error && error.message === "key_unreadable") {
        return createRpcErrorResponse(RPC_ERROR_CODES.VAULT_UNREADABLE, {
          details: "This key could not be read. Choose another key in Ostrilo.",
          method: type,
        });
      }
      const code =
        error instanceof Error && isVaultLockedError(error.message)
          ? RPC_ERROR_CODES.LOCKED
          : RPC_ERROR_CODES.SIGNING_FAILED;
      return createRpcErrorResponse(code, {
        details: "The upload could not be authorised",
        method: type,
      });
    }
  }
}

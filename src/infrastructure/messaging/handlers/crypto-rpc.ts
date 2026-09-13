import { RpcRequest, RpcResponse, RpcHandler } from "../rpc.js";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import { PasswordSchema, KeyInputSchema } from "../../validation/schemas.js";
import type { RpcModule, ServiceContext } from "../rpc-router";

/**
 * RPC handler for crypto utility operations
 * Handles: crypto.evaluatePassword, crypto.parsePrivateKey
 */
export class CryptoRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "crypto.evaluatePassword":
        return this.handleEvaluatePassword(message);

      case "crypto.parsePrivateKey":
        return this.handleParsePrivateKey(message);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: (message as any).type,
          method: (message as any).type,
        });
    }
  }

  private async handleEvaluatePassword(
    message: Extract<RpcRequest, { type: "crypto.evaluatePassword" }>
  ): Promise<RpcResponse> {
    const passwordValidation = PasswordSchema.safeParse(message.password);
    if (!passwordValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
        details: passwordValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Runs in the BACKGROUND, so the blocklist is available here and the
    // verdict the UI receives is authoritative rather than structural-only.
    // A verdict built without the blocklist can never be `acceptable`, which
    // is what stops a UI green-lighting a password it did not fully check.
    const [{ checkPassword }, { COMMON_PASSWORDS }] = await Promise.all([
      import("@/domain/utils/password-policy"),
      import("@/domain/utils/wordlists/common-passwords"),
    ]);
    const strength = checkPassword(passwordValidation.data, {
      blocklist: COMMON_PASSWORDS,
      extraTerms: message.label ? [message.label] : [],
    });
    return { ok: true, data: strength };
  }

  private async handleParsePrivateKey(
    message: Extract<RpcRequest, { type: "crypto.parsePrivateKey" }>
  ): Promise<RpcResponse> {
    // Validate key input
    const keyInputValidation = KeyInputSchema.safeParse(message.keyInput);
    if (!keyInputValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_KEY_INPUT, {
        details: keyInputValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Return a VERDICT, never the key bytes.
    //
    // This used to return `Array.from(privateKey)` - the raw 32-byte secret
    // scalar - back across the message bus into whichever page called it,
    // where it landed in a plain JS array that nothing zeroizes and that the
    // RPC client then logged. The caller only ever needed to know whether the
    // input was a well-formed private key.
    const { parsePrivateKey } = await import("@/domain/utils/crypto");
    let sk: Uint8Array | null = null;
    try {
      sk = parsePrivateKey(message.keyInput);
      return { ok: true, data: { valid: true as const } };
    } catch (error) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_KEY_INPUT, {
        details:
          error instanceof Error ? error.message : "Invalid private key",
        method: message.type,
      });
    } finally {
      if (sk) sk.fill(0);
    }
  }
}

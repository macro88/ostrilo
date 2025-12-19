import { RpcRequest, RpcResponse, RpcHandler } from "../rpc.js";
import { RPC_ERROR_CODES } from "../error-codes";
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
        return {
          ok: false,
          error: RPC_ERROR_CODES.UNKNOWN_METHOD,
          details: (message as any).type,
        };
    }
  }

  private async handleEvaluatePassword(
    message: Extract<RpcRequest, { type: "crypto.evaluatePassword" }>
  ): Promise<RpcResponse> {
    // Import the function from domain validation utilities
    const { evaluatePasswordStrength } = await import(
      "@/domain/utils/validation"
    );
    const strength = evaluatePasswordStrength(message.password);
    return { ok: true, data: strength };
  }

  private async handleParsePrivateKey(
    message: Extract<RpcRequest, { type: "crypto.parsePrivateKey" }>
  ): Promise<RpcResponse> {
    // Validate key input
    const keyInputValidation = KeyInputSchema.safeParse(message.keyInput);
    if (!keyInputValidation.success) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.INVALID_KEY_INPUT,
        details: keyInputValidation.error.issues[0]?.message,
      };
    }

    // Import the function dynamically to keep it in background only
    const { parsePrivateKey } = await import("@/domain/utils/crypto");
    const privateKey = parsePrivateKey(message.keyInput);
    // Convert Uint8Array to Array for JSON serialization
    return { ok: true, data: Array.from(privateKey) };
  }
}

import { RpcRequest, RpcResponse, RpcHandler } from "../rpc.js";
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
          error: `unsupported_method: ${(message as any).type}`,
        };
    }
  }

  private async handleEvaluatePassword(
    message: Extract<RpcRequest, { type: "crypto.evaluatePassword" }>
  ): Promise<RpcResponse> {
    // Validate password
    const passwordValidation = PasswordSchema.safeParse(message.password);
    if (!passwordValidation.success) {
      return {
        ok: false,
        error: `invalid_password: ${passwordValidation.error.issues[0]?.message}`,
      };
    }

    // Import the function dynamically to keep it in background only
    const { evaluatePasswordStrength } = await import("@/domain/utils/crypto");
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
        error: `invalid_key_input: ${keyInputValidation.error.issues[0]?.message}`,
      };
    }

    // Import the function dynamically to keep it in background only
    const { parsePrivateKey } = await import("@/domain/utils/crypto");
    const privateKey = parsePrivateKey(message.keyInput);
    // Convert Uint8Array to Array for JSON serialization
    return { ok: true, data: Array.from(privateKey) };
  }
}

import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";
import {
  PasswordSchema,
  KeyInputSchema,
  LabelSchema,
  KeyIdSchema,
  HashHexSchema,
} from "@/infrastructure/validation/schemas";

/**
 * RPC handler for vault-related operations
 * Handles: vault.unlock, vault.lock, vault.generate, vault.import, vault.select, vault.sign, vault.export, vault.reveal, keys.list
 */
export class VaultRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    switch (message.type) {
      case "vault.unlock":
        return this.handleUnlock(message, context);

      case "vault.lock":
        return this.handleLock(context);

      case "vault.generate":
        return this.handleGenerate(message, context);

      case "vault.import":
        return this.handleImport(message, context);

      case "vault.select":
        return this.handleSelect(message, context);

      case "vault.sign":
        return this.handleSign(message, context);

      case "vault.export":
        return this.handleExport(message, context);

      case "vault.reveal":
        return this.handleReveal(message, context);

      case "keys.list":
        return this.handleListKeys(context);

      case "vault.renameKey":
        return this.handleRenameKey(message, context);

      case "vault.deleteKey":
        return this.handleDeleteKey(message, context);

      default:
        return {
          ok: false,
          error: RPC_ERROR_CODES.UNKNOWN_METHOD,
          details: (message as any).type,
        };
    }
  }

  private async handleUnlock(
    message: Extract<RpcRequest, { type: "vault.unlock" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate password
    const passwordValidation = PasswordSchema.safeParse(message.password);
    if (!passwordValidation.success) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.INVALID_PASSWORD,
        details: passwordValidation.error.issues[0]?.message,
      };
    }

    const data = await context.vault.unlock(message.password);
    return { ok: true, data };
  }

  private async handleLock(context: ServiceContext): Promise<RpcResponse> {
    await context.vault.lock();
    return { ok: true, data: null };
  }

  private async handleGenerate(
    message: Extract<RpcRequest, { type: "vault.generate" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate password (required)
    const passwordValidation = PasswordSchema.safeParse(message.password);
    if (!passwordValidation.success) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.INVALID_PASSWORD,
        details: passwordValidation.error.issues[0]?.message,
      };
    }

    // Validate label if provided
    if (message.label !== undefined) {
      const labelValidation = LabelSchema.safeParse(message.label);
      if (!labelValidation.success) {
        return {
          ok: false,
          error: RPC_ERROR_CODES.INVALID_REQUEST,
          details: labelValidation.error.issues[0]?.message,
        };
      }
    }

    try {
      const data = await context.vault.generateKey(
        message.password,
        message.label
      );
      return { ok: true, data };
    } catch (error) {
      // Translate service errors to RPC codes
      if (error instanceof Error) {
        if (error.message === "password_required") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.INVALID_PASSWORD,
            details: "Password is required",
          };
        }
        if (error.message === "incorrect_password") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.INVALID_PASSWORD,
            details:
              "Incorrect password. Please use the same password as your existing keys.",
          };
        }
      }
      throw error; // Re-throw unexpected errors
    }
  }

  private async handleImport(
    message: Extract<RpcRequest, { type: "vault.import" }>,
    context: ServiceContext
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

    // Validate password (required)
    const passwordValidation = PasswordSchema.safeParse(message.password);
    if (!passwordValidation.success) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.INVALID_PASSWORD,
        details: passwordValidation.error.issues[0]?.message,
      };
    }

    // Validate label if provided
    if (message.label !== undefined) {
      const labelValidation = LabelSchema.safeParse(message.label);
      if (!labelValidation.success) {
        return {
          ok: false,
          error: RPC_ERROR_CODES.INVALID_REQUEST,
          details: labelValidation.error.issues[0]?.message,
        };
      }
    }

    try {
      const data = await context.vault.importKey(
        message.keyInput,
        message.password,
        message.label
      );
      return { ok: true, data };
    } catch (error) {
      // Translate service errors to RPC codes
      if (error instanceof Error) {
        if (error.message === "key_already_exists") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.KEY_ALREADY_EXISTS,
            details: "A key with this public key already exists",
          };
        }
        if (error.message === "incorrect_password") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.INVALID_PASSWORD,
            details:
              "Incorrect password. Please use the same password as your existing keys.",
          };
        }
        if (error.message === "vault_locked") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.LOCKED,
            details: "Vault is locked. Please unlock first.",
          };
        }
      }
      throw error; // Re-throw unexpected errors
    }
  }

  private async handleSelect(
    message: Extract<RpcRequest, { type: "vault.select" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate key ID
    const keyIdValidation = KeyIdSchema.safeParse(message.id);
    if (!keyIdValidation.success) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.INVALID_REQUEST,
        details: keyIdValidation.error.issues[0]?.message,
      };
    }

    await context.vault.selectKey(message.id);
    return { ok: true, data: null };
  }

  private async handleSign(
    message: Extract<RpcRequest, { type: "vault.sign" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate hash hex
    const hashValidation = HashHexSchema.safeParse(message.hashHex);
    if (!hashValidation.success) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.INVALID_HASH,
        details: hashValidation.error.issues[0]?.message,
      };
    }

    // Validate key ID if provided
    if (message.keyId !== undefined) {
      const keyIdValidation = KeyIdSchema.safeParse(message.keyId);
      if (!keyIdValidation.success) {
        return {
          ok: false,
          error: RPC_ERROR_CODES.INVALID_REQUEST,
          details: keyIdValidation.error.issues[0]?.message,
        };
      }
    }

    const data = await context.vault.sign(message.hashHex, message.keyId);
    return { ok: true, data };
  }

  private async handleExport(
    message: Extract<RpcRequest, { type: "vault.export" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate key ID if provided
    if (message.keyId !== undefined) {
      const keyIdValidation = KeyIdSchema.safeParse(message.keyId);
      if (!keyIdValidation.success) {
        return {
          ok: false,
          error: RPC_ERROR_CODES.INVALID_REQUEST,
          details: keyIdValidation.error.issues[0]?.message,
        };
      }
    }

    const data = await context.vault.exportKey(message.keyId);
    return { ok: true, data };
  }

  private async handleReveal(
    message: Extract<RpcRequest, { type: "vault.reveal" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate password (required)
    const passwordValidation = PasswordSchema.safeParse(message.password);
    if (!passwordValidation.success) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.INVALID_PASSWORD,
        details: passwordValidation.error.issues[0]?.message,
      };
    }

    // Validate key ID if provided
    if (message.keyId !== undefined) {
      const keyIdValidation = KeyIdSchema.safeParse(message.keyId);
      if (!keyIdValidation.success) {
        return {
          ok: false,
          error: RPC_ERROR_CODES.INVALID_REQUEST,
          details: keyIdValidation.error.issues[0]?.message,
        };
      }
    }

    try {
      const data = await context.vault.revealKey(
        message.password,
        message.keyId
      );
      return { ok: true, data };
    } catch (error) {
      // Translate service errors to RPC codes
      if (error instanceof Error) {
        if (error.message === "password_required") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.INVALID_PASSWORD,
            details: "Password is required",
          };
        }
        if (error.message === "incorrect_password") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.INVALID_PASSWORD,
            details: "Incorrect password",
          };
        }
        if (error.message === "key_not_found") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.KEY_NOT_FOUND,
            details: "Key not found",
          };
        }
        if (error.message === "vault_locked") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.LOCKED,
            details: "Vault is locked",
          };
        }
      }
      throw error; // Re-throw unexpected errors
    }
  }

  private async handleListKeys(context: ServiceContext): Promise<RpcResponse> {
    const data = await context.vault.listKeys();
    return { ok: true, data };
  }

  private async handleRenameKey(
    message: Extract<RpcRequest, { type: "vault.renameKey" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate key ID
    const keyIdValidation = KeyIdSchema.safeParse(message.id);
    if (!keyIdValidation.success) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.INVALID_REQUEST,
        details: keyIdValidation.error.issues[0]?.message,
      };
    }

    // Validate label
    const labelValidation = LabelSchema.safeParse(message.label);
    if (!labelValidation.success) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.INVALID_REQUEST,
        details: labelValidation.error.issues[0]?.message,
      };
    }

    try {
      await context.vault.renameKey(message.id, message.label);
      return { ok: true, data: null };
    } catch (error) {
      if (error instanceof Error && error.message === "key_not_found") {
        return {
          ok: false,
          error: RPC_ERROR_CODES.KEY_NOT_FOUND,
          details: "The specified key does not exist",
        };
      }
      throw error;
    }
  }

  private async handleDeleteKey(
    message: Extract<RpcRequest, { type: "vault.deleteKey" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate key ID
    const keyIdValidation = KeyIdSchema.safeParse(message.id);
    if (!keyIdValidation.success) {
      return {
        ok: false,
        error: RPC_ERROR_CODES.INVALID_REQUEST,
        details: keyIdValidation.error.issues[0]?.message,
      };
    }

    try {
      const data = await context.vault.deleteKey(message.id);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "key_not_found") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.KEY_NOT_FOUND,
            details: "The specified key does not exist",
          };
        }
        if (error.message === "cannot_delete_last_key") {
          return {
            ok: false,
            error: RPC_ERROR_CODES.INVALID_REQUEST,
            details: "Cannot delete the last remaining key",
          };
        }
      }
      throw error;
    }
  }
}

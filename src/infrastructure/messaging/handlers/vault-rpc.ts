import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";
import {
  PasswordSchema,
  KeyInputSchema,
  LabelSchema,
  KeyIdSchema,
} from "@/infrastructure/validation/schemas";

/**
 * RPC handler for vault-related operations
 * Handles: vault.unlock, vault.lock, vault.generate, vault.import, vault.select, vault.reveal, keys.list
 *
 * Deliberately NOT handled:
 * - vault.export: returned the raw nsec with no password, no consent and no
 *   activity-log entry, and had no caller. vault.reveal is the supported
 *   path; it re-verifies the password before releasing any key material.
 * - vault.sign: signed any 32-byte value with no origin, no policy check and
 *   no approval - a blind signing oracle - and had no caller. Signing goes
 *   through nostr.signEvent, which forces the pubkey, recomputes the event id
 *   and evaluates policy first.
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

      case "vault.reveal":
        return this.handleReveal(message, context);

      case "keys.list":
        return this.handleListKeys(context);

      case "vault.renameKey":
        return this.handleRenameKey(message, context);

      case "vault.deleteKey":
        return this.handleDeleteKey(message, context);

      default:
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: (message as any).type,
          method: (message as any).type,
        });
    }
  }


  /**
   * Applies the new-password policy, but ONLY when the vault has no keys yet.
   *
   * Adding a second key re-enters the EXISTING vault password (it must match,
   * so the envelope verifier can open). Running a new-password policy there
   * would tell a pre-existing user their own correct password is invalid, with
   * no change-password flow to escape through.
   *
   * Returns an error response to send, or null when the password is acceptable.
   */
  private async enforceNewPasswordPolicy(
    password: string,
    method: string,
    context: ServiceContext,
    label?: string
  ): Promise<RpcResponse | null> {
    const existing = await context.vault.listKeys();
    if (existing.length > 0) return null; // not a new password

    // Background-only import: the blocklist must not reach a UI bundle.
    const [{ COMMON_PASSWORDS }, { makeNewPasswordSchema }] =
      await Promise.all([
        import("@/domain/utils/wordlists/common-passwords"),
        import("@/infrastructure/validation/schemas"),
      ]);
    const schema = makeNewPasswordSchema(
      COMMON_PASSWORDS,
      label ? [label] : []
    );
    const result = schema.safeParse(password);
    if (result.success) return null;

    return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
      details: result.error.issues[0]?.message ?? "Password does not meet the policy.",
      method,
    });
  }

  private async handleUnlock(
    message: Extract<RpcRequest, { type: "vault.unlock" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate password
    const passwordValidation = PasswordSchema.safeParse(message.password);
    if (!passwordValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
        details: passwordValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Checked BEFORE any derivation: deriving first would let an attacker
    // spend the defender's CPU on every attempt regardless of the lockout.
    const waitMs = await context.unlockThrottle.check();
    if (waitMs > 0) {
      return createRpcErrorResponse(RPC_ERROR_CODES.RATE_LIMITED, {
        details: `Too many failed attempts. Try again in ${Math.ceil(
          waitMs / 1000
        )} seconds.`,
        method: message.type,
      });
    }

    try {
      const data = await context.vault.unlock(message.password);
      await context.unlockThrottle.recordSuccess();
      return { ok: true, data };
    } catch (error) {
      if (error instanceof Error) {
        // A wrong password and a damaged vault are different problems and must
        // not be reported identically. Previously every unlock failure surfaced
        // as "incorrect password", so a corrupt record sent the user hunting
        // for a password that was never wrong.
        if (error.message === "incorrect_password") {
          const delay = await context.unlockThrottle.recordFailure();
          return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
            details:
              delay > 0
                ? `Incorrect password. Further attempts are paused for ${Math.ceil(
                    delay / 1000
                  )} seconds.`
                : "Incorrect password",
            method: message.type,
          });
        }
        if (error.message === "vault_not_created") {
          return createRpcErrorResponse(RPC_ERROR_CODES.NO_KEY_SELECTED, {
            details:
              "No vault exists yet. Create or import a key before unlocking.",
            method: message.type,
          });
        }
        if (
          error.message === "vault_version_unsupported" ||
          error.message === "kdf_below_floor" ||
          error.message === "kdf_unknown_algorithm"
        ) {
          return createRpcErrorResponse(RPC_ERROR_CODES.VAULT_UNREADABLE, {
            details:
              "This vault was written by a different version of Ostrilo, or its stored encryption parameters are not acceptable. Update the extension; do not re-create your vault.",
            method: message.type,
          });
        }
      }
      throw error;
    }
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
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
        details: passwordValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Validate label if provided
    if (message.label !== undefined) {
      const labelValidation = LabelSchema.safeParse(message.label);
      if (!labelValidation.success) {
        return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
          details: labelValidation.error.issues[0]?.message,
          method: message.type,
        });
      }
    }

    const policyError = await this.enforceNewPasswordPolicy(
      message.password,
      message.type,
      context,
      message.label
    );
    if (policyError) return policyError;

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
          return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
            details: "Password is required",
            method: message.type,
          });
        }
        if (error.message === "incorrect_password") {
          return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
            details:
              "Incorrect password. Please use the same password as your existing keys.",
            method: message.type,
          });
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
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_KEY_INPUT, {
        details: keyInputValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Validate password (required)
    const passwordValidation = PasswordSchema.safeParse(message.password);
    if (!passwordValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
        details: passwordValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Validate label if provided
    if (message.label !== undefined) {
      const labelValidation = LabelSchema.safeParse(message.label);
      if (!labelValidation.success) {
        return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
          details: labelValidation.error.issues[0]?.message,
          method: message.type,
        });
      }
    }

    const importPolicyError = await this.enforceNewPasswordPolicy(
      message.password,
      message.type,
      context,
      message.label
    );
    if (importPolicyError) return importPolicyError;

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
          return createRpcErrorResponse(RPC_ERROR_CODES.KEY_ALREADY_EXISTS, {
            details: "A key with this public key already exists",
            method: message.type,
          });
        }
        if (error.message === "incorrect_password") {
          return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
            details:
              "Incorrect password. Please use the same password as your existing keys.",
            method: message.type,
          });
        }
        if (error.message === "vault_locked") {
          return createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, {
            details: "Vault is locked. Please unlock first.",
            method: message.type,
          });
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
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: keyIdValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    await context.vault.selectKey(message.id);
    return { ok: true, data: null };
  }

  private async handleReveal(
    message: Extract<RpcRequest, { type: "vault.reveal" }>,
    context: ServiceContext
  ): Promise<RpcResponse> {
    // Validate password (required)
    const passwordValidation = PasswordSchema.safeParse(message.password);
    if (!passwordValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
        details: passwordValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Validate key ID if provided
    if (message.keyId !== undefined) {
      const keyIdValidation = KeyIdSchema.safeParse(message.keyId);
      if (!keyIdValidation.success) {
        return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
          details: keyIdValidation.error.issues[0]?.message,
          method: message.type,
        });
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
          return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
            details: "Password is required",
            method: message.type,
          });
        }
        if (error.message === "incorrect_password") {
          return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
            details: "Incorrect password",
            method: message.type,
          });
        }
        if (error.message === "key_not_found") {
          return createRpcErrorResponse(RPC_ERROR_CODES.KEY_NOT_FOUND, {
            details: "Key not found",
            method: message.type,
          });
        }
        if (error.message === "vault_locked") {
          return createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, {
            details: "Vault is locked",
            method: message.type,
          });
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
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: keyIdValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    // Validate label
    const labelValidation = LabelSchema.safeParse(message.label);
    if (!labelValidation.success) {
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: labelValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    try {
      await context.vault.renameKey(message.id, message.label);
      return { ok: true, data: null };
    } catch (error) {
      if (error instanceof Error && error.message === "key_not_found") {
        return createRpcErrorResponse(RPC_ERROR_CODES.KEY_NOT_FOUND, {
          details: "The specified key does not exist",
          method: message.type,
        });
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
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
        details: keyIdValidation.error.issues[0]?.message,
        method: message.type,
      });
    }

    try {
      const data = await context.vault.deleteKey(message.id);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "key_not_found") {
          return createRpcErrorResponse(RPC_ERROR_CODES.KEY_NOT_FOUND, {
            details: "The specified key does not exist",
            method: message.type,
          });
        }
        if (error.message === "cannot_delete_last_key") {
          return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
            details: "Cannot delete the last remaining key",
            method: message.type,
          });
        }
      }
      throw error;
    }
  }
}

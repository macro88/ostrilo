import type { RpcRequest, RpcResponse } from "../rpc";
import { requireReauth } from "@/infrastructure/messaging/reauth";
import { withPasswordThrottle } from "@/infrastructure/messaging/password-throttle";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { RpcModule, ServiceContext } from "../rpc-router";
import {
  PasswordSchema,
  KeyInputSchema,
  LabelSchema,
  KeyIdSchema,
} from "@/infrastructure/validation/schemas";
import type { KeyRecord } from "@/domain/types";
import { isValidHex, hexToBytes } from "@/domain/utils/hex";
import { CRYPTO_CONSTANTS } from "@/domain/crypto/constants";
import { ScureBech32 } from "@/infrastructure/crypto/adapters";

/**
 * A stored key record plus its bech32 public key.
 *
 * `npub` is ADDITIVE: an existing caller that ignores it behaves exactly as
 * before. It exists so the UI stops encoding bech32 itself. The options page
 * used to call `publicKeyToBech32(hexToBytes(key.pubkey))` inside a React
 * render, which put `@scure/base` in a UI bundle and - because that decoder
 * silently substituted zero bytes for unparseable characters - turned a
 * corrupt stored pubkey into a real, well-formed npub for a key nobody holds.
 *
 * It is OPTIONAL by design. A record whose stored `pubkey` is not 64
 * characters of hex gets no `npub` at all, and the UI renders that record as
 * unreadable. Encoding it anyway is what produced the zero-derived identity.
 */
export interface KeyListEntry extends KeyRecord {
  npub?: string;
}

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
    const method = message.type;
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
          details: method,
          method,
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

  /**
   * Runs a key write, charging the shared password throttle when it proves an
   * existing vault password.
   *
   * Adding a key to an existing vault re-enters that vault's password, and a
   * wrong one is a guess like any other. Creating the first vault verifies
   * nothing - there is no password yet to be wrong about - so it is not
   * charged.
   */
  private async writeUnderThrottle<T>(
    context: ServiceContext,
    method: string,
    write: () => Promise<T>
  ): Promise<RpcResponse> {
    const [keys, envelope] = await Promise.all([
      context.vault.listKeys(),
      context.vault.getEnvelope(),
    ]);
    if (keys.length === 0 && !envelope) {
      return { ok: true, data: await write() };
    }
    const result = await withPasswordThrottle(
      context,
      method,
      write,
      "Incorrect password. Please use the same password as your existing keys."
    );
    return result.ok ? { ok: true, data: result.value } : result.response;
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

    try {
      const result = await withPasswordThrottle(context, message.type, () =>
        context.vault.unlock(message.password)
      );
      return result.ok ? { ok: true, data: result.value } : result.response;
    } catch (error) {
      if (error instanceof Error) {
        // A wrong password and a damaged vault are different problems and must
        // not be reported identically. The throttle maps only
        // `incorrect_password`; everything below is a vault problem.
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
          error.message === "kdf_above_ceiling" ||
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
      return await this.writeUnderThrottle(context, message.type, () =>
        context.vault.generateKey(message.password, message.label)
      );
    } catch (error) {
      if (error instanceof Error && error.message === "password_required") {
        return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
          details: "Password is required",
          method: message.type,
        });
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
      return await this.writeUnderThrottle(context, message.type, () =>
        context.vault.importKey(message.keyInput, message.password, message.label)
      );
    } catch (error) {
      // Translate service errors to RPC codes
      if (error instanceof Error) {
        // aislop-ignore-next-line ai-slop/hardcoded-id -- internal error contract: the service error string this branch maps to RPC_ERROR_CODES.KEY_ALREADY_EXISTS. Not a deployment identifier or credential.
        if (error.message === "key_already_exists") {
          return createRpcErrorResponse(RPC_ERROR_CODES.KEY_ALREADY_EXISTS, {
            details: "A key with this public key already exists",
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
      const result = await withPasswordThrottle(context, message.type, () =>
        context.vault.revealKey(message.password, message.keyId)
      );
      return result.ok ? { ok: true, data: result.value } : result.response;
    } catch (error) {
      // Translate service errors to RPC codes
      if (error instanceof Error) {
        if (error.message === "password_required") {
          return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
            details: "Password is required",
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
    const records = await context.vault.listKeys();
    const data: KeyListEntry[] = records.map((record) => ({
      ...record,
      npub: isValidHex(record.pubkey, 32)
        ? ScureBech32.encode(
            CRYPTO_CONSTANTS.NOSTR_PUBLIC_KEY_PREFIX,
            hexToBytes(record.pubkey)
          )
        : undefined,
    }));
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

    // Deleting a key is irreversible and, for a key that is not backed up,
    // final. An unlocked vault is not enough authority for that.
    const reauth = await requireReauth(message.password, message.type, context);
    if (reauth) return reauth;

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

import type { RpcRequest, RpcResponse } from "../rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { ServiceContext } from "../rpc-router";
import { withPasswordThrottle } from "../password-throttle";
import { ChangePasswordRequestSchema } from "@/infrastructure/validation/schemas";
import { VaultDamagedRecordsError } from "@/application/services/key-vault.service";

/**
 * The refusal for a password that fails the creation policy, or null.
 *
 * Shared by vault creation and password change so the two cannot drift. The
 * blocklist is imported here, in the background, and never reaches a UI
 * bundle. The details text names the rule broken and never echoes the
 * password.
 */
export async function newPasswordPolicyError(
  password: string,
  method: string,
  extraTerms: readonly string[]
): Promise<RpcResponse | null> {
  const [{ COMMON_PASSWORDS }, { makeNewPasswordSchema }] = await Promise.all([
    import("@/domain/utils/wordlists/common-passwords"),
    import("@/infrastructure/validation/schemas"),
  ]);
  const result = makeNewPasswordSchema(COMMON_PASSWORDS, extraTerms).safeParse(
    password
  );
  if (result.success) return null;
  return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
    details: result.error.issues[0]?.message,
    method,
  });
}

/**
 * `vault.changePassword`: verify the current password under the shared
 * throttle, hold the new one to the creation policy, and rotate the KEK.
 *
 * Every refusal leaves storage untouched; the service refuses before it
 * derives the new KEK, and commits through a journal. No `details` string
 * carries either password.
 */
export async function handleChangePassword(
  message: Extract<RpcRequest, { type: "vault.changePassword" }>,
  context: ServiceContext
): Promise<RpcResponse> {
  const method = message.type;
  const parsed = ChangePasswordRequestSchema.safeParse({
    currentPassword: message.currentPassword,
    newPassword: message.newPassword,
  });
  if (!parsed.success) {
    return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
      details: parsed.error.issues[0]?.message,
      method,
    });
  }
  const { currentPassword, newPassword } = parsed.data;
  if (currentPassword === newPassword) {
    return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, {
      details: "The new password must differ from the current one.",
      method,
    });
  }

  // Cheap, and before the throttle: a weak new password costs no derivation
  // and is no guess at the current one.
  const labels = (await context.vault.listKeys())
    .map((k) => k.label)
    .filter((l): l is string => typeof l === "string" && l.length > 0);
  const policyError = await newPasswordPolicyError(newPassword, method, labels);
  if (policyError) return policyError;

  try {
    const result = await withPasswordThrottle(
      context,
      method,
      () => context.vault.changePassword(currentPassword, newPassword),
      "That is not your current password."
    );
    return result.ok ? { ok: true, data: null } : result.response;
  } catch (error) {
    return changePasswordRefusal(error, method);
  }
}

/** Maps a service refusal to its canonical code, rethrowing anything else. */
function changePasswordRefusal(error: unknown, method: string): RpcResponse {
  if (error instanceof VaultDamagedRecordsError) {
    return createRpcErrorResponse(RPC_ERROR_CODES.VAULT_RECORDS_DAMAGED, {
      details: `Key records that do not open: ${error.keyIds.join(", ")}`,
      method,
    });
  }
  const code = error instanceof Error ? error.message : "";
  if (code === "vault_has_legacy_records") {
    return createRpcErrorResponse(RPC_ERROR_CODES.VAULT_MIGRATION_PENDING, {
      details: "Unlock the vault once to finish migrating it, then try again.",
      method,
    });
  }
  if (code === "vault_not_created") {
    return createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, { method });
  }
  if (
    code === "vault_version_unsupported" ||
    code === "kdf_below_floor" ||
    code === "kdf_above_ceiling" ||
    code === "kdf_unknown_algorithm"
  ) {
    return createRpcErrorResponse(RPC_ERROR_CODES.VAULT_UNREADABLE, { method });
  }
  throw error;
}

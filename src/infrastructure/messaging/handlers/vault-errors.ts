import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import type { RpcResponse } from "../rpc";

/**
 * Maps a vault problem raised by an unlock to its response, or returns null
 * when the error is not one.
 *
 * Shared by the password and biometric unlock paths: a damaged vault is the
 * same problem whichever factor found it, and must not be reported as a wrong
 * password or a refused factor.
 */
export function vaultProblemResponse(
  error: unknown,
  method: string
): RpcResponse | null {
  if (!(error instanceof Error)) return null;
  if (error.message === "vault_not_created") {
    return createRpcErrorResponse(RPC_ERROR_CODES.NO_KEY_SELECTED, {
      details: "No vault exists yet. Create or import a key before unlocking.",
      method,
    });
  }
  if (error.message === "vault_keys_unreadable") {
    return createRpcErrorResponse(RPC_ERROR_CODES.VAULT_UNREADABLE, {
      details:
        "The password is right, but none of this vault's keys could be opened. Their records may be damaged. Do not re-create your vault.",
      method,
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
      method,
    });
  }
  return null;
}

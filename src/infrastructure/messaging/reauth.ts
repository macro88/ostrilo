import { createRpcErrorResponse } from "@/infrastructure/messaging/rpc";
import type { RpcResponse } from "@/infrastructure/messaging/rpc";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import { withPasswordThrottle } from "@/infrastructure/messaging/password-throttle";

/**
 * Password re-authentication for high-risk actions.
 *
 * The problem this closes: an unlocked vault was a single, undifferentiated
 * level of authority. Anything the user could do, anyone at the keyboard of an
 * unlocked session could do - and the most damaging of those actions are the
 * quiet ones. Raising an origin to `high` trust takes two clicks, produces no
 * prompt afterwards, and signs silently from then on. Deleting a key is
 * irreversible. Lengthening the auto-lock timeout buys the next person time.
 *
 * Re-entry is verified by decrypting real key material, which is the same check
 * `unlock` makes. Nothing is cached: the password is verified for one action
 * and a second action needs a second entry. That is deliberate - a "verified
 * for the next N minutes" window is the same unbounded-authority mistake in a
 * smaller box.
 *
 * The check lives HERE, at the message boundary, not in the dialog that
 * collects the password. A confirmation the UI performs is a confirmation an
 * attacker skips by sending the message directly.
 */

/**
 * Returns an error response when re-authentication fails, or null when the
 * action may proceed.
 */
export async function requireReauth(
  password: string | undefined,
  method: string,
  context: ServiceContext
): Promise<RpcResponse | null> {
  if (typeof password !== "string" || password.length === 0) {
    return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
      details: "This action requires your password",
      method,
    });
  }

  try {
    // Throttled with every other password check: re-auth is a verification
    // oracle like unlock, and an unthrottled one would be the path to guess on.
    const result = await withPasswordThrottle(context, method, () =>
      context.vault.verifyPassword(password)
    );
    return result.ok ? null : result.response;
  } catch (error) {
    if (error instanceof Error && error.message === "vault_not_created") {
      return createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, { method });
    }
    // `verifyPassword` already reports every verification failure as
    // `incorrect_password`, which the throttle maps. What reaches here is
    // infrastructure - a throttle write that failed - and reporting it as a
    // wrong password would send the user hunting for one that was right.
    throw error;
  }
}

/** The settings fields whose change requires the password. */
export const REAUTH_SETTINGS_FIELDS = [
  "autoLockMinutes",
  "sessionTTLMinutes",
] as const;

/** True when this settings patch changes a security timeout. */
export function patchNeedsReauth(patch: unknown): boolean {
  if (!patch || typeof patch !== "object") return false;
  return REAUTH_SETTINGS_FIELDS.some((f) => f in (patch as object));
}

/**
 * Origin-policy patch fields, each classified by whether some value of it
 * grants standing authority. The security suite enumerates the patch schema
 * against these two lists, so a field added to the schema without a decision
 * here fails a test instead of shipping ungated.
 */
export const ORIGIN_PATCH_AUTHORITY_FIELDS = [
  "trustLevel",
  "identityDisclosure",
] as const;
export const ORIGIN_PATCH_INERT_FIELDS = ["name"] as const;

/**
 * True when this origin-policy patch grants authority that is used silently
 * from then on: `high` trust signs without prompting, and a disclosure `allow`
 * hands the public key to the site on every request. Tightening either, and
 * renaming, stay free.
 */
export function patchGrantsAuthority(patch: {
  trustLevel?: string;
  identityDisclosure?: string;
}): boolean {
  return patch.trustLevel === "high" || patch.identityDisclosure === "allow";
}

import { RPC_ERROR_CODES, createRpcErrorResponse } from "./error-codes";
import type { RpcResponse } from "./rpc";
import type { ServiceContext } from "./rpc-router";

/**
 * The one gate every master-password check goes through.
 *
 * The throttle used to guard `vault.unlock` alone. `requireReauth`,
 * `vault.reveal`, and `vault.generate` / `vault.import` against an existing
 * vault each verified the same password with no backoff - and the last three
 * are reachable while locked - so the lockout bounded guessing only on the path
 * an attacker had no reason to use.
 *
 * The counter is shared, not per-method: it is one secret, and an attacker who
 * has used up the unlock attempts must not find fresh ones on `vault.reveal`.
 * A verified password resets it on any path, as a successful unlock always has.
 */

export type ThrottledResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: RpcResponse };

function seconds(ms: number): number {
  return Math.ceil(ms / 1000);
}

/** The `rate_limited` refusal for an attempt made during a backoff. */
export function rateLimitedResponse(waitMs: number, method: string): RpcResponse {
  return createRpcErrorResponse(RPC_ERROR_CODES.RATE_LIMITED, {
    details: `Too many failed attempts. Try again in ${seconds(waitMs)} seconds.`,
    method,
  });
}

/**
 * Runs `verify` under the shared throttle.
 *
 * Checked BEFORE `verify`, so a refused attempt derives nothing: deriving
 * first would let an attacker spend the defender's CPU regardless of the
 * lockout. Only `incorrect_password` is charged; any other error is not a
 * guess and propagates to the caller's own mapping.
 */
export async function withPasswordThrottle<T>(
  context: ServiceContext,
  method: string,
  verify: () => Promise<T>,
  incorrectDetails = "Incorrect password"
): Promise<ThrottledResult<T>> {
  const waitMs = await context.unlockThrottle.check();
  if (waitMs > 0) {
    return { ok: false, response: rateLimitedResponse(waitMs, method) };
  }

  let value: T;
  try {
    value = await verify();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "incorrect_password") {
      throw error;
    }
    const delay = await context.unlockThrottle.recordFailure();
    const details =
      delay > 0
        ? `${incorrectDetails.replace(/\.$/, "")}. Further attempts are paused for ${seconds(delay)} seconds.`
        : incorrectDetails;
    return {
      ok: false,
      response: createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
        details,
        method,
      }),
    };
  }
  await context.unlockThrottle.recordSuccess();
  return { ok: true, value };
}

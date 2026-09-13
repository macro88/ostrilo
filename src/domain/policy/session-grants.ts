/**
 * Session-grant lifetime rules.
 *
 * A session grant is the broadest authority the product offers: it allows every
 * unprotected kind for an origin without prompting. It is therefore the one
 * thing that should expire soonest.
 *
 * The previous behaviour stored `expiresAt: 0` for a `sessionTTLMinutes` of `0`
 * and read that as "active forever", which with auto-lock disabled is
 * effectively permanent. There is no longer a value of `sessionTTLMinutes` that
 * produces an unbounded grant.
 */

/** Shipped default lifetime for a grant-everything session, in minutes. */
export const DEFAULT_SESSION_TTL_MINUTES = 15;

/**
 * Upper bound, matching the settings schema.
 *
 * Lowered from 1440 to 60 alongside auto-lock enforcement: the vault now
 * locks after at most 60 minutes and locking revokes grants, so a longer
 * TTL only ever described time the grant could not survive.
 */
export const MAX_SESSION_TTL_MINUTES = 60;

/**
 * Resolve a stored `sessionTTLMinutes` to a usable, bounded number of minutes.
 *
 * A missing, zero, negative, fractional or out-of-range value reads as the
 * default rather than as "never expires".
 */
export function resolveSessionTTLMinutes(stored: unknown): number {
  if (typeof stored !== "number" || !Number.isFinite(stored)) {
    return DEFAULT_SESSION_TTL_MINUTES;
  }

  const minutes = Math.floor(stored);
  if (minutes < 1) {
    return DEFAULT_SESSION_TTL_MINUTES;
  }

  return Math.min(minutes, MAX_SESSION_TTL_MINUTES);
}

/** Absolute expiry for a grant created now, in epoch milliseconds. */
export function computeGrantExpiry(
  storedTTLMinutes: unknown,
  now: number = Date.now()
): number {
  return now + resolveSessionTTLMinutes(storedTTLMinutes) * 60 * 1000;
}

/**
 * Whether a stored expiry timestamp represents a live grant.
 *
 * `0` is not a special case any more: it is simply in the past.
 */
export function isGrantActive(
  expiresAt: unknown,
  now: number = Date.now()
): boolean {
  return typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > now;
}

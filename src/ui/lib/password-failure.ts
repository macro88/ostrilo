import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";

/**
 * The codes whose `details` the background fills with a countdown the UI
 * cannot compute for itself - the throttle's remaining wait - so the detail is
 * worth more than any local copy.
 *
 * Shared by every surface that collects the master password, because every
 * password check shares one throttle: a wait earned at the lock screen shows
 * up in the re-authentication dialog, and must read as a wait there too, not
 * as a wrong password.
 *
 * The residual to keep in mind: for these codes the detail string is rendered
 * verbatim, so editing it in the background reaches the screen without passing
 * through the UI.
 */
const CODES_CARRYING_A_COUNTDOWN: ReadonlySet<string> = new Set([
  RPC_ERROR_CODES.INVALID_PASSWORD,
  RPC_ERROR_CODES.RATE_LIMITED,
]);

/** The background's countdown detail for this code, or undefined. */
export function countdownDetail(
  code: string,
  detail: string | undefined
): string | undefined {
  return detail && CODES_CARRYING_A_COUNTDOWN.has(code) ? detail : undefined;
}

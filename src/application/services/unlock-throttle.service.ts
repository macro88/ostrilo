import type { StoragePort } from "@/application/ports/storage";

/**
 * Throttles failed unlock attempts.
 *
 * The defect this replaces: `LockScreen` held an `attemptCount` in component
 * state that rendered "(N attempts)" and a warning after three tries. There was
 * no delay, no backoff and no lockout, and because it was component state,
 * closing and reopening the popup reset it. Guessing was bounded only by KDF
 * cost, and an attacker driving the RPC surface directly never saw it at all.
 *
 * Three design points worth stating:
 *
 *  1. It lives in the BACKGROUND, not the UI. A check the UI performs is a
 *     check an attacker skips by sending the message directly.
 *  2. State is persisted, not held in a timer. `setTimeout` does not survive
 *     MV3 service-worker termination, so a timer-based lockout would evaporate
 *     roughly thirty seconds after it was set.
 *  3. It is checked BEFORE key derivation. Deriving first would let an attacker
 *     spend the defender's CPU on every attempt regardless of the lockout.
 *
 * What it does NOT protect against, stated plainly: an attacker who copies the
 * encrypted vault off disk and attacks it offline never touches this code. Only
 * the KDF work factor and the password itself matter there. This defends the
 * live extension against someone at the keyboard or on the message bus.
 */

const STORAGE_KEY = "unlockThrottle";

export interface ThrottleState {
  failures: number;
  /** Epoch ms until which unlock is refused. 0 when not locked out. */
  lockedUntil: number;
  /** Epoch ms of the last failure, used to decay the counter. */
  lastFailureAt: number;
}

export const THROTTLE_POLICY = {
  /** Attempts allowed before any delay is imposed. */
  freeAttempts: 3,
  /** First delay after the free attempts are used, in ms. */
  baseDelayMs: 5_000,
  /** Ceiling on the backoff, in ms. */
  maxDelayMs: 60 * 60 * 1000,
  /** A quiet period this long resets the counter, in ms. */
  decayAfterMs: 24 * 60 * 60 * 1000,
} as const;

const EMPTY: ThrottleState = { failures: 0, lockedUntil: 0, lastFailureAt: 0 };

export class UnlockThrottleService {
  constructor(
    private storage: StoragePort,
    private now: () => number = () => Date.now()
  ) {}

  private async read(): Promise<ThrottleState> {
    const s = await this.storage.get<ThrottleState>(STORAGE_KEY);
    if (!s || typeof s !== "object") return { ...EMPTY };
    return {
      failures: Number.isFinite(s.failures) ? s.failures : 0,
      lockedUntil: Number.isFinite(s.lockedUntil) ? s.lockedUntil : 0,
      lastFailureAt: Number.isFinite(s.lastFailureAt) ? s.lastFailureAt : 0,
    };
  }

  private delayFor(failures: number): number {
    const over = failures - THROTTLE_POLICY.freeAttempts;
    if (over <= 0) return 0;
    const delay = THROTTLE_POLICY.baseDelayMs * Math.pow(2, over - 1);
    return Math.min(delay, THROTTLE_POLICY.maxDelayMs);
  }

  /**
   * Call BEFORE deriving anything. Returns the remaining lockout in ms, or 0
   * when an attempt is permitted.
   */
  async check(): Promise<number> {
    const state = await this.read();
    const now = this.now();

    // A long quiet period clears the counter: a user who mistyped last month
    // should not be starting from a penalty.
    if (
      state.lastFailureAt > 0 &&
      now - state.lastFailureAt > THROTTLE_POLICY.decayAfterMs
    ) {
      await this.storage.set(STORAGE_KEY, { ...EMPTY });
      return 0;
    }

    if (state.lockedUntil > now) return state.lockedUntil - now;
    return 0;
  }

  async recordFailure(): Promise<number> {
    const state = await this.read();
    const now = this.now();
    const failures = state.failures + 1;
    const delay = this.delayFor(failures);
    await this.storage.set<ThrottleState>(STORAGE_KEY, {
      failures,
      lockedUntil: delay > 0 ? now + delay : 0,
      lastFailureAt: now,
    });
    return delay;
  }

  async recordSuccess(): Promise<void> {
    await this.storage.set<ThrottleState>(STORAGE_KEY, { ...EMPTY });
  }
}

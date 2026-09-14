/**
 * Bounds how often one origin may ask for the user's public key.
 *
 * The defect this exists for: `nostr.getPublicKey` had no limit of any kind.
 * A tab left open could call it in a tight loop and capture the npub the
 * millisecond the user unlocked, so the auto-lock timeout bought nothing
 * against a persistent page. That is the strongest concrete harm in the
 * disclosure surface, and it does not need the consent gate to be closed - it
 * needs a limit.
 *
 * What it does and does not do, stated plainly:
 *
 *  - It caps how often an origin may SAMPLE. A page cannot sit in a loop.
 *  - It does NOT stop the first call after an unlock from succeeding. Only the
 *    consent gate does that.
 *
 * DELIBERATELY SEPARATE FROM THE APPROVAL QUEUE. `QUEUE_LIMITS` in
 * `approval-queue.service.ts:41-49` is the model for the rolling-window shape,
 * but the counters must not be shared: a disclosure flood from one origin must
 * not be able to consume the capacity a pending signature from another origin
 * needs.
 *
 * ON MV3 EVICTION. The window is held in memory, matching the approval queue.
 * A service worker evicted after ~30s idle loses the counters. That is the
 * right trade here: the attack this bounds is a fast polling loop, and a page
 * polling fast enough to matter is also what keeps the worker alive. An
 * attacker patient enough to wait out an eviction between calls is already
 * within any rate this would impose.
 */

export const DISCLOSURE_RATE_LIMITS = {
  /** Calls one origin may make per rolling window. */
  perOriginPerWindow: 6,
  windowMs: 60_000,
} as const;

export class DisclosureRateLimitService {
  private history = new Map<string, number[]>();

  constructor(private now: () => number = () => Date.now()) {}

  private recent(origin: string): number[] {
    const cutoff = this.now() - DISCLOSURE_RATE_LIMITS.windowMs;
    const kept = (this.history.get(origin) ?? []).filter((at) => at > cutoff);
    if (kept.length > 0) {
      this.history.set(origin, kept);
    } else {
      // Do not keep an entry for an origin whose allowance has fully decayed:
      // an attacker cycling subdomains would otherwise grow this map without
      // bound for the life of the worker.
      this.history.delete(origin);
    }
    return kept;
  }

  /** True when this origin may make one more call right now. */
  isAllowed(origin: string): boolean {
    return (
      this.recent(origin).length < DISCLOSURE_RATE_LIMITS.perOriginPerWindow
    );
  }

  /** Charges one call against this origin's allowance. */
  record(origin: string): void {
    const kept = this.recent(origin);
    kept.push(this.now());
    this.history.set(origin, kept);
  }

  /**
   * Checks and charges in one step, so a caller cannot check and then forget to
   * record. Returns false when the origin is over its allowance, in which case
   * nothing is charged.
   */
  tryConsume(origin: string): boolean {
    if (!this.isAllowed(origin)) return false;
    this.record(origin);
    return true;
  }

  /** Test seam, and the reset a lock performs. */
  clear(): void {
    this.history.clear();
  }
}

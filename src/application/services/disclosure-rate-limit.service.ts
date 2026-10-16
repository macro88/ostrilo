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
 * ON MV3 EVICTION. The window is persisted in `storage.session` (see
 * `rolling-window-counters.ts`). It used to live in worker memory only, on the
 * argument that a page polling fast enough to matter keeps the worker alive.
 * That fails while the vault is locked: no keepalive runs then, the worker is
 * evicted after ~30s idle, and each eviction handed the page a fresh allowance.
 * The window now outlives the worker and dies with the browser session.
 */

import type { StoragePort } from "@/application/ports/storage";
import { RollingWindowCounters } from "./rolling-window-counters";

export const DISCLOSURE_RATE_LIMITS = {
  /** Calls one origin may make per rolling window. */
  perOriginPerWindow: 6,
  windowMs: 60_000,
} as const;

/** Distinct from every other counter's record. */
export const DISCLOSURE_WINDOW_STORAGE_KEY = "rateWindow:disclosure";

export class DisclosureRateLimitService {
  private readonly windows: RollingWindowCounters;

  constructor(now: () => number = () => Date.now(), storage?: StoragePort) {
    this.windows = new RollingWindowCounters({
      storage,
      storageKey: DISCLOSURE_WINDOW_STORAGE_KEY,
      windowMs: DISCLOSURE_RATE_LIMITS.windowMs,
      maxPerOrigin: DISCLOSURE_RATE_LIMITS.perOriginPerWindow,
      now,
    });
  }

  /** Resolves once the persisted window has been read. Await before enforcing. */
  ready(): Promise<void> {
    return this.windows.ready();
  }

  /** Resolves when every charge so far has been written. */
  settled(): Promise<void> {
    return this.windows.settled();
  }

  /** True when this origin may make one more call right now. */
  isAllowed(origin: string): boolean {
    return (
      this.windows.count(origin) < DISCLOSURE_RATE_LIMITS.perOriginPerWindow
    );
  }

  /** Charges one call against this origin's allowance. */
  record(origin: string): void {
    this.windows.record(origin);
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

  /** Test seam. */
  clear(): void {
    this.windows.clear();
  }
}

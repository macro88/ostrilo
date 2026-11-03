import { MAX_TRACKED_ORIGINS } from "./rolling-window-counters";

/**
 * Lets one origin's refusals reach the activity log once per window.
 *
 * The log is a ring buffer, so a row costs a row of real history. A refusal
 * the queue's caps cause is not itself charged to anything, which means a page
 * could write one row per call, each carrying its own content, until the
 * buffer had rotated out everything the user would want to audit. One row says
 * the origin was refused; the rest only crowd the record.
 *
 * Memory only. After a worker restart the first refusal writes a row again,
 * which costs one row per restart, not one per call.
 */
export class RefusalLogCoalescer {
  private readonly lastLoggedAt = new Map<string, number>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** True when this origin has not had a row written inside the window. */
  shouldLog(origin: string): boolean {
    const now = this.now();
    const last = this.lastLoggedAt.get(origin);
    if (last !== undefined && now - last < this.windowMs) return false;

    // Re-inserted, so Map order is oldest-logged first and the cap below
    // drops the origin that has been quiet longest.
    this.lastLoggedAt.delete(origin);
    this.lastLoggedAt.set(origin, now);
    if (this.lastLoggedAt.size > MAX_TRACKED_ORIGINS) {
      const oldest = this.lastLoggedAt.keys().next().value;
      if (oldest !== undefined) this.lastLoggedAt.delete(oldest);
    }
    return true;
  }
}

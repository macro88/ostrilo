import type { StoragePort } from "@/application/ports/storage";
import { RollingWindowCounters } from "./rolling-window-counters";

/**
 * How many requests one origin may have signed WITHOUT a prompt.
 *
 * A remembered allow rule or a high trust level makes a site's requests sign
 * silently. That is the point of the feature, and it is also an uncapped
 * signing oracle: a compromised or hostile page on a trusted origin could ask
 * for thousands of signatures a minute and the user would see none of it. The
 * approval flood controls never applied, because no approval entry is created.
 *
 * The budget does not refuse anything. A request over it is sent to the
 * approval window exactly as an unremembered request is, so the user decides
 * and the queue's own limits apply. Refusing would turn a busy but legitimate
 * client (a feed reacting to a scroll) into an outage; asking turns a flood
 * into a prompt.
 *
 * Per origin, and separate from the approval queue's enqueue window: a
 * silently signed request is not an approval request, and one must not eat the
 * other's allowance.
 */
export const AUTO_SIGN_BUDGET = {
  /** Silent signatures one origin may receive per rolling window. */
  perOriginPerWindow: 60,
  windowMs: 60_000,
} as const;

/** Distinct from every other counter's record. */
export const AUTO_SIGN_WINDOW_STORAGE_KEY = "rateWindow:autoSign";

export class AutoSignBudgetService {
  private readonly windows: RollingWindowCounters;

  constructor(now: () => number = () => Date.now(), storage?: StoragePort) {
    this.windows = new RollingWindowCounters({
      storage,
      storageKey: AUTO_SIGN_WINDOW_STORAGE_KEY,
      windowMs: AUTO_SIGN_BUDGET.windowMs,
      maxPerOrigin: AUTO_SIGN_BUDGET.perOriginPerWindow,
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

  /**
   * Spends one silent signature. Returns false, charging nothing, when the
   * origin has used its budget; the caller then asks the user instead.
   */
  tryConsume(origin: string): boolean {
    if (this.windows.count(origin) >= AUTO_SIGN_BUDGET.perOriginPerWindow) {
      return false;
    }
    this.windows.record(origin);
    return true;
  }
}

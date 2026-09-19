import { normalizeAutoLockMinutes } from "@/domain/types";
import type { SettingsService } from "./settings.service";

/**
 * The three states `browser.idle.queryState` can report.
 *
 * `locked` is an operating-system lock screen, which is a stronger statement
 * of absence than `idle` - the user did not merely stop typing, they shut the
 * machine. Neither counts as presence.
 */
export type IdleState = "active" | "idle" | "locked";

/** What happened when a page-originated signature asked to postpone the lock. */
export type PresenceOutcome = "recorded" | "absent" | "throttled";

export const PRESENCE_LIMITS = {
  /**
   * How often the signing path may consult idle state and record activity.
   *
   * Consumed on every ATTEMPT, not only on success, so a page signing in a
   * tight loop drives one idle query per window rather than one per event.
   * The cost is that a user who returns just after a query waits out the
   * remainder before a signature postpones the lock - bounded at 30s against
   * an inactivity window of at least a minute, so it cannot lose a deadline
   * that should have been postponed.
   */
  throttleMs: 30_000,
  /** `queryState` rejects anything shorter; `AUTO_LOCK_BOUNDS.min` is already above it. */
  minDetectionSeconds: 15,
} as const;

/**
 * Decides whether a signature produced without an approval prompt may postpone
 * the auto-lock deadline.
 *
 * The question the deadline actually asks is "is anyone here?", and for a long
 * time this codebase had no way to ask it - so the auto-sign path was left
 * recording nothing, and a user reacting to posts in a Nostr client got locked
 * out mid-read because reacting is not an interaction with the extension.
 *
 * The tempting fix is to let any auto-signed request postpone the lock. That
 * is worse: the auto-sign branch is unmetered, and the kinds it covers under
 * high trust are the ones clients rewrite on a timer (relay lists, app data),
 * so a pinned tab would hold an unattended vault open forever.
 *
 * Both mistakes come from using "was this signed silently?" as a proxy for
 * "is the user here?". This service replaces the proxy with evidence: the
 * operating system's own input recency, which a page cannot observe, cannot
 * influence, and cannot fabricate. Nothing derived from the request - its
 * origin, kind, frequency, or trust level - is admissible, because all of it
 * is under the control of the thing the evidence is meant to test.
 *
 * ON MV3 EVICTION. The throttle is held in memory, matching
 * `DisclosureRateLimitService`. An evicted worker forgets it and the next
 * signature queries idle state again, which is a query, not a postponement -
 * presence still has to be attested before anything moves.
 *
 * ON KEEPING THE WORKER ALIVE. `queryState` is called only from a path that is
 * already running, because it is producing a signature. Nothing here polls,
 * schedules, or registers a listener, so this adds no wake-up and cannot
 * become the reason the worker that enforces the lock stays resident.
 */
export class UserPresenceService {
  private lastAttemptAt = 0;

  constructor(
    private settings: SettingsService,
    private queryIdle: (detectionSeconds: number) => Promise<IdleState>,
    private now: () => number = () => Date.now()
  ) {}

  /**
   * Records activity through `record` if, and only if, the user is present.
   *
   * `record` is invoked rather than returned to, so the throttle and the write
   * cannot drift apart in a later refactor: there is no way to consume the
   * window and then forget to write, or to write without consulting presence.
   */
  async recordIfPresent(record: () => Promise<void>): Promise<PresenceOutcome> {
    const at = this.now();
    if (at - this.lastAttemptAt < PRESENCE_LIMITS.throttleMs) return "throttled";
    this.lastAttemptAt = at;

    if (!(await this.isPresent())) return "absent";

    await record();
    return "recorded";
  }

  /**
   * True when the machine has had input inside the inactivity window.
   *
   * The detection interval is the configured window, not some short fixed
   * span. A fifteen-second interval answers "did they touch it just now?",
   * which a user reading a long post fails exactly as badly as counting only
   * extension clicks did. The window answers "did they touch it at any point
   * during the period that is about to expire?", which is the question the
   * deadline is about.
   */
  private async isPresent(): Promise<boolean> {
    let state: IdleState;
    try {
      state = await this.queryIdle(await this.detectionSeconds());
    } catch {
      // The permission was refused, the API is absent, or the call failed.
      // Absence is the fail-closed answer: it locks a vault that might have
      // been attended, where the alternative leaves an unattended one open.
      return false;
    }
    return state === "active";
  }

  private async detectionSeconds(): Promise<number> {
    const settings = await this.settings.get().catch(() => undefined);
    const minutes = normalizeAutoLockMinutes(settings?.autoLockMinutes);
    return Math.max(PRESENCE_LIMITS.minDetectionSeconds, minutes * 60);
  }
}

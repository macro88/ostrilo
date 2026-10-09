import { AUTO_LOCK_BOUNDS } from "@/domain/types";

/**
 * How often an unlocked background makes its extension API call.
 *
 * Chrome ends an idle MV3 service worker about 30 seconds after its last event
 * or extension API call; either one resets that timer. 20 seconds leaves a
 * third of the window for a slow tick.
 */
export const SESSION_KEEPALIVE_INTERVAL_MS = 20_000;

/** The furthest deadline a keepalive will believe: the longest auto-lock the product allows. */
const MAX_DEADLINE_AHEAD_MS = AUTO_LOCK_BOUNDS.max * 60 * 1000;

type KeepAliveLockState = { isLocked: boolean; lockAt?: number };

type KeepAliveDeps = {
  /** A cheap extension API call, e.g. `browser.runtime.getPlatformInfo()`. Its result is ignored. */
  ping: () => Promise<unknown>;
  /** The vault's own answer to "is it locked, and until when". Evaluates and enforces the deadline. */
  getLockState: () => Promise<KeepAliveLockState>;
};

/**
 * Keeps the MV3 background alive while - and only while - the vault is unlocked.
 *
 * Decrypted keys live in the worker's memory and nowhere else, so a worker the
 * browser ends is a vault that locks. Without this, a 35 minute auto-lock
 * lasted until the first idle half minute with no extension page open.
 *
 * It holds no secret and writes nothing: its inputs are a ping and a read of
 * the lock state. It cannot outlive the session, because every tick asks the
 * vault first, and the vault enforces the deadline as it answers:
 *
 *  - a tick that finds the vault locked, or cannot tell, stops without pinging;
 *  - the delay before a tick is shortened so one lands on the deadline itself;
 *  - a deadline further away than the longest auto-lock is refused, so a
 *    damaged record cannot buy an unbounded run.
 *
 * Preferring a stop to a guess is deliberate. A keepalive that stops wrongly
 * costs the user a password; one that runs wrongly keeps key material in memory
 * past a lock the user was promised.
 */
export class SessionKeepAlive {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Incremented by every start and stop, so a check already in flight can tell it is stale. */
  private generation = 0;

  constructor(private readonly deps: KeepAliveDeps) {}

  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  /** Begins a run. Starting a running keepalive restarts it, so there is never a second timer. */
  start(): void {
    this.stop();
    this.schedule(SESSION_KEEPALIVE_INTERVAL_MS, this.generation);
  }

  /** Ends the run. Safe to call at any time, including when nothing is running. */
  stop(): void {
    this.generation++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Re-checks the session now, for the moments the deadline moved without a
   * tick noticing - a timeout shortened in Settings, say.
   */
  refresh(): void {
    if (!this.isRunning) return;
    this.stop();
    this.schedule(0, this.generation);
  }

  private schedule(delayMs: number, generation: number): void {
    this.timer = setTimeout(() => void this.tick(generation), delayMs);
  }

  private async tick(generation: number): Promise<void> {
    this.timer = undefined;

    let state: KeepAliveLockState;
    try {
      state = await this.deps.getLockState();
    } catch {
      // A read that failed for a run that has since been stopped or replaced
      // says nothing about the run that exists now: stopping here would kill
      // the keepalive of an unlock that happened while this read was in flight.
      if (generation === this.generation) this.stop();
      return;
    }
    if (generation !== this.generation) return;

    const remaining = state.isLocked ? undefined : this.remainingMs(state.lockAt);
    if (remaining === undefined || remaining <= 0) {
      this.stop();
      return;
    }

    // A failed ping is not retried or reported: it changes nothing this unit
    // can fix, and if the worker is going to die the vault fails closed.
    await this.deps.ping().catch(() => undefined);
    if (generation !== this.generation) return;

    this.schedule(Math.min(SESSION_KEEPALIVE_INTERVAL_MS, remaining), generation);
  }

  /** Milliseconds to a believable deadline, or undefined when there is none. */
  private remainingMs(lockAt: number | undefined): number | undefined {
    if (typeof lockAt !== "number" || !Number.isFinite(lockAt)) return undefined;
    const remaining = lockAt - Date.now();
    return remaining > MAX_DEADLINE_AHEAD_MS ? undefined : remaining;
  }
}

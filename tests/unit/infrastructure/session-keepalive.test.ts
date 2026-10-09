import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_KEEPALIVE_INTERVAL_MS,
  SessionKeepAlive,
} from "@/infrastructure/lifecycle/session-keepalive";
import { AUTO_LOCK_BOUNDS } from "@/domain/types";

/**
 * The keepalive is the owner's answer to the MV3 idle rule: Chrome ends a
 * service worker about 30 seconds after its last event or extension API call,
 * and the decrypted keys live only in that worker's memory. While the vault is
 * unlocked the background makes a cheap extension API call about every 20
 * seconds; the call is the whole of what it does.
 *
 * What it must never do is outlive the session, so most of these tests are
 * about stopping.
 */

const T0 = 1_760_000_000_000;
const MINUTE = 60_000;

type State = { isLocked: boolean; lockAt?: number };

function harness(initial: State) {
  const calls = { ping: 0, state: 0 };
  let state: State = initial;
  let pingImpl: () => Promise<unknown> = async () => ({ os: "mac" });
  let stateImpl: (() => Promise<State>) | undefined;

  const keepAlive = new SessionKeepAlive({
    ping: async () => {
      calls.ping++;
      return pingImpl();
    },
    getLockState: async () => {
      calls.state++;
      if (stateImpl) return stateImpl();
      // The real service locks as it reads, once the deadline has passed.
      if (!state.isLocked && state.lockAt !== undefined && Date.now() >= state.lockAt) {
        state = { isLocked: true };
      }
      return state;
    },
  });

  return {
    keepAlive,
    calls,
    setState: (next: State) => {
      state = next;
    },
    failPingsWith: (error: Error) => {
      pingImpl = async () => {
        throw error;
      };
    },
    failStateWith: (error: Error) => {
      stateImpl = async () => {
        throw error;
      };
    },
  };
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("SessionKeepAlive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings about every 20 seconds, comfortably inside Chrome's 30 second idle window", async () => {
    expect(SESSION_KEEPALIVE_INTERVAL_MS).toBe(20_000);
    const h = harness({ isLocked: false, lockAt: T0 + 35 * MINUTE });
    h.keepAlive.start();
    expect(h.calls.ping).toBe(0);

    await advance(19_999);
    expect(h.calls.ping).toBe(0);
    await advance(1);
    expect(h.calls.ping).toBe(1);

    await advance(60_000);
    expect(h.calls.ping).toBe(4);
    h.keepAlive.stop();
  });

  it("does nothing until started", async () => {
    const h = harness({ isLocked: false, lockAt: T0 + 35 * MINUTE });
    await advance(5 * MINUTE);
    expect(h.calls).toEqual({ ping: 0, state: 0 });
  });

  it("stops at once when stopped, and a stopped keepalive pings nothing more", async () => {
    const h = harness({ isLocked: false, lockAt: T0 + 35 * MINUTE });
    h.keepAlive.start();
    await advance(20_000);
    expect(h.calls.ping).toBe(1);

    h.keepAlive.stop();
    expect(h.keepAlive.isRunning).toBe(false);
    await advance(10 * MINUTE);
    expect(h.calls.ping).toBe(1);
  });

  it("starting twice keeps one timer", async () => {
    const h = harness({ isLocked: false, lockAt: T0 + 35 * MINUTE });
    h.keepAlive.start();
    h.keepAlive.start();
    await advance(60_000);
    expect(h.calls.ping).toBe(3);
    h.keepAlive.stop();
  });

  it("stops when the vault turns out to be locked, without a ping", async () => {
    const h = harness({ isLocked: false, lockAt: T0 + 35 * MINUTE });
    h.keepAlive.start();
    await advance(20_000);
    expect(h.calls.ping).toBe(1);

    h.setState({ isLocked: true });
    await advance(20_000);
    expect(h.calls.ping).toBe(1);
    expect(h.keepAlive.isRunning).toBe(false);
    await advance(5 * MINUTE);
    expect(h.calls.ping).toBe(1);
  });

  it("never pings after the deadline: it checks at the deadline itself, not at the next tick", async () => {
    // 35 minutes is not a multiple of 20 seconds from an arbitrary start; the
    // last interval is shortened so the check lands on the deadline.
    const lockAt = T0 + 50_000;
    const h = harness({ isLocked: false, lockAt });
    h.keepAlive.start();

    await advance(20_000);
    await advance(20_000);
    expect(h.calls.ping).toBe(2);

    await advance(9_999);
    expect(h.keepAlive.isRunning).toBe(true);
    await advance(1);
    expect(Date.now()).toBe(lockAt);
    expect(h.keepAlive.isRunning).toBe(false);
    expect(h.calls.ping).toBe(2);

    await advance(10 * MINUTE);
    expect(h.calls.ping).toBe(2);
  });

  it("is bounded by the session: a 35 minute deadline ends the pings at 35 minutes", async () => {
    const h = harness({ isLocked: false, lockAt: T0 + 35 * MINUTE });
    h.keepAlive.start();

    await advance(35 * MINUTE - 1);
    expect(h.keepAlive.isRunning).toBe(true);
    await advance(1);
    expect(h.keepAlive.isRunning).toBe(false);

    const pings = h.calls.ping;
    expect(pings).toBeLessThanOrEqual((35 * MINUTE) / 20_000);
    await advance(MINUTE);
    expect(h.calls.ping).toBe(pings);
  });

  it("follows a deadline that activity pushed out", async () => {
    const h = harness({ isLocked: false, lockAt: T0 + MINUTE });
    h.keepAlive.start();
    await advance(40_000);

    h.setState({ isLocked: false, lockAt: Date.now() + 10 * MINUTE });
    await advance(5 * MINUTE);
    expect(h.keepAlive.isRunning).toBe(true);
    h.keepAlive.stop();
  });

  it("refuses a deadline further away than the longest auto-lock the product allows", async () => {
    // A corrupt or tampered record must not buy an unbounded keepalive.
    const tooFar = T0 + (AUTO_LOCK_BOUNDS.max + 1) * MINUTE;
    const h = harness({ isLocked: false, lockAt: tooFar });
    h.keepAlive.start();
    await advance(20_000);
    expect(h.keepAlive.isRunning).toBe(false);
    expect(h.calls.ping).toBe(0);
  });

  it("accepts a deadline exactly at the longest auto-lock", async () => {
    const h = harness({
      isLocked: false,
      lockAt: T0 + AUTO_LOCK_BOUNDS.max * MINUTE,
    });
    h.keepAlive.start();
    await advance(20_000);
    expect(h.keepAlive.isRunning).toBe(true);
    h.keepAlive.stop();
  });

  it("stops on an unlocked report that carries no usable deadline", async () => {
    for (const lockAt of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const h = harness({ isLocked: false, lockAt });
      h.keepAlive.start();
      await advance(20_000);
      expect(h.keepAlive.isRunning, `lockAt ${String(lockAt)}`).toBe(false);
      expect(h.calls.ping).toBe(0);
    }
  });

  it("stops when the lock state cannot be read", async () => {
    const h = harness({ isLocked: false, lockAt: T0 + 35 * MINUTE });
    h.failStateWith(new Error("storage unavailable"));
    h.keepAlive.start();
    await advance(20_000);
    expect(h.keepAlive.isRunning).toBe(false);
    expect(h.calls.ping).toBe(0);
  });

  it("keeps going when a ping fails, because the failure changes nothing it can fix", async () => {
    const h = harness({ isLocked: false, lockAt: T0 + 35 * MINUTE });
    h.failPingsWith(new Error("Extension context invalidated"));
    h.keepAlive.start();
    await advance(60_000);
    expect(h.calls.ping).toBe(3);
    expect(h.keepAlive.isRunning).toBe(true);
    h.keepAlive.stop();
  });

  it("does not ping when stopped while its lock-state check is in flight", async () => {
    let pings = 0;
    let release: (state: State) => void = () => {};
    const keepAlive = new SessionKeepAlive({
      ping: async () => {
        pings++;
      },
      getLockState: () =>
        new Promise<State>((resolve) => {
          release = resolve;
        }),
    });

    keepAlive.start();
    await advance(20_000);
    keepAlive.stop();
    release({ isLocked: false, lockAt: T0 + 35 * MINUTE });
    await advance(5 * MINUTE);

    expect(pings).toBe(0);
    expect(keepAlive.isRunning).toBe(false);
  });

  it("a restart after a stop begins a fresh run", async () => {
    const h = harness({ isLocked: false, lockAt: T0 + 35 * MINUTE });
    h.keepAlive.start();
    await advance(20_000);
    h.keepAlive.stop();
    h.keepAlive.start();
    await advance(20_000);
    expect(h.calls.ping).toBe(2);
    h.keepAlive.stop();
  });

  it("re-checks immediately on refresh, so a shortened timeout is applied now", async () => {
    const h = harness({ isLocked: false, lockAt: T0 + 35 * MINUTE });
    h.keepAlive.start();
    await advance(20_000);
    expect(h.calls.ping).toBe(1);

    h.setState({ isLocked: true });
    h.keepAlive.refresh();
    await advance(0);
    expect(h.keepAlive.isRunning).toBe(false);
    expect(h.calls.ping).toBe(1);
  });

  it("refresh on a stopped keepalive does nothing", async () => {
    const h = harness({ isLocked: false, lockAt: T0 + 35 * MINUTE });
    h.keepAlive.refresh();
    await advance(MINUTE);
    expect(h.calls).toEqual({ ping: 0, state: 0 });
  });
});

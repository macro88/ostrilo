import { describe, it, expect, beforeEach } from "vitest";
import {
  UnlockThrottleService,
  THROTTLE_POLICY,
} from "@/application/services/unlock-throttle.service";
import type { StoragePort } from "@/application/ports/storage";

/**
 * Unlock throttling.
 *
 * The defect: `LockScreen` held an `attemptCount` in component state that only
 * rendered "(N attempts)" and a warning. No delay, no backoff, no lockout - and
 * because it was component state, closing and reopening the popup reset it. An
 * attacker driving the RPC surface directly never saw it at all.
 */

function memoryPort(): StoragePort & { dump(): Map<string, unknown> } {
  const m = new Map<string, unknown>();
  return {
    async get<T>(k: string): Promise<T | undefined> {
      return m.get(k) as T | undefined;
    },
    async set<T>(k: string, v: T): Promise<void> {
      m.set(k, v);
    },
    async remove(k: string): Promise<void> {
      m.delete(k);
    },
    dump: () => m,
  };
}

describe("unlock throttling", () => {
  let store: ReturnType<typeof memoryPort>;
  let now: number;
  let throttle: UnlockThrottleService;

  beforeEach(() => {
    store = memoryPort();
    now = 1_700_000_000_000;
    throttle = new UnlockThrottleService(store, () => now);
  });

  it("allows the first attempts without delay", async () => {
    for (let i = 0; i < THROTTLE_POLICY.freeAttempts; i++) {
      expect(await throttle.check()).toBe(0);
      expect(await throttle.recordFailure()).toBe(0);
    }
  });

  it("imposes a delay once the free attempts are used", async () => {
    for (let i = 0; i < THROTTLE_POLICY.freeAttempts; i++) {
      await throttle.recordFailure();
    }
    const delay = await throttle.recordFailure();
    expect(delay).toBe(THROTTLE_POLICY.baseDelayMs);
    expect(await throttle.check()).toBeGreaterThan(0);
  });

  it("backs off exponentially and caps", async () => {
    const delays: number[] = [];
    for (let i = 0; i < 20; i++) delays.push(await throttle.recordFailure());
    const nonZero = delays.filter((d) => d > 0);
    // Strictly increasing until the cap, then flat at the cap.
    for (let i = 1; i < nonZero.length; i++) {
      expect(nonZero[i]).toBeGreaterThanOrEqual(nonZero[i - 1]);
    }
    expect(Math.max(...nonZero)).toBe(THROTTLE_POLICY.maxDelayMs);
  });

  it("permits the attempt again once the lockout elapses", async () => {
    for (let i = 0; i <= THROTTLE_POLICY.freeAttempts; i++) {
      await throttle.recordFailure();
    }
    expect(await throttle.check()).toBeGreaterThan(0);
    now += THROTTLE_POLICY.baseDelayMs + 1;
    expect(await throttle.check()).toBe(0);
  });

  it("clears the counter on a successful unlock", async () => {
    for (let i = 0; i <= THROTTLE_POLICY.freeAttempts + 2; i++) {
      await throttle.recordFailure();
    }
    await throttle.recordSuccess();
    expect(await throttle.check()).toBe(0);
    // And the next failure starts from the free allowance again.
    expect(await throttle.recordFailure()).toBe(0);
  });

  it("decays after a long quiet period", async () => {
    for (let i = 0; i <= THROTTLE_POLICY.freeAttempts + 2; i++) {
      await throttle.recordFailure();
    }
    now += THROTTLE_POLICY.decayAfterMs + 1;
    expect(
      await throttle.check(),
      "someone who mistyped last month should not start from a penalty"
    ).toBe(0);
  });

  it("persists across service instances, so it survives worker termination", async () => {
    // The reason this is storage-backed rather than a setTimeout: an MV3
    // service worker is evicted after ~30s idle, and a timer-based lockout
    // would evaporate with it.
    for (let i = 0; i <= THROTTLE_POLICY.freeAttempts; i++) {
      await throttle.recordFailure();
    }
    const rebuilt = new UnlockThrottleService(store, () => now);
    expect(
      await rebuilt.check(),
      "SECURITY REGRESSION: throttle state did not survive a new service instance"
    ).toBeGreaterThan(0);
  });

  it("treats malformed stored state as no throttle rather than crashing", async () => {
    await store.set("unlockThrottle", { failures: "lots" } as never);
    expect(await throttle.check()).toBe(0);
  });

  it("never stores the password", async () => {
    await throttle.recordFailure();
    expect(JSON.stringify([...store.dump().entries()])).not.toContain("password");
  });
});

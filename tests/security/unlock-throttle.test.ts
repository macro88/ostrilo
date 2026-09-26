import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import {
  UnlockThrottleService,
  THROTTLE_POLICY,
} from "@/application/services/unlock-throttle.service";
import type { StoragePort, StorageSuite } from "@/application/ports/storage";
import { VaultRpcHandler } from "@/infrastructure/messaging/handlers/vault-rpc";
import { PolicyRpcHandler } from "@/infrastructure/messaging/handlers/policy-rpc";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { RpcModule, ServiceContext } from "@/infrastructure/messaging/rpc-router";
import { fastKdf } from "../helpers/vault";
import {
  SECRET_ONE,
  SECRET_TWO,
  STRONG_PASSWORD,
  errorCodeOf,
  realContext,
} from "../unit/infrastructure/messaging-fixture";

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

/**
 * The throttle used to guard `vault.unlock` alone. Re-authentication, reveal,
 * and generate / import against an existing vault verified the same password
 * with no backoff, and three of those are reachable while locked - so the
 * lockout bounded guessing only on the path nobody needed to use. These drive
 * the real handlers over the real throttle and vault.
 */
describe("every master-password check shares the throttle", () => {
  const WRONG = "Wrong-Guess-Entirely-99";
  let context: ServiceContext;
  let vaultRpc: VaultRpcHandler;
  let policyRpc: PolicyRpcHandler;
  let throttleStore: StorageSuite["local"];

  const send = (handler: RpcModule, message: Record<string, unknown>) =>
    handler.handleRequest(message as never, context);

  async function exhaustFreeAttempts(): Promise<void> {
    for (let i = 0; i <= THROTTLE_POLICY.freeAttempts; i++) {
      await send(vaultRpc, { type: "vault.unlock", password: WRONG });
    }
  }

  async function failures(): Promise<number> {
    return (
      (await throttleStore.get<{ failures: number }>("unlockThrottle"))?.failures ?? 0
    );
  }

  beforeEach(async () => {
    const real = realContext();
    context = real.context;
    throttleStore = real.storage.local;
    vaultRpc = new VaultRpcHandler();
    policyRpc = new PolicyRpcHandler();
    await real.vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await real.vault.unlock(STRONG_PASSWORD);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses re-authentication during a backoff without deriving", async () => {
    await exhaustFreeAttempts();
    const derive = vi.spyOn(fastKdf, "deriveKey");

    const res = await send(policyRpc, {
      type: "policy.setOrigin",
      origin: "https://exchange.example",
      patch: { trustLevel: "high" },
      password: STRONG_PASSWORD,
    });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.RATE_LIMITED);
    expect(JSON.stringify(res)).toMatch(/Try again in \d+ seconds/);
    expect(derive, "a refused attempt must not spend a derivation").not.toHaveBeenCalled();
  });

  it("counts reveal failures toward the lockout that unlock obeys", async () => {
    for (let i = 0; i <= THROTTLE_POLICY.freeAttempts; i++) {
      const res = await send(vaultRpc, { type: "vault.reveal", password: WRONG });
      expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    }

    const unlock = await send(vaultRpc, { type: "vault.unlock", password: STRONG_PASSWORD });
    expect(
      errorCodeOf(unlock),
      "SECURITY REGRESSION: reveal handed out guesses the unlock throttle never saw"
    ).toBe(RPC_ERROR_CODES.RATE_LIMITED);
  });

  it("throttles import into an existing vault and stores nothing", async () => {
    await exhaustFreeAttempts();
    const before = await context.vault.listKeys();

    const res = await send(vaultRpc, {
      type: "vault.import",
      keyInput: SECRET_TWO,
      password: STRONG_PASSWORD,
    });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.RATE_LIMITED);
    expect(await context.vault.listKeys()).toEqual(before);
  });

  it("throttles generate against an existing vault", async () => {
    await exhaustFreeAttempts();
    const res = await send(vaultRpc, { type: "vault.generate", password: STRONG_PASSWORD });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.RATE_LIMITED);
  });

  it("charges a wrong password on import into an existing vault", async () => {
    const res = await send(vaultRpc, {
      type: "vault.import",
      keyInput: SECRET_TWO,
      password: WRONG,
    });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(await failures()).toBe(1);
  });

  it("does not charge creating the first vault", async () => {
    const fresh = realContext();
    context = fresh.context;
    throttleStore = fresh.storage.local;

    const res = await send(vaultRpc, { type: "vault.generate", password: STRONG_PASSWORD });

    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await failures()).toBe(0);
  });

  it("resets the count when re-authentication succeeds", async () => {
    await send(vaultRpc, { type: "vault.unlock", password: WRONG });
    await send(vaultRpc, { type: "vault.reveal", password: WRONG });
    expect(await failures()).toBe(2);

    const res = await send(policyRpc, {
      type: "policy.setKindRule",
      origin: "https://exchange.example",
      kind: 1,
      mode: "allow",
      password: STRONG_PASSWORD,
    });

    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await failures()).toBe(0);
  });
});

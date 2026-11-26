import { beforeEach, describe, expect, it } from "vitest";
import { THROTTLE_POLICY } from "@/application/services/unlock-throttle.service";
import type { BiometricFactor } from "@/domain/types";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { VaultRpcHandler } from "@/infrastructure/messaging/handlers/vault-rpc";
import type { RpcRequest, RpcResponse } from "@/infrastructure/messaging/rpc";
import { isLockedReachable } from "@/infrastructure/messaging/rpc-router";
import {
  SECRET_ONE,
  STRONG_PASSWORD,
  dataOf,
  errorCodeOf,
  realContext,
} from "../unit/infrastructure/messaging-fixture";

/**
 * The biometric methods at the RPC boundary: what a refusal is allowed to say,
 * and what the shared unlock throttle is charged for.
 */

const FACTOR: BiometricFactor = {
  credentialId: Array.from({ length: 16 }, (_, i) => i + 1),
  prfSalt: new Array(32).fill(9),
  transports: ["internal"],
  backupEligible: true,
};
const OUTPUT = new Array(32).fill(0x5a);
const WRONG_OUTPUT = new Array(32).fill(0x5b);

type Fixture = ReturnType<typeof realContext>;

function send(fixture: Fixture, message: RpcRequest): Promise<RpcResponse> {
  return new VaultRpcHandler().handleRequest(message, fixture.context);
}

const unlockWith = (fixture: Fixture, prfOutput: number[], credentialId = FACTOR.credentialId) =>
  send(fixture, { type: "vault.biometricUnlock", credentialId, prfOutput });

async function enrolled(): Promise<Fixture> {
  const fixture = realContext(undefined, { biometric: true });
  await fixture.vault.importKey(SECRET_ONE, STRONG_PASSWORD);
  await fixture.vault.unlock(STRONG_PASSWORD);
  const res = await send(fixture, {
    type: "vault.biometricEnroll",
    password: STRONG_PASSWORD,
    factor: FACTOR,
    prfOutput: OUTPUT,
  });
  expect(res.ok).toBe(true);
  await fixture.vault.lock();
  return fixture;
}

const failures = async (fixture: Fixture) =>
  (await fixture.storage.local.get<{ failures?: number }>("unlockThrottle"))?.failures ?? 0;

describe("biometric RPC methods", () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await enrolled();
  });

  it("unlocks and returns a verdict, never key material", async () => {
    const res = await unlockWith(fixture, OUTPUT);
    const data = dataOf<Record<string, unknown>>(res);

    expect(Object.keys(data).sort()).toEqual(["damagedKeyIds", "selectedKeyId", "unlockedKeyIds"]);
    expect(JSON.stringify(res)).not.toContain(SECRET_ONE);
    expect((await fixture.vault.getLockState()).authFactor).toBe("biometric");
  });

  it("gives the ceremony the credential id and salt while locked", async () => {
    const data = dataOf<Record<string, unknown>>(
      await send(fixture, { type: "vault.biometricUnlockRequest" })
    );
    expect(data).toEqual({
      credentialId: FACTOR.credentialId,
      prfSalt: FACTOR.prfSalt,
      transports: FACTOR.transports,
    });
  });

  it("classifies enrolment as needing an unlocked vault and the rest as reachable while locked", () => {
    expect(isLockedReachable("vault.biometricEnroll")).toBe(false);
    for (const method of ["Status", "UnlockRequest", "Unlock", "Forget"]) {
      expect(isLockedReachable(`vault.biometric${method}`)).toBe(true);
    }
  });

  describe("a refusal is not an oracle", () => {
    it("is identical whether or not a factor is enrolled", async () => {
      const bare = realContext(undefined, { biometric: true });
      await bare.vault.importKey(SECRET_ONE, STRONG_PASSWORD);

      const withFactor = await unlockWith(fixture, WRONG_OUTPUT);
      const withoutFactor = await unlockWith(bare, WRONG_OUTPUT);

      expect(errorCodeOf(withFactor)).toBe(RPC_ERROR_CODES.BIOMETRIC_REJECTED);
      expect(withoutFactor).toEqual(withFactor);
    });

    it("is identical for every cause", async () => {
      const wrongOutput = await unlockWith(fixture, WRONG_OUTPUT);

      const wrongCredential = await unlockWith(fixture, OUTPUT, [9, 9, 9]);
      const malformed = await unlockWith(fixture, [1, 2, 3]);
      await fixture.storage.session.remove("passwordUnlockedThisSession");
      const passwordNeeded = await unlockWith(fixture, OUTPUT);
      const requestRefused = await send(fixture, { type: "vault.biometricUnlockRequest" });

      for (const res of [wrongCredential, malformed, passwordNeeded]) {
        expect(res).toEqual(wrongOutput);
      }
      expect(errorCodeOf(requestRefused)).toBe(RPC_ERROR_CODES.BIOMETRIC_REJECTED);
      expect(JSON.stringify(wrongOutput)).not.toMatch(/credential|factor|salt|verifier/i);
    });

    it("reports a wrong enrolment password as a wrong password", async () => {
      await fixture.vault.unlock(STRONG_PASSWORD);
      const res = await send(fixture, {
        type: "vault.biometricEnroll",
        password: "not-the-password",
        factor: FACTOR,
        prfOutput: OUTPUT,
      });
      expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    });

    it("refuses an enrolment that reports anything beyond the credential", async () => {
      await fixture.vault.unlock(STRONG_PASSWORD);
      const res = await send(fixture, {
        type: "vault.biometricEnroll",
        password: STRONG_PASSWORD,
        factor: { ...FACTOR, userVerified: true } as BiometricFactor,
        prfOutput: OUTPUT,
      });
      expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.BIOMETRIC_REJECTED);
    });
  });

  describe("the status method", () => {
    it("is the one place enrolment and the reason for a password are disclosed", async () => {
      await fixture.storage.session.remove("passwordUnlockedThisSession");
      const status = dataOf<Record<string, unknown>>(
        await send(fixture, { type: "vault.biometricStatus" })
      );
      expect(status).toMatchObject({ enrolled: true, passwordNeeded: "restart_pending" });
      expect(status).not.toHaveProperty("credentialId");
      expect(status).not.toHaveProperty("synced");
    });

    it("answers unavailable on a build without the feature, and names nothing", async () => {
      const without = realContext();
      const res = await send(without, { type: "vault.biometricStatus" });
      expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.BIOMETRIC_UNAVAILABLE);
      expect(JSON.stringify(res)).not.toMatch(/authenticator|credential|transport|firefox/i);
    });

    it("refuses an unlock on a build without the feature with the ordinary refusal", async () => {
      const without = realContext();
      expect(errorCodeOf(await unlockWith(without, OUTPUT))).toBe(
        RPC_ERROR_CODES.BIOMETRIC_REJECTED
      );
    });
  });

  describe("the shared unlock throttle", () => {
    it("charges an output that does not open the wrapping", async () => {
      await unlockWith(fixture, WRONG_OUTPUT);
      await unlockWith(fixture, WRONG_OUTPUT);
      expect(await failures(fixture)).toBe(2);
    });

    it("charges nothing for a refusal that tested nothing", async () => {
      await unlockWith(fixture, OUTPUT, [9, 9, 9]);
      await unlockWith(fixture, [1, 2, 3]);
      await fixture.storage.session.remove("passwordUnlockedThisSession");
      await unlockWith(fixture, OUTPUT);
      await send(fixture, { type: "vault.biometricUnlockRequest" });
      expect(await failures(fixture)).toBe(0);
    });

    it("refuses the biometric path while password failures have it paused", async () => {
      for (let i = 0; i <= THROTTLE_POLICY.freeAttempts; i++) {
        await send(fixture, { type: "vault.unlock", password: "not-the-password" });
      }
      const res = await unlockWith(fixture, OUTPUT);
      expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.RATE_LIMITED);
      expect((await fixture.vault.getLockState()).isLocked).toBe(true);
    });

    it("pauses the password path after biometric failures", async () => {
      for (let i = 0; i <= THROTTLE_POLICY.freeAttempts; i++) {
        await unlockWith(fixture, WRONG_OUTPUT);
      }
      const res = await send(fixture, { type: "vault.unlock", password: STRONG_PASSWORD });
      expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.RATE_LIMITED);
    });

    it("is cleared by a successful biometric unlock", async () => {
      await unlockWith(fixture, WRONG_OUTPUT);
      expect(await failures(fixture)).toBe(1);
      await unlockWith(fixture, OUTPUT);
      expect(await failures(fixture)).toBe(0);
    });

    it("is untouched by forgetting or enrolling a factor", async () => {
      await unlockWith(fixture, WRONG_OUTPUT);
      await send(fixture, { type: "vault.biometricForget" });
      expect(await failures(fixture)).toBe(1);
      expect(dataOf(await send(fixture, { type: "vault.biometricStatus" }))).toEqual({
        enrolled: false,
      });
    });
  });
});

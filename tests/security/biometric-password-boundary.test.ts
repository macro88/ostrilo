import { beforeEach, describe, expect, it } from "vitest";
import type { BiometricFactor } from "@/domain/types";
import { PolicyRpcHandler } from "@/infrastructure/messaging/handlers/policy-rpc";
import { SettingsRpcHandler } from "@/infrastructure/messaging/handlers/settings-rpc";
import { VaultRpcHandler } from "@/infrastructure/messaging/handlers/vault-rpc";
import type { RpcModule } from "@/infrastructure/messaging/rpc-router";
import {
  SECRET_ONE,
  SECRET_TWO,
  STRONG_PASSWORD,
  realContext,
} from "../unit/infrastructure/messaging-fixture";

/**
 * A biometric unlock never stands in for the password.
 *
 * Every operation that asks for the master password asks for it in a session
 * opened with the device, exactly as it does in one opened with the password.
 * This drives the handlers, not a dialog: a caller that skips the dialog and
 * sends the message is still refused.
 *
 * WHAT THIS DOES NOT CLAIM. A biometric session is not a reduced-authority
 * session. Lowering a trust level, setting a deny or ask rule, disabling a
 * session grant and removing an origin are not password-gated in EITHER kind of
 * session, and the last block records that so nobody reads this file as
 * proving more than it tests.
 */

const ORIGIN = "https://exchange.example";
const WRONG = "not-the-master-password";
const NEXT_PASSWORD = "Quartz-Meadow-Harbour-91";
const SECRET_SPARE = "0000000000000000000000000000000000000000000000000000000000000003";

const FACTOR: BiometricFactor = {
  credentialId: Array.from({ length: 16 }, (_, i) => i + 1),
  prfSalt: new Array(32).fill(9),
  transports: ["internal"],
  backupEligible: false,
};
const OUTPUT = new Array(32).fill(0x5a);

type Fixture = ReturnType<typeof realContext>;
type Send = (password?: string) => Record<string, unknown>;

const vaultRpc = new VaultRpcHandler();
const policyRpc = new PolicyRpcHandler();
const settingsRpc = new SettingsRpcHandler();

async function biometricSession(): Promise<{
  fixture: Fixture;
  keyId: string;
  spareKeyId: string;
}> {
  const fixture = realContext(undefined, { biometric: true });
  const { id: keyId } = await fixture.vault.importKey(SECRET_ONE, STRONG_PASSWORD);
  const { id: spareKeyId } = await fixture.vault.importKey(SECRET_SPARE, STRONG_PASSWORD);
  await fixture.vault.unlock(STRONG_PASSWORD);
  await fixture.vault.enrollBiometric(
    STRONG_PASSWORD,
    FACTOR,
    Uint8Array.from(OUTPUT) as never
  );
  await fixture.vault.lock();
  await fixture.vault.unlockWithFactor(
    Uint8Array.from(FACTOR.credentialId),
    Uint8Array.from(OUTPUT) as never
  );
  expect((await fixture.vault.getLockState()).authFactor).toBe("biometric");
  return { fixture, keyId, spareKeyId };
}

describe("a biometric session is asked for the password wherever a password session is", () => {
  let fixture: Fixture;
  let keyId: string;
  let spareKeyId: string;

  beforeEach(async () => {
    ({ fixture, keyId, spareKeyId } = await biometricSession());
  });

  const send = (handler: RpcModule, message: Record<string, unknown>) =>
    handler.handleRequest(message as never, fixture.context);

  const gated: Array<[string, RpcModule, () => Send]> = [
    ["vault.reveal", vaultRpc, () => (password) => ({ type: "vault.reveal", keyId, password })],
    [
      "vault.generate",
      vaultRpc,
      () => (password) => ({ type: "vault.generate", password, label: "Second" }),
    ],
    [
      "vault.import",
      vaultRpc,
      () => (password) => ({ type: "vault.import", keyInput: SECRET_TWO, password }),
    ],
    [
      "the auto-lock timeout",
      settingsRpc,
      () => (password) => ({
        type: "settings.update",
        patch: { autoLockMinutes: 30 },
        password,
      }),
    ],
    [
      "the session grant timeout",
      settingsRpc,
      () => (password) => ({
        type: "settings.update",
        patch: { sessionTTLMinutes: 30 },
        password,
      }),
    ],
    [
      "raising an origin to high trust",
      policyRpc,
      () => (password) => ({
        type: "policy.setOrigin",
        origin: ORIGIN,
        patch: { trustLevel: "high" },
        password,
      }),
    ],
    [
      "a per-kind allow rule",
      policyRpc,
      () => (password) => ({
        type: "policy.setKindRule",
        origin: ORIGIN,
        kind: 1,
        mode: "allow",
        password,
      }),
    ],
    [
      "enabling a session grant",
      policyRpc,
      () => (password) => ({
        type: "policy.setSession",
        origin: ORIGIN,
        enabled: true,
        password,
      }),
    ],
    [
      "enrolling a factor",
      vaultRpc,
      () => (password) => ({
        type: "vault.biometricEnroll",
        password,
        factor: FACTOR,
        prfOutput: OUTPUT,
      }),
    ],
    [
      "vault.changePassword",
      vaultRpc,
      () => (password) => ({
        type: "vault.changePassword",
        currentPassword: password,
        newPassword: NEXT_PASSWORD,
      }),
    ],
    [
      "vault.deleteKey",
      vaultRpc,
      () => (password) => ({ type: "vault.deleteKey", id: spareKeyId, password }),
    ],
  ];

  it.each(gated)("%s", async (name, handler, build) => {
    const message = build();

    expect(
      (await send(handler, message())).ok,
      `SECURITY REGRESSION: ${name} ran in a biometric session with no password`
    ).toBe(false);
    expect(
      (await send(handler, message(WRONG))).ok,
      `SECURITY REGRESSION: ${name} ran in a biometric session with a wrong password`
    ).toBe(false);
    expect(
      (await send(handler, message(STRONG_PASSWORD))).ok,
      `${name} must still work with the password`
    ).toBe(true);
  });

  it("is not a reduced-authority session: what needs no password needs none here either", async () => {
    await send(policyRpc, {
      type: "policy.setOrigin",
      origin: ORIGIN,
      patch: { trustLevel: "high" },
      password: STRONG_PASSWORD,
    });

    const ungated: Array<[RpcModule, Record<string, unknown>]> = [
      [policyRpc, { type: "policy.setOrigin", origin: ORIGIN, patch: { trustLevel: "low" } }],
      [policyRpc, { type: "policy.setKindRule", origin: ORIGIN, kind: 1, mode: "deny" }],
      [policyRpc, { type: "policy.setKindRule", origin: ORIGIN, kind: 1, mode: "ask" }],
      [policyRpc, { type: "policy.setSession", origin: ORIGIN, enabled: false }],
      [policyRpc, { type: "policy.removeOrigin", origin: ORIGIN }],
    ];
    for (const [handler, message] of ungated) {
      expect((await send(handler, message)).ok, String(message.type)).toBe(true);
    }
  });
});

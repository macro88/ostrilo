import { beforeEach, describe, expect, it, vi } from "vitest";
import { CeremonyError, type WebAuthnCeremony } from "@/application/ports/webauthn";
import type { SecretBytes } from "@/application/ports/crypto";
import { RPC_ERROR_CODES, createRpcError } from "@/infrastructure/messaging/error-codes";

const biometricUnlockRequest = vi.fn();
const biometricUnlock = vi.fn();

vi.mock("@/infrastructure/messaging/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/infrastructure/messaging/client")>()),
  biometricUnlockRequest: () => biometricUnlockRequest(),
  biometricUnlock: (credentialId: number[], prfOutput: number[]) =>
    biometricUnlock(credentialId, prfOutput),
}));

const { RpcClientError } = await import("@/infrastructure/messaging/client");
const { runUnlockCeremony } = await import(
  "@/ui/features/authentication/lib/unlock-ceremony"
);

const REQUEST = { credentialId: [1, 2, 3], prfSalt: new Array(32).fill(7), transports: ["internal"] };

const refusal = (code: Parameters<typeof createRpcError>[0], details?: string) =>
  new RpcClientError("vault.biometricUnlock", createRpcError(code, { details }));

function ceremonyReturning(output: SecretBytes | CeremonyError): WebAuthnCeremony {
  return {
    probe: async () => true,
    enroll: async () => {
      throw new Error("not used");
    },
    discard: async () => undefined,
    assert: async () => {
      if (output instanceof CeremonyError) throw output;
      return output;
    },
  };
}

const freshOutput = () => new Uint8Array(32).fill(0x5a) as SecretBytes;

describe("runUnlockCeremony", () => {
  beforeEach(() => {
    biometricUnlockRequest.mockReset().mockResolvedValue(REQUEST);
    biometricUnlock.mockReset().mockResolvedValue({});
  });

  it("unlocks, and clears both the buffer and the array it sent", async () => {
    const output = freshOutput();
    let sent: number[] = [];
    biometricUnlock.mockImplementation(async (_id: number[], wire: number[]) => {
      // What crossed the message bus, captured while it was still live.
      expect(wire).toEqual(new Array(32).fill(0x5a));
      sent = wire;
      return {};
    });

    expect(await runUnlockCeremony(ceremonyReturning(output))).toEqual({ kind: "unlocked" });

    expect(output.every((b) => b === 0)).toBe(true);
    expect(sent.every((b) => b === 0)).toBe(true);
    expect(biometricUnlock).toHaveBeenCalledWith(REQUEST.credentialId, sent);
  });

  it("asks for the password without prompting when the background refuses the request", async () => {
    biometricUnlockRequest.mockRejectedValue(refusal(RPC_ERROR_CODES.BIOMETRIC_REJECTED));
    const assert = vi.fn();
    const ceremony = { ...ceremonyReturning(freshOutput()), assert };

    expect(await runUnlockCeremony(ceremony)).toEqual({ kind: "password_needed" });
    expect(assert).not.toHaveBeenCalled();
  });

  it("reports a dismissed prompt as cancelled and sends nothing", async () => {
    const outcome = await runUnlockCeremony(ceremonyReturning(new CeremonyError("cancelled")));
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(biometricUnlock).not.toHaveBeenCalled();
  });

  it("reports an output the vault did not accept as refused, and still clears it", async () => {
    biometricUnlock.mockRejectedValue(refusal(RPC_ERROR_CODES.BIOMETRIC_REJECTED));
    const output = freshOutput();

    expect(await runUnlockCeremony(ceremonyReturning(output))).toEqual({ kind: "refused" });
    expect(output.every((b) => b === 0)).toBe(true);
  });

  it("carries the background's countdown when unlocking is paused", async () => {
    biometricUnlock.mockRejectedValue(
      refusal(RPC_ERROR_CODES.RATE_LIMITED, "Try again in 30 seconds.")
    );
    expect(await runUnlockCeremony(ceremonyReturning(freshOutput()))).toEqual({
      kind: "paused",
      detail: "Try again in 30 seconds.",
    });
  });

  it("reports anything else as a failure to reach the vault", async () => {
    biometricUnlockRequest.mockRejectedValue(new Error("rpc:transport_error"));
    expect(await runUnlockCeremony(ceremonyReturning(freshOutput()))).toEqual({ kind: "failed" });
  });
});

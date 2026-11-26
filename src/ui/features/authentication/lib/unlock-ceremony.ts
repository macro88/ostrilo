import { CeremonyError, type WebAuthnCeremony } from "@/application/ports/webauthn";
import { zeroize } from "@/domain/utils/memory";
import {
  RpcClientError,
  biometricUnlock,
  biometricUnlockRequest,
} from "@/infrastructure/messaging/client";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";

/**
 * How one attempt to unlock with the device ended.
 *
 * `cancelled` is everything the browser reports as "not allowed", which
 * includes a passkey that has been deleted: the two cannot be told apart.
 * `password_needed` is refused before the authenticator is asked. `refused`
 * means the authenticator answered and what it returned did not open the vault.
 */
export type UnlockCeremonyOutcome =
  | { kind: "unlocked" }
  | { kind: "cancelled" }
  | { kind: "password_needed" }
  | { kind: "refused" }
  | { kind: "paused"; detail?: string }
  | { kind: "failed" };

function outcomeOf(error: unknown, asked: boolean): UnlockCeremonyOutcome {
  if (error instanceof CeremonyError) return { kind: "cancelled" };
  if (error instanceof RpcClientError) {
    if (error.errorCode === RPC_ERROR_CODES.RATE_LIMITED) {
      return { kind: "paused", detail: error.rpcError.data.details };
    }
    if (error.errorCode === RPC_ERROR_CODES.BIOMETRIC_REJECTED) {
      return { kind: asked ? "refused" : "password_needed" };
    }
  }
  return { kind: "failed" };
}

/**
 * Runs one unlock: asks the background what to present, asks the
 * authenticator, and sends back what it returned.
 *
 * The output lives in this call's locals and nowhere else - not in component
 * state, a ref, storage or a log - and both the buffer and the array sent over
 * the message bus are cleared before this returns, whatever happened.
 */
export async function runUnlockCeremony(
  ceremony: WebAuthnCeremony
): Promise<UnlockCeremonyOutcome> {
  let asked = false;
  let output: Uint8Array | null = null;
  let wire: number[] | null = null;
  try {
    const request = await biometricUnlockRequest();
    output = await ceremony.assert(request);
    asked = true;
    wire = Array.from(output);
    await biometricUnlock(request.credentialId, wire);
    return { kind: "unlocked" };
  } catch (error) {
    return outcomeOf(error, asked);
  } finally {
    if (output) zeroize(output);
    wire?.fill(0);
  }
}

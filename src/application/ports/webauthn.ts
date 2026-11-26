import type { BiometricFactor } from "@/domain/types";
import type { SecretBytes } from "./crypto";

/**
 * Why a ceremony produced nothing usable.
 *
 * `cancelled` covers everything the browser reports as "not allowed": the user
 * dismissed the prompt, a passkey provider refused, the credential no longer
 * exists, or the prompt timed out. The browser deliberately does not say
 * which, so neither does this.
 *
 * `no_output` means an authenticator answered but returned no usable
 * pseudo-random-function output, so it cannot unlock anything.
 */
export type CeremonyFailure = "cancelled" | "no_output";

export class CeremonyError extends Error {
  constructor(
    readonly failure: CeremonyFailure,
    /** A passkey may have been created and left in the platform's manager. */
    readonly entryMayRemain = false
  ) {
    super(`ceremony_${failure}`);
    this.name = "CeremonyError";
  }
}

export interface EnrolledCredential {
  factor: BiometricFactor;
  /** The caller owns this buffer and MUST zeroize it. */
  prfOutput: SecretBytes;
}

/**
 * The WebAuthn ceremonies behind biometric unlock. They need a visible
 * document, so this port is implemented for extension pages only and is never
 * reachable from the background worker.
 */
export interface WebAuthnCeremony {
  /** Whether this browser can attempt a ceremony at all. Prompts nothing. */
  probe(): Promise<boolean>;
  /**
   * Creates a credential and immediately asserts it, so that what is reported
   * is an output the authenticator actually delivered.
   */
  enroll(prfSalt: Uint8Array<ArrayBuffer>): Promise<EnrolledCredential>;
  /**
   * Tells the browser a credential this extension created is not in use, so a
   * passkey manager that honours the signal can remove it. Best effort.
   */
  discard(credentialId: number[]): Promise<void>;
  /** Returns the output for an enrolled credential. The caller MUST zeroize it. */
  assert(request: {
    credentialId: number[];
    transports: string[];
    prfSalt: number[];
  }): Promise<SecretBytes>;
}

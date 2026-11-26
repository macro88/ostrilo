import type { SecretBytes } from "@/application/ports/crypto";
import {
  CeremonyError,
  type EnrolledCredential,
  type WebAuthnCeremony,
} from "@/application/ports/webauthn";
import { BIOMETRIC_PRF_LENGTH } from "@/domain/types";
import { zeroize } from "@/domain/utils/memory";

const RELYING_PARTY_NAME = "Ostrilo";
const CREDENTIAL_NAME = "Ostrilo vault unlock";

/** ES256 and RS256. Nothing verifies the signature; the list only avoids refusing an authenticator. */
const ACCEPTED_ALGORITHMS = [-7, -257];

/** Authenticator data is a 32-byte RP ID hash, then one flags byte. */
const FLAGS_OFFSET = 32;
const FLAG_BACKUP_ELIGIBLE = 0x08;

/**
 * Random bytes that nothing checks. WebAuthn requires a challenge, but the
 * background does not verify the assertion: the only evidence of a ceremony is
 * that its PRF output opens the vault. This is not a replay defence and must
 * not be mistaken for one.
 */
function uncheckedChallenge(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
 * Reads the backup-eligible bit: one bounds-checked byte, not a parser. No
 * other field of the authenticator data is read anywhere.
 */
function readBackupEligible(authenticatorData: ArrayBuffer): boolean {
  const data = new Uint8Array(authenticatorData);
  if (data.byteLength <= FLAGS_OFFSET) throw new CeremonyError("no_output", true);
  return (data[FLAGS_OFFSET] & FLAG_BACKUP_ELIGIBLE) !== 0;
}

/**
 * Copies the output into a buffer the caller owns, then clears the view the
 * browser handed over so this module leaves no second copy behind.
 */
function takePrfOutput(credential: PublicKeyCredential): SecretBytes {
  const first = credential.getClientExtensionResults().prf?.results?.first;
  if (!first) throw new CeremonyError("no_output");
  const view = ArrayBuffer.isView(first)
    ? new Uint8Array(first.buffer, first.byteOffset, first.byteLength)
    : new Uint8Array(first);
  try {
    if (view.byteLength !== BIOMETRIC_PRF_LENGTH) throw new CeremonyError("no_output");
    return Uint8Array.from(view) as SecretBytes;
  } finally {
    zeroize(view);
  }
}

/** Runs a browser ceremony, reporting every refusal the one way the browser does. */
async function publicKeyCredential(
  ceremony: () => Promise<Credential | null>
): Promise<PublicKeyCredential> {
  let credential: Credential | null;
  try {
    credential = await ceremony();
  } catch {
    throw new CeremonyError("cancelled");
  }
  if (!(credential instanceof PublicKeyCredential)) throw new CeremonyError("cancelled");
  return credential;
}

/**
 * Tells the browser a credential it just created is not in use, so a passkey
 * manager that supports the signal can remove it. Best effort: not every
 * provider honours it, which is why the caller is still told an entry may
 * remain.
 */
async function signalUnused(credentialId: Uint8Array): Promise<void> {
  const signal = PublicKeyCredential.signalUnknownCredential;
  if (typeof signal !== "function") return;
  await signal
    .call(PublicKeyCredential, {
      rpId: location.origin,
      credentialId: toBase64Url(credentialId),
    })
    .catch((error: unknown) => {
      console.warn("[WebAuthn] could not signal an unused credential:", error);
    });
}

/**
 * The only module that touches `navigator.credentials`.
 *
 * The relying-party id is omitted everywhere, so the browser scopes the
 * credential to this extension's own origin. User verification is required on
 * every ceremony, and PRF evaluation is only ever requested for the one
 * enrolled credential.
 */
export const BrowserWebAuthnCeremony: WebAuthnCeremony = {
  async probe(): Promise<boolean> {
    if (typeof PublicKeyCredential === "undefined" || !navigator.credentials) {
      return false;
    }
    try {
      const capabilities = await PublicKeyCredential.getClientCapabilities?.();
      if (capabilities?.["extension:prf"] === false) return false;
      return (
        capabilities?.["extension:prf"] === true ||
        (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
      );
    } catch (error) {
      console.warn("[WebAuthn] capability check failed:", error);
      return false;
    }
  },

  async enroll(prfSalt: Uint8Array<ArrayBuffer>): Promise<EnrolledCredential> {
    const created = await publicKeyCredential(() =>
      navigator.credentials.create({
        publicKey: {
          rp: { name: RELYING_PARTY_NAME },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: CREDENTIAL_NAME,
            displayName: CREDENTIAL_NAME,
          },
          challenge: uncheckedChallenge(),
          pubKeyCredParams: ACCEPTED_ALGORITHMS.map((alg) => ({
            type: "public-key",
            alg,
          })),
          attestation: "none",
          authenticatorSelection: {
            userVerification: "required",
            residentKey: "discouraged",
          },
          extensions: { prf: {} },
        },
      })
    );

    const credentialId = new Uint8Array(created.rawId);
    const response = created.response as AuthenticatorAttestationResponse;
    const request = {
      credentialId: Array.from(credentialId),
      transports: response.getTransports(),
      prfSalt: Array.from(prfSalt),
    };
    try {
      const backupEligible = readBackupEligible(response.getAuthenticatorData());
      // `prf.enabled` at creation is a claim, not a delivery. Only an output
      // the authenticator actually returns counts.
      const prfOutput = await this.assert(request);
      return { factor: { ...request, backupEligible }, prfOutput };
    } catch (error) {
      await signalUnused(credentialId);
      throw new CeremonyError(
        error instanceof CeremonyError ? error.failure : "no_output",
        true
      );
    }
  },

  async discard(credentialId: number[]): Promise<void> {
    await signalUnused(Uint8Array.from(credentialId));
  },

  async assert(request): Promise<SecretBytes> {
    const assertion = await publicKeyCredential(() =>
      navigator.credentials.get({
        publicKey: {
          challenge: uncheckedChallenge(),
          allowCredentials: [
            {
              type: "public-key",
              id: Uint8Array.from(request.credentialId),
              transports: request.transports as AuthenticatorTransport[],
            },
          ],
          userVerification: "required",
          extensions: { prf: { eval: { first: Uint8Array.from(request.prfSalt) } } },
        },
      })
    );
    return takePrfOutput(assertion);
  },
};

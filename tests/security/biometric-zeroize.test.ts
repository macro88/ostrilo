import { describe, expect, it } from "vitest";
import type { CryptoAead, SecretBytes } from "@/application/ports/crypto";
import type { BiometricFactor } from "@/domain/types";
import { WebCryptoAesGcm } from "@/infrastructure/crypto/adapters";
import { memoryStorage, testBiometricVault } from "../helpers/vault";

/**
 * The PRF output and any KEK recovered from it are cleared after use, on
 * success and on every refusal.
 *
 * Asserted by reading the bytes back, never by spying on `zeroize`: a spy is
 * satisfied by a call that clears nothing. The test keeps the same buffers the
 * production code holds - the output it hands in, and the buffers the AEAD
 * port returns and receives - and looks at them afterwards.
 *
 * What this cannot reach is stated in `memory-zeroization.test.ts` and applies
 * here unchanged: the wrapping key is a `CryptoKey` and is never a buffer.
 */

const PASSWORD = "Harbour-Lantern-Quartz-58";
const SECRET = "0000000000000000000000000000000000000000000000000000000000000001";
const KEK_LENGTH = 32;

const FACTOR: BiometricFactor = {
  credentialId: Array.from({ length: 16 }, (_, i) => i + 1),
  prfSalt: new Array(32).fill(9),
  transports: ["internal"],
  backupEligible: false,
};

const prf = (fill = 0x5a) => new Uint8Array(32).fill(fill) as SecretBytes;
const isZero = (buf: Uint8Array) => buf.every((b) => b === 0);

/** The real AEAD, remembering every raw key it imports and every plaintext it returns. */
function recordingAead() {
  const importedKeys: Uint8Array[] = [];
  const plaintexts: Uint8Array[] = [];
  const aead: CryptoAead = {
    async importKey(raw, usages) {
      importedKeys.push(raw);
      return WebCryptoAesGcm.importKey(raw, usages);
    },
    encrypt: WebCryptoAesGcm.encrypt,
    async decrypt(key, iv, data, aad) {
      const out = await WebCryptoAesGcm.decrypt(key, iv, data, aad);
      plaintexts.push(out);
      return out;
    },
  };
  return {
    aead,
    importedKeys,
    plaintexts,
    reset() {
      importedKeys.length = 0;
      plaintexts.length = 0;
    },
  };
}

async function enrolled() {
  const recorder = recordingAead();
  const storage = memoryStorage();
  const { vault } = testBiometricVault(storage, { aead: recorder.aead });
  await vault.importKey(SECRET, PASSWORD);
  await vault.unlock(PASSWORD);
  await vault.enrollBiometric(PASSWORD, FACTOR, prf());
  await vault.lock();
  recorder.reset();
  return { vault, storage, recorder };
}

describe("biometric unlock clears what it held", () => {
  it("clears the output and the recovered key after a successful unlock", async () => {
    const { vault, recorder } = await enrolled();
    const output = prf();

    await vault.unlockWithFactor(Uint8Array.from(FACTOR.credentialId), output);

    expect(isZero(output)).toBe(true);
    // The first plaintext is the KEK recovered from the wrapping. It is the
    // same buffer the vault then imports to open the verifier and the records.
    const recovered = recorder.plaintexts[0];
    expect(recovered.byteLength).toBe(KEK_LENGTH);
    expect(recorder.importedKeys).toContain(recovered);
    expect(isZero(recovered)).toBe(true);
  });

  it("clears the output when the wrapping does not open", async () => {
    const { vault, recorder } = await enrolled();
    const output = prf(0x5b);

    await expect(
      vault.unlockWithFactor(Uint8Array.from(FACTOR.credentialId), output)
    ).rejects.toThrow();

    expect(isZero(output)).toBe(true);
    expect(recorder.plaintexts).toHaveLength(0);
  });

  it("clears a recovered key that fails the envelope verifier", async () => {
    const { vault, storage, recorder } = await enrolled();
    const other = testBiometricVault(storage, { aead: WebCryptoAesGcm });
    const envelope = await storage.local.get("vaultEnvelope");
    await other.biometric.enroll(
      new Uint8Array(KEK_LENGTH).fill(0x77) as SecretBytes,
      envelope as never,
      FACTOR,
      prf(0x11)
    );
    const output = prf(0x11);

    await expect(
      vault.unlockWithFactor(Uint8Array.from(FACTOR.credentialId), output)
    ).rejects.toThrow();

    expect(isZero(output)).toBe(true);
    const recovered = recorder.plaintexts[0];
    expect(recovered.byteLength).toBe(KEK_LENGTH);
    expect(isZero(recovered)).toBe(true);
  });

  it("clears the output when the vault needs the password instead", async () => {
    const { vault, storage } = await enrolled();
    await storage.session.remove("passwordUnlockedThisSession");
    const output = prf();

    await expect(
      vault.unlockWithFactor(Uint8Array.from(FACTOR.credentialId), output)
    ).rejects.toThrow();

    expect(isZero(output)).toBe(true);
  });

  it("clears the output and the live key after enrolment", async () => {
    const recorder = recordingAead();
    const { vault } = testBiometricVault(memoryStorage(), { aead: recorder.aead });
    await vault.importKey(SECRET, PASSWORD);
    await vault.unlock(PASSWORD);
    recorder.reset();
    const output = prf();

    await vault.enrollBiometric(PASSWORD, FACTOR, output);

    expect(isZero(output)).toBe(true);
    // The password-derived KEK is imported once to open the verifier, and the
    // enrolment's own round trip returns a second copy of it.
    expect(recorder.importedKeys.every(isZero)).toBe(true);
    const roundTripped = recorder.plaintexts.filter((p) => p.byteLength === KEK_LENGTH);
    expect(roundTripped.length).toBeGreaterThan(0);
    expect(roundTripped.every(isZero)).toBe(true);
  });

  it("clears the output when enrolment is refused", async () => {
    const { vault } = await enrolled();
    const output = prf(0x44);

    await expect(vault.enrollBiometric("not-the-password", FACTOR, output)).rejects.toThrow();

    expect(isZero(output)).toBe(true);
  });
});

import { schnorr } from "@noble/curves/secp256k1.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type {
  CryptoAead,
  CryptoKdf,
  Schnorr,
  SecretBytes,
} from "@/application/ports/crypto";
import type { KdfParams } from "@/domain/types";

/**
 * NOTE ON IMPORTS: everything here is statically imported on purpose.
 * `import()` is disallowed on `ServiceWorkerGlobalScope` by the HTML
 * specification, and this module runs in the MV3 background worker, so a lazy
 * import of the KDF would throw at runtime.
 *
 * WebCrypto accepts any BufferSource, so the caller's own `Uint8Array` views
 * are passed straight through.
 *
 * There used to be a `toArrayBuffer()` helper here that copied every argument
 * into a fresh `ArrayBuffer` first. That produced three unzeroized clones of
 * secret material per operation - the raw AES key on import, the IV, and the
 * plaintext on encrypt/decrypt - none of which any caller could reach in order
 * to clear them. Removing it means the buffer handed to `crypto.subtle` is the
 * same object the caller already zeroizes, which both reduces the number of
 * copies and makes the property testable: see
 * tests/security/memory-zeroization.test.ts.
 *
 * What this still cannot control: `crypto.subtle.importKey` copies the key
 * bytes into an opaque `CryptoKey`. That copy is not reachable or clearable
 * from script, and this code does not pretend otherwise.
 */
export const WebCryptoAesGcm: CryptoAead = {
  async importKey(
    raw: SecretBytes,
    usages: ("encrypt" | "decrypt")[]
  ): Promise<CryptoKey> {
    return await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM" },
      false,
      usages
    );
  },
  async encrypt(
    key: CryptoKey,
    iv: SecretBytes,
    data: SecretBytes,
    aad: SecretBytes
  ): Promise<SecretBytes> {
    const buf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad },
      key,
      data
    );
    return new Uint8Array(buf);
  },
  async decrypt(
    key: CryptoKey,
    iv: SecretBytes,
    data: SecretBytes,
    aad: SecretBytes
  ): Promise<SecretBytes> {
    const buf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad },
      key,
      data
    );
    return new Uint8Array(buf);
  },
};

/**
 * The KDF for all new vault material.
 *
 * Dispatches on the algorithm recorded with the material, never on a code
 * constant, so a record written under different parameters still opens.
 *
 * Argon2id runs through `argon2idAsync` with `asyncTick` set, which yields to
 * the event loop between passes. In an MV3 service worker a synchronous
 * multi-hundred-millisecond derivation blocks the worker's only thread and
 * stalls every other message it is handling.
 *
 * PBKDF2 uses native `crypto.subtle.deriveBits` rather than the pure-JS
 * implementation. Measured in the service worker, native is roughly 4x faster
 * for the same iteration count, which is what makes a 600,000-iteration floor
 * affordable at all.
 */
export const VaultKdf: CryptoKdf = {
  async deriveKey(password: string, params: KdfParams): Promise<SecretBytes> {
    const salt = Uint8Array.from(params.salt);

    if (params.alg === "argon2id") {
      const out = await argon2idAsync(password, salt, {
        m: params.m,
        t: params.t,
        p: params.p,
        dkLen: 32,
        asyncTick: 10,
      });
      return out as SecretBytes;
    }

    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: params.c },
      material,
      256
    );
    return new Uint8Array(bits);
  },
};

/** What unversioned records were written with. Read path only. */
export const LEGACY_PBKDF2_ITERATIONS = 100_000;

/**
 * READ-ONLY legacy derivation, matching exactly what unversioned records were
 * written with: pure-JS PBKDF2-HMAC-SHA256 at 100,000 iterations, no AAD.
 *
 * Do NOT use this to write new material. It exists solely so a vault created
 * before the versioned format can still be opened and migrated. It is
 * deliberately a bare function rather than a `CryptoKdf`, so it cannot be
 * wired into the service as the general-purpose KDF by accident.
 */
export async function deriveLegacyKeyReadOnly(
  password: string,
  salt: Uint8Array
): Promise<SecretBytes> {
  return pbkdf2(sha256, password, salt, {
    c: LEGACY_PBKDF2_ITERATIONS,
    dkLen: 32,
  }) as SecretBytes;
}

export const NobleSchnorr: Schnorr = {
  getPublicKey(sk: Uint8Array): Uint8Array {
    // returns x-only compressed pubkey (33 bytes -> we can slice in callers)
    return schnorr.getPublicKey(sk);
  },
  sign(hash32: Uint8Array, sk: Uint8Array): Uint8Array {
    return schnorr.sign(hash32, sk);
  },
};

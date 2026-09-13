import { schnorr } from "@noble/curves/secp256k1.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type {
  CryptoAead,
  CryptoKdf,
  Schnorr,
  SecretBytes,
} from "@/application/ports/crypto";

/**
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
    data: SecretBytes
  ): Promise<SecretBytes> {
    const buf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );
    return new Uint8Array(buf);
  },
  async decrypt(
    key: CryptoKey,
    iv: SecretBytes,
    data: SecretBytes
  ): Promise<SecretBytes> {
    const buf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );
    return new Uint8Array(buf);
  },
};

export const NoblePbkdf2: CryptoKdf = {
  async deriveKey(password: string, salt: SecretBytes): Promise<SecretBytes> {
    // pbkdf2 allocates its own output buffer; copy the view type across rather
    // than cloning the bytes, so the caller can zeroize what it receives.
    return pbkdf2(sha256, password, salt, {
      c: 100_000,
      dkLen: 32,
    }) as SecretBytes;
  },
};

export const NobleSchnorr: Schnorr = {
  getPublicKey(sk: Uint8Array): Uint8Array {
    // returns x-only compressed pubkey (33 bytes -> we can slice in callers)
    return schnorr.getPublicKey(sk);
  },
  sign(hash32: Uint8Array, sk: Uint8Array): Uint8Array {
    return schnorr.sign(hash32, sk);
  },
};

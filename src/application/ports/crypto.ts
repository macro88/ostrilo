import type { KdfParams } from "@/domain/types";

/**
 * A byte view backed by a plain, non-shared `ArrayBuffer`.
 *
 * WebCrypto's `BufferSource` excludes `SharedArrayBuffer`-backed views, so the
 * AEAD port requires this narrower type. Declaring the constraint here lets the
 * adapter hand the caller's own buffer straight to `crypto.subtle`. The
 * alternative - copying each argument into a fresh `ArrayBuffer` inside the
 * adapter - left three unzeroized clones of secret material per operation that
 * no caller could reach in order to clear them.
 */
export type SecretBytes = Uint8Array<ArrayBuffer>;

export interface CryptoAead {
  importKey(
    raw: SecretBytes,
    usages: ("encrypt" | "decrypt")[]
  ): Promise<CryptoKey>;
  /**
   * `aad` is additional authenticated data: covered by the GCM tag but not
   * encrypted. It binds a ciphertext to the record it belongs to, so a blob
   * cannot be moved between records or have its recorded KDF parameters
   * rewritten without decryption failing. See `src/domain/crypto/aad.ts`.
   */
  encrypt(
    key: CryptoKey,
    iv: SecretBytes,
    data: SecretBytes,
    aad: SecretBytes
  ): Promise<SecretBytes>;
  decrypt(
    key: CryptoKey,
    iv: SecretBytes,
    data: SecretBytes,
    aad: SecretBytes
  ): Promise<SecretBytes>;
}

export interface CryptoKdf {
  /**
   * Derives a key using the parameters recorded with the material being read,
   * never parameters implied by the current code. That is what allows the work
   * factor to be raised later without making existing records unreadable.
   *
   * Returns `SecretBytes` because the derived key is handed straight to
   * `CryptoAead.importKey`, and because callers are expected to zeroize the
   * returned buffer once the key has been imported.
   */
  deriveKey(password: string, params: KdfParams): Promise<SecretBytes>;
}

export interface Schnorr {
  getPublicKey(sk: Uint8Array): Promise<Uint8Array> | Uint8Array;
  sign(hash32: Uint8Array, sk: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

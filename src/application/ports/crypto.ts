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
  /**
   * BIP-340 verification. Synchronous, unlike `sign` and `getPublicKey`,
   * because the relay trust boundary verifies inside a synchronous WebSocket
   * message handler: making it async would let a later frame's callback run
   * before an earlier frame had been accepted or discarded, and the
   * per-subscription event cap is counted in that handler.
   */
  verify(
    signature: Uint8Array,
    hash32: Uint8Array,
    publicKey: Uint8Array
  ): boolean;
}

/**
 * SHA-256, the only hash Nostr event ids use.
 *
 * This port exists so NIP-01 event id computation can live in the
 * application layer without importing `@noble/hashes`. Synchronous because
 * `crypto.subtle.digest` is not, and an async event id would make
 * `verifyParsedRelayEvent` async - see `verify` above.
 */
export interface CryptoHash {
  sha256(data: Uint8Array): Uint8Array;
}

/**
 * bech32 for `npub` and `nsec`.
 *
 * Exists so private-key parsing and public-key display can stop importing
 * `@scure/base` from the domain, application and UI layers. The three direct
 * importers disagreed on the encode length limit - one passed none, one
 * passed 5000 - which is exactly the drift a single port removes.
 */
export interface Bech32Codec {
  encode(prefix: string, bytes: Uint8Array): string;
  decode(encoded: string): { prefix: string; bytes: Uint8Array };
}

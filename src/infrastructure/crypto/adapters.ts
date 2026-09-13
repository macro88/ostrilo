import { schnorr } from "@noble/curves/secp256k1.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bech32 } from "@scure/base";
import {
  computeEventId,
  verifyEventSignature,
} from "@/application/crypto/event-id";
import type {
  Bech32Codec,
  CryptoAead,
  CryptoHash,
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

/**
 * Declared with `satisfies` rather than a type annotation so each method keeps
 * its concrete return type. The port allows `sign` and `getPublicKey` to be
 * async; this adapter's are not, and callers that need a synchronous result -
 * the relay trust boundary - depend on that being visible in the type.
 */
export const NobleSchnorr = {
  getPublicKey(sk: Uint8Array): Uint8Array {
    // x-only, 32 bytes. BIP-340 keys carry no parity byte, which is why
    // nothing downstream slices a prefix off this.
    return schnorr.getPublicKey(sk);
  },
  sign(hash32: Uint8Array, sk: Uint8Array): Uint8Array {
    return schnorr.sign(hash32, sk);
  },
  verify(
    signature: Uint8Array,
    hash32: Uint8Array,
    publicKey: Uint8Array
  ): boolean {
    // Returns false rather than throwing. A malformed signature or a point
    // not on the curve is a failed verification, and every caller is a trust
    // boundary deciding whether to accept untrusted input - not a place that
    // can usefully distinguish 'invalid' from 'wrong'.
    try {
      return schnorr.verify(signature, hash32, publicKey);
    } catch {
      return false;
    }
  },
} satisfies Schnorr;

export const NobleSha256 = {
  sha256(data: Uint8Array): Uint8Array {
    return sha256(data);
  },
} satisfies CryptoHash;

/**
 * The single bech32 length limit.
 *
 * Two implementations disagreed here: `encoding.ts` passed no limit, taking
 * @scure's BIP-173 default of 90, and `crypto.ts` passed 5000. Both produced
 * identical output, because an npub or nsec is 63 characters, so collapsing
 * to one limit changes no value the extension has ever encoded. 90 is the
 * standard bound and the one both decode paths already used; a string longer
 * than that is not a Nostr key.
 */
const BECH32_LIMIT = 90;

export const ScureBech32 = {
  encode(prefix: string, bytes: Uint8Array): string {
    return bech32.encode(prefix, bech32.toWords(bytes), BECH32_LIMIT);
  },
  decode(encoded: string): { prefix: string; bytes: Uint8Array } {
    const { prefix, words } = bech32.decode(
      encoded as `${string}1${string}`,
      BECH32_LIMIT
    );
    return { prefix, bytes: new Uint8Array(bech32.fromWords(words)) };
  },
} satisfies Bech32Codec;


/**
 * The event id and signature operations, bound to the adapters above.
 *
 * `verifyParsedRelayEvent` needs both and must not choose either for itself:
 * a domain module that picked its own hash would be a second event id
 * implementation, which is the defect this change removes. Bound once here,
 * so every relay frame and every test verifies through the same pair.
 */
export const NostrEventCrypto = {
  computeEventId(event: {
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
  }): string {
    return computeEventId(NobleSha256, event);
  },
  verifyEventSignature(
    eventIdHex: string,
    signatureHex: string,
    pubkeyHex: string
  ): boolean {
    return verifyEventSignature(
      NobleSchnorr,
      eventIdHex,
      signatureHex,
      pubkeyHex
    );
  },
};

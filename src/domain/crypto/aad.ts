import type { KdfParams } from "../types";

/**
 * Additional authenticated data for the vault's AES-GCM operations.
 *
 * Without AAD, nothing binds a ciphertext to the record it belongs to. An
 * attacker able to write extension storage could swap ciphertexts between key
 * records, roll recorded KDF parameters back to something cheap, or substitute
 * their own vault entry so the user signs with a key the attacker knows. AES-GCM
 * would decrypt each of those happily, because the bytes are individually valid.
 *
 * Binding the surrounding metadata into the tag makes all of those tamper.
 *
 * Three rules govern this encoder, and the tests enforce each:
 *
 *  1. **Domain separation.** Each use gets its own prefix, so a blob encrypted
 *     as a wrapped DEK can never be accepted where a private key is expected.
 *  2. **Fixed field order, explicit lengths.** Every field is length-prefixed
 *     and concatenated in a fixed order. No JSON: key order and whitespace are
 *     not guaranteed stable across engines or versions, and an AAD that changes
 *     shape makes every existing record undecryptable.
 *  3. **Only immutable, security-relevant fields.** `label`, `isSelected`,
 *     `createdAt` and `lastUsedAt` are deliberately excluded. Renaming a key or
 *     selecting a different one must not require re-encrypting anything.
 */

export const AAD_DOMAIN = {
  verifier: "ostrilo/vault-verifier",
  dek: "ostrilo/vault-dek",
  sk: "ostrilo/vault-sk",
} as const;

export type AadDomain = (typeof AAD_DOMAIN)[keyof typeof AAD_DOMAIN];

const encoder = new TextEncoder();

/** Length-prefixed field: 4-byte big-endian length, then the bytes. */
function field(parts: Uint8Array[], bytes: Uint8Array): void {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, bytes.byteLength, false);
  parts.push(len, bytes);
}

function strField(parts: Uint8Array[], s: string): void {
  field(parts, encoder.encode(s));
}

function numField(parts: Uint8Array[], n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`aad_invalid_number:${n}`);
  }
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), false);
  field(parts, b);
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/**
 * Encodes the KDF parameters, every cost field included.
 *
 * The cost fields are the reason this exists: if `m`, `t`, `p` or `c` were left
 * out, an attacker could rewrite the stored parameters to something trivially
 * cheap and the tag would still verify, defeating the whole point of recording
 * them.
 */
function kdfFields(parts: Uint8Array[], kdf: KdfParams): void {
  strField(parts, kdf.alg);
  if (kdf.alg === "argon2id") {
    numField(parts, kdf.m);
    numField(parts, kdf.t);
    numField(parts, kdf.p);
  } else {
    numField(parts, kdf.c);
  }
  field(parts, Uint8Array.from(kdf.salt));
}

/** AAD for the vault verifier blob. */
export function verifierAad(v: number, kdf: KdfParams): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  strField(parts, AAD_DOMAIN.verifier);
  numField(parts, v);
  kdfFields(parts, kdf);
  return concat(parts);
}

/** AAD for a record's DEK, wrapped under the vault KEK. */
export function dekAad(
  v: number,
  kdf: KdfParams,
  keyId: string,
  pubkey: string
): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  strField(parts, AAD_DOMAIN.dek);
  numField(parts, v);
  kdfFields(parts, kdf);
  strField(parts, keyId);
  strField(parts, pubkey);
  return concat(parts);
}

/**
 * AAD for a private key, encrypted under its DEK.
 *
 * Binding `pubkey` here is what stops an attacker swapping one record's
 * ciphertext into another record: the tag will not verify against the other
 * record's public key.
 */
export function skAad(
  v: number,
  keyId: string,
  pubkey: string
): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  strField(parts, AAD_DOMAIN.sk);
  numField(parts, v);
  strField(parts, keyId);
  strField(parts, pubkey);
  return concat(parts);
}

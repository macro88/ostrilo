import { schnorr } from "@noble/curves/secp256k1";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha2";
import type {
  CryptoAead,
  CryptoKdf,
  Schnorr,
} from "@/src/application/ports/crypto";

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}

export const WebCryptoAesGcm: CryptoAead = {
  async importKey(
    raw: Uint8Array,
    usages: ("encrypt" | "decrypt")[]
  ): Promise<CryptoKey> {
    return await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(raw),
      { name: "AES-GCM" },
      false,
      usages
    );
  },
  async encrypt(
    key: CryptoKey,
    iv: Uint8Array,
    data: Uint8Array
  ): Promise<Uint8Array> {
    const buf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(data)
    );
    return new Uint8Array(buf);
  },
  async decrypt(
    key: CryptoKey,
    iv: Uint8Array,
    data: Uint8Array
  ): Promise<Uint8Array> {
    const buf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(data)
    );
    return new Uint8Array(buf);
  },
};

export const NoblePbkdf2: CryptoKdf = {
  async deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
    return pbkdf2(sha256, password, salt, { c: 100_000, dkLen: 32 });
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

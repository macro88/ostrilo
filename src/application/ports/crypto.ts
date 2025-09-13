export interface CryptoAead {
  importKey(
    raw: Uint8Array,
    usages: ("encrypt" | "decrypt")[]
  ): Promise<CryptoKey>;
  encrypt(
    key: CryptoKey,
    iv: Uint8Array,
    data: Uint8Array
  ): Promise<Uint8Array>;
  decrypt(
    key: CryptoKey,
    iv: Uint8Array,
    data: Uint8Array
  ): Promise<Uint8Array>;
}

export interface CryptoKdf {
  deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array>;
}

export interface Schnorr {
  getPublicKey(sk: Uint8Array): Promise<Uint8Array> | Uint8Array;
  sign(hash32: Uint8Array, sk: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

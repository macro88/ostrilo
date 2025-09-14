/**
 * Cryptographic interfaces for clean architecture separation
 * Defines contracts for crypto operations without implementation details
 */

// Core crypto types
export interface EncryptedKey {
  ct: number[]; // Ciphertext as byte array
  iv: number[]; // Initialization vector
  salt: number[]; // KDF salt
}

export interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

// Crypto service interfaces following SOLID principles

/**
 * AES-GCM encryption/decryption interface
 * Implementations should use WebCrypto API or equivalent
 */
export interface CryptoAead {
  encrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
  decrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
}

/**
 * Key derivation function interface
 * Implementations should use PBKDF2 or Argon2id
 */
export interface CryptoKdf {
  deriveKey(password: Uint8Array, salt: Uint8Array, params?: any): Promise<CryptoKey>;
}

/**
 * Schnorr signature interface for Nostr
 * Implementations should use Noble secp256k1
 */
export interface Schnorr {
  getPublicKey(sk: Uint8Array): Promise<Uint8Array>;
  sign(hash32: Uint8Array, sk: Uint8Array): Promise<Uint8Array>;
  verify(signature: Uint8Array, hash32: Uint8Array, publicKey: Uint8Array): Promise<boolean>;
}

/**
 * High-level crypto service interface
 * Combines all crypto operations needed by the application
 */
export interface CryptoService {
  // Key generation
  generatePrivateKey(): Uint8Array;
  generateKeyPair(): KeyPair;
  
  // Key derivation and encryption
  deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey>;
  encryptPrivateKey(privateKey: Uint8Array, password: string): Promise<EncryptedKey>;
  decryptPrivateKey(encrypted: EncryptedKey, password: string): Promise<Uint8Array>;
  
  // Signing
  signHash(hash: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array>;
  getPublicKey(privateKey: Uint8Array): Uint8Array;
  
  // Utilities
  zeroize(buffer: Uint8Array): void;
}

// Constants that are part of the domain
export const CRYPTO_CONSTANTS = {
  NOSTR_PRIVATE_KEY_PREFIX: "nsec",
  NOSTR_PUBLIC_KEY_PREFIX: "npub",
  KEY_LENGTH: 32, // 32 bytes for secp256k1 private keys
  SALT_LENGTH: 16, // 16 bytes for KDF salt
  IV_LENGTH: 12, // 12 bytes for AES-GCM IV
} as const;

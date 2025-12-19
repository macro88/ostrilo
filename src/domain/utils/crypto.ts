/**
 * Cryptographic utilities for Ostrilo Nostr signer
 * Implements secure key generation, encryption, and signing following best practices
 *
 * Requirements:
 * - NS-N-001: Noble secp256k1 schnorr + SHA-256; WebCrypto AES-GCM; Argon2id
 * - NS-N-002: AES-GCM ciphertext only in storage with random salt+iv
 * - NS-N-003: Overwrite Uint8Array secrets on lock/unload
 */

import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";

// Constants
const NOSTR_PRIVATE_KEY_PREFIX = "nsec";
const NOSTR_PUBLIC_KEY_PREFIX = "npub";
const KEY_LENGTH = 32; // 32 bytes for secp256k1 private keys
const SALT_LENGTH = 16; // 16 bytes for Argon2id salt
const IV_LENGTH = 12; // 12 bytes for AES-GCM IV

// Types
export interface EncryptedKey {
  ct: number[]; // Ciphertext as byte array
  iv: number[]; // Initialization vector
  salt: number[]; // Argon2id salt
}

export interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * Securely zero out a Uint8Array buffer
 * Best effort memory cleanup for JavaScript environment
 */
export function zeroize(buffer: Uint8Array): void {
  if (buffer && buffer.fill) {
    buffer.fill(0);
  }
}

/**
 * Generate cryptographically secure random 32-byte private key
 * Uses Noble's randomBytes which leverages crypto.getRandomValues
 */
export function generatePrivateKey(): Uint8Array {
  return randomBytes(KEY_LENGTH);
}

/**
 * Derive public key from private key using secp256k1
 */
export function getPublicKey(privateKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(privateKey, true); // compressed format
}

/**
 * Generate a new key pair
 */
export function generateKeyPair(): KeyPair {
  const privateKey = generatePrivateKey();
  const publicKey = getPublicKey(privateKey);

  return { privateKey, publicKey };
}

/**
 * Convert private key to bech32 nsec format
 */
export function privateKeyToBech32(privateKey: Uint8Array): string {
  return bech32.encode(NOSTR_PRIVATE_KEY_PREFIX, bech32.toWords(privateKey));
}

/**
 * Convert public key to bech32 npub format
 */
export function publicKeyToBech32(publicKey: Uint8Array): string {
  // Use x-only public key (32 bytes) for Nostr
  const xOnlyPubkey = publicKey.length === 33 ? publicKey.slice(1) : publicKey;
  return bech32.encode(NOSTR_PUBLIC_KEY_PREFIX, bech32.toWords(xOnlyPubkey));
}

/**
 * Convert public key to hex string
 */
export function publicKeyToHex(publicKey: Uint8Array): string {
  // Use x-only public key (32 bytes) for Nostr
  const xOnlyPubkey = publicKey.length === 33 ? publicKey.slice(1) : publicKey;
  return Array.from(xOnlyPubkey)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Parse private key from bech32 nsec format
 */
export function parsePrivateKeyFromBech32(nsec: string): Uint8Array {
  if (!nsec.startsWith(NOSTR_PRIVATE_KEY_PREFIX)) {
    throw new Error("Invalid nsec format: must start with nsec");
  }

  try {
    const decoded = bech32.decode(nsec as `${string}1${string}`);
    const { prefix, words } = decoded;
    if (prefix !== NOSTR_PRIVATE_KEY_PREFIX) {
      throw new Error("Invalid nsec prefix");
    }

    const privateKey = new Uint8Array(bech32.fromWords(words));
    if (privateKey.length !== KEY_LENGTH) {
      throw new Error(
        `Invalid private key length: expected ${KEY_LENGTH}, got ${privateKey.length}`
      );
    }

    return privateKey;
  } catch (error) {
    throw new Error(
      `Failed to parse nsec: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Parse private key from hex string
 */
export function parsePrivateKeyFromHex(hex: string): Uint8Array {
  // Remove 0x prefix if present
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;

  if (cleanHex.length !== KEY_LENGTH * 2) {
    throw new Error(
      `Invalid hex private key length: expected ${
        KEY_LENGTH * 2
      } characters, got ${cleanHex.length}`
    );
  }

  if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
    throw new Error("Invalid hex characters in private key");
  }

  const privateKey = new Uint8Array(KEY_LENGTH);
  for (let i = 0; i < KEY_LENGTH; i++) {
    privateKey[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }

  return privateKey;
}

/**
 * Validate and parse private key from either bech32 or hex format
 */
export function parsePrivateKey(input: string): Uint8Array {
  const trimmed = input.trim();

  if (trimmed.startsWith(NOSTR_PRIVATE_KEY_PREFIX)) {
    return parsePrivateKeyFromBech32(trimmed);
  } else if (trimmed.length === KEY_LENGTH * 2 || trimmed.startsWith("0x")) {
    return parsePrivateKeyFromHex(trimmed);
  } else {
    throw new Error(
      "Invalid private key format: must be nsec bech32 or hex string"
    );
  }
}

/**
 * Derive encryption key from password using PBKDF2
 * Note: Changed from Argon2id to PBKDF2 for browser compatibility
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  try {
    // Use PBKDF2 with SHA-256 and 100,000 iterations for secure password-based key derivation
    const derivedKey = pbkdf2(sha256, password, salt, { c: 100000, dkLen: 32 });
    return derivedKey;
  } catch (error) {
    throw new Error(
      `Key derivation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Encrypt private key using AES-GCM with password-derived key
 */
export async function encryptPrivateKey(
  privateKey: Uint8Array,
  password: string
): Promise<EncryptedKey> {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  try {
    // Derive encryption key from password
    const derivedKey = await deriveKeyFromPassword(password, salt);

    // Create proper ArrayBuffer views for WebCrypto
    const keyBuffer = new Uint8Array(derivedKey);
    const ivBuffer = new Uint8Array(iv);
    const privateKeyBuffer = new Uint8Array(privateKey);

    // Import key for WebCrypto
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBuffer,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );

    // Encrypt the private key
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: ivBuffer,
      },
      cryptoKey,
      privateKeyBuffer
    );

    // Clean up derived key
    zeroize(derivedKey);

    return {
      ct: Array.from(new Uint8Array(ciphertext)),
      iv: Array.from(iv),
      salt: Array.from(salt),
    };
  } catch (error) {
    // Clean up on error
    zeroize(salt);
    zeroize(iv);
    throw new Error(
      `Encryption failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Decrypt private key using AES-GCM with password-derived key
 */
export async function decryptPrivateKey(
  encrypted: EncryptedKey,
  password: string
): Promise<Uint8Array> {
  const salt = new Uint8Array(encrypted.salt);
  const iv = new Uint8Array(encrypted.iv);
  const ciphertext = new Uint8Array(encrypted.ct);

  try {
    // Derive encryption key from password
    const derivedKey = await deriveKeyFromPassword(password, salt);

    // Create proper ArrayBuffer view for WebCrypto
    const keyBuffer = new Uint8Array(derivedKey);

    // Import key for WebCrypto
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBuffer,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    // Decrypt the private key
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      cryptoKey,
      ciphertext
    );

    // Clean up derived key
    zeroize(derivedKey);

    return new Uint8Array(decrypted);
  } catch (error) {
    throw new Error("Decryption failed: Invalid password or corrupted data");
  }
}

/**
 * Sign a message hash using secp256k1 Schnorr signature
 * For Nostr event signing
 */
export function signHash(
  messageHash: Uint8Array,
  privateKey: Uint8Array
): Uint8Array {
  if (messageHash.length !== 32) {
    throw new Error("Message hash must be 32 bytes");
  }

  if (privateKey.length !== KEY_LENGTH) {
    throw new Error(`Private key must be ${KEY_LENGTH} bytes`);
  }

  // Use Schnorr signatures for Nostr
  return schnorr.sign(messageHash, privateKey);
}

/**
 * Create SHA-256 hash of input data
 */
export function createHash(data: Uint8Array): Uint8Array {
  return sha256(data);
}

/**
 * Verify a Schnorr signature
 */
export function verifySignature(
  signature: Uint8Array,
  messageHash: Uint8Array,
  publicKey: Uint8Array
): boolean {
  try {
    const xOnlyPubkey =
      publicKey.length === 33 ? publicKey.slice(1) : publicKey;
    return schnorr.verify(signature, messageHash, xOnlyPubkey);
  } catch {
    return false;
  }
}

/**
 * Check if Web Authentication API is available for biometric authentication
 */
export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "credentials" in navigator &&
    typeof PublicKeyCredential !== "undefined"
  );
}

/**
 * Check if platform authenticator (Windows Hello, TouchID, etc.) is available
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnAvailable()) {
    return false;
  }

  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ============================================
// NIP-01 Event ID Computation
// ============================================

/**
 * Compute NIP-01 event ID from event data
 * ID is SHA-256 hash of the serialized event array:
 * [0, pubkey, created_at, kind, tags, content]
 *
 * @param pubkey - 32-byte lowercase hex public key
 * @param created_at - Unix timestamp in seconds
 * @param kind - Event kind number
 * @param tags - Array of tag arrays
 * @param content - Event content string
 * @returns 32-byte lowercase hex event ID
 */
export function computeEventId(
  pubkey: string,
  created_at: number,
  kind: number,
  tags: string[][],
  content: string
): string {
  // NIP-01 serialization: [0, pubkey, created_at, kind, tags, content]
  const serialized = JSON.stringify([
    0,
    pubkey,
    created_at,
    kind,
    tags,
    content,
  ]);

  // Hash the UTF-8 encoded serialized string
  const encoder = new TextEncoder();
  const data = encoder.encode(serialized);
  const hash = sha256(data);

  // Convert to lowercase hex
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Sign an event hash using Schnorr signature (BIP-340)
 *
 * @param eventIdHex - 32-byte lowercase hex event ID
 * @param privateKey - 32-byte private key
 * @returns 64-byte lowercase hex Schnorr signature
 */
export function signEventHash(
  eventIdHex: string,
  privateKey: Uint8Array
): string {
  // Convert hex event ID to bytes
  const messageBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    messageBytes[i] = parseInt(eventIdHex.substr(i * 2, 2), 16);
  }

  // Sign using Schnorr
  const signature = schnorr.sign(messageBytes, privateKey);

  // Convert to lowercase hex
  return Array.from(signature)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a Schnorr signature on an event
 *
 * @param eventIdHex - 32-byte lowercase hex event ID
 * @param signatureHex - 64-byte lowercase hex Schnorr signature
 * @param pubkeyHex - 32-byte lowercase hex x-only public key
 * @returns true if signature is valid
 */
export function verifyEventSignature(
  eventIdHex: string,
  signatureHex: string,
  pubkeyHex: string
): boolean {
  try {
    // Convert hex strings to bytes
    const message = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      message[i] = parseInt(eventIdHex.substr(i * 2, 2), 16);
    }

    const signature = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      signature[i] = parseInt(signatureHex.substr(i * 2, 2), 16);
    }

    const pubkey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      pubkey[i] = parseInt(pubkeyHex.substr(i * 2, 2), 16);
    }

    return schnorr.verify(signature, message, pubkey);
  } catch {
    return false;
  }
}

/**
 * Convert hex public key to npub (bech32)
 */
export function hexToNpub(hex: string): string {
  try {
    const bytes = new Uint8Array(
      hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );
    const words = bech32.toWords(bytes);
    return bech32.encode(NOSTR_PUBLIC_KEY_PREFIX, words, 5000);
  } catch (e) {
    console.error("Failed to convert hex to npub:", e);
    return hex; // Fallback to hex
  }
}

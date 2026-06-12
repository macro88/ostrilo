/**
 * Pure utility functions for bech32 encoding/decoding
 * Part of domain layer - no side effects or external dependencies
 */

import { bech32 } from "@scure/base";
import { CRYPTO_CONSTANTS } from "../crypto/interfaces";

/**
 * Convert bytes to bech32 encoded string with given prefix
 */
export function bytesToBech32(prefix: string, bytes: Uint8Array): string {
  const words = bech32.toWords(bytes);
  return bech32.encode(prefix, words);
}

/**
 * Decode bech32 string and return bytes
 */
export function bech32ToBytes(encoded: string): { prefix: string; bytes: Uint8Array } {
  const { prefix, words } = bech32.decode(encoded as `${string}1${string}`);
  const bytes = bech32.fromWords(words);
  return { prefix, bytes: new Uint8Array(bytes) };
}

/**
 * Convert public key bytes to npub format
 */
export function publicKeyToBech32(publicKey: Uint8Array): string {
  return bytesToBech32(CRYPTO_CONSTANTS.NOSTR_PUBLIC_KEY_PREFIX, publicKey);
}

/**
 * Convert private key bytes to nsec format
 */
export function privateKeyToBech32(privateKey: Uint8Array): string {
  return bytesToBech32(CRYPTO_CONSTANTS.NOSTR_PRIVATE_KEY_PREFIX, privateKey);
}

/**
 * Parse private key from various formats (hex, nsec, bech32)
 */
export function parsePrivateKey(input: string): Uint8Array {
  const trimmed = input.trim();
  
  // Try bech32 first (nsec format)
  if (trimmed.startsWith(CRYPTO_CONSTANTS.NOSTR_PRIVATE_KEY_PREFIX)) {
    const { bytes } = bech32ToBytes(trimmed);
    if (bytes.length !== CRYPTO_CONSTANTS.KEY_LENGTH) {
      throw new Error(`Invalid private key length: expected ${CRYPTO_CONSTANTS.KEY_LENGTH}, got ${bytes.length}`);
    }
    return bytes;
  }
  
  // Try hex format
  const hexMatch = trimmed.match(/^[0-9a-fA-F]{64}$/);
  if (hexMatch) {
    return hexToBytes(trimmed);
  }
  
  throw new Error("Invalid private key format. Expected hex (64 chars) or nsec bech32.");
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate hex string format
 */
export function isValidHex(hex: string, expectedLength?: number): boolean {
  const hexRegex = /^[0-9a-fA-F]+$/;
  if (!hexRegex.test(hex)) return false;
  if (expectedLength && hex.length !== expectedLength * 2) return false;
  return true;
}

/**
 * Validate bech32 format with expected prefix
 */
export function isValidBech32(encoded: string, expectedPrefix?: string): boolean {
  try {
    const { prefix } = bech32ToBytes(encoded);
    return expectedPrefix ? prefix === expectedPrefix : true;
  } catch {
    return false;
  }
}

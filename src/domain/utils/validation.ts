/**
 * Validation utilities for domain objects
 * Pure functions with no external dependencies
 */

import { CRYPTO_CONSTANTS } from "../crypto/interfaces";

/**
 * Password strength evaluation
 */
export interface PasswordRequirement {
  requirement: string;
  passes: boolean;
}

export interface PasswordStrength {
  score: number; // 0-4
  requirements: PasswordRequirement[];
  meetsMinimum: boolean;
}

/**
 * Evaluate password strength based on security requirements
 */
export function evaluatePasswordStrength(password: string): PasswordStrength {
  const requirements: PasswordRequirement[] = [];
  let score = 0;

  // Length check
  const hasMinLength = password.length >= 8;
  if (hasMinLength) {
    score += 1;
  }
  requirements.push({
    requirement: "At least 8 characters long",
    passes: hasMinLength,
  });

  // Character variety checks
  const hasMixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
  if (hasMixedCase) {
    score += 1;
  }
  requirements.push({
    requirement: "Both uppercase and lowercase letters",
    passes: hasMixedCase,
  });

  const hasNumber = /\d/.test(password);
  if (hasNumber) {
    score += 1;
  }
  requirements.push({
    requirement: "At least one number",
    passes: hasNumber,
  });

  const hasSpecial = /[^a-zA-Z\d]/.test(password);
  if (hasSpecial) {
    score += 1;
  }
  requirements.push({
    requirement: "At least one special character",
    passes: hasSpecial,
  });

  // Bonus for very long passwords
  if (password.length >= 20) {
    score = Math.min(4, score + 1);
  }

  return {
    score,
    requirements,
    meetsMinimum: score >= 3 && password.length >= 8,
  };
}

/**
 * Validate private key format without importing crypto libraries
 */
export function isValidPrivateKeyFormat(input: string): boolean {
  const trimmed = input.trim();

  // Check nsec format (basic validation)
  if (trimmed.startsWith(CRYPTO_CONSTANTS.NOSTR_PRIVATE_KEY_PREFIX)) {
    return trimmed.length > CRYPTO_CONSTANTS.NOSTR_PRIVATE_KEY_PREFIX.length;
  }

  // Check hex format
  return /^[0-9a-fA-F]{64}$/.test(trimmed);
}

/**
 * Validate public key hex format
 */
export function isValidPublicKeyHex(hex: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(hex.trim());
}

/**
 * Validate URL format for relay addresses
 */
export function isValidRelayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "ws:" || parsed.protocol === "wss:";
  } catch {
    return false;
  }
}

/**
 * Validate origin format for policy management
 */
export function isValidOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

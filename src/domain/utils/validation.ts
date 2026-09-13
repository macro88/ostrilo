/**
 * Validation utilities for domain objects
 * Pure functions with no external dependencies
 */

import { CRYPTO_CONSTANTS } from "../crypto/constants";

/**
 * Password strength, re-pointed at the single policy module.
 *
 * `meetsMinimum` is GONE on purpose. It was the one correct predicate in the
 * codebase (`score >= 3 && length >= 8`) and nothing used it: two onboarding
 * flows re-implemented half of it as `strength.score < 3`, which is satisfiable
 * by character variety alone. Removing it turns every caller that reached for a
 * home-grown predicate into a compile error, and the replacement verdict makes
 * the bug unrepresentable - `acceptable` is false unless the blocklist was
 * consulted, so a UI can report violations but can never green-light.
 *
 * See src/domain/utils/password-policy.ts.
 */
export type {
  PasswordVerdict,
  PasswordViolation,
  PasswordRequirement,
} from "./password-policy";
export {
  PASSWORD_POLICY,
  checkPassword,
  describeViolation,
} from "./password-policy";

import { checkPassword as policyCheck } from "./password-policy";

/**
 * Structural-only evaluation for display.
 *
 * Deliberately returns a verdict whose `acceptable` is false, because no
 * blocklist is supplied here. Callers that need a decision must go through the
 * background.
 */
export function evaluatePasswordStrength(password: string) {
  return policyCheck(password);
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
 * Validate URL format for relay addresses.
 *
 * Only `wss:` is accepted. A relay is an untrusted remote party on a connection
 * that carries the user's public keys, so cleartext `ws:` is refused even for
 * localhost: there is no development relay workflow in this repository, and an
 * exemption would be a permanent hole for a temporary convenience.
 *
 * Embedded credentials are refused as well, since they would place a secret in
 * a value that is stored in settings and displayed back to the user.
 */
export function isValidRelayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "wss:" &&
      parsed.hostname.length > 0 &&
      parsed.username === "" &&
      parsed.password === ""
    );
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

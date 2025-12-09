/**
 * Standard RPC Error Codes
 *
 * Provides a canonical set of error codes for the RPC messaging layer.
 * These codes ensure stable, predictable error handling across all extension contexts.
 *
 * @module error-codes
 */

/**
 * Standard error codes for RPC operations.
 *
 * Error codes are immutable strings that provide stable identifiers for error conditions.
 * Use these constants instead of hardcoded strings to enable reliable error handling.
 */
export const RPC_ERROR_CODES = {
  // Authentication & Authorization
  /** Vault is locked - operation requires unlocked vault to access private keys */
  LOCKED: "locked",

  /** Policy or user explicitly denied the operation */
  DENIED: "denied",

  /** User approval required but approval queue not configured */
  NEEDS_APPROVAL: "needs_approval",

  // Validation Errors
  /** Event structure failed schema validation */
  INVALID_EVENT: "invalid_event",

  /** Origin format is invalid or failed validation */
  INVALID_ORIGIN: "invalid_origin",

  /** Password failed validation rules */
  INVALID_PASSWORD: "invalid_password",

  /** Private key input is not valid nsec1 or hex format */
  INVALID_KEY_INPUT: "invalid_key_input",

  /** Hash is not valid hex or not 32 bytes */
  INVALID_HASH: "invalid_hash",

  /** RPC request message is malformed or lacks required fields */
  INVALID_REQUEST: "invalid_request",

  // State Errors
  /** No key is marked as selected in the vault */
  NO_KEY_SELECTED: "no_key_selected",

  /** A key with the same public key already exists */
  KEY_ALREADY_EXISTS: "key_already_exists",

  // Operation Errors
  /** Approval request exceeded time limit */
  TIMEOUT: "timeout",

  /** RPC method type not supported by handler */
  UNKNOWN_METHOD: "unknown_method",

  /** RPC namespace prefix not registered with router */
  UNKNOWN_NAMESPACE: "unknown_namespace",

  /** Approval queue encountered an error */
  APPROVAL_FAILED: "approval_failed",
} as const;

/**
 * Type representing any valid RPC error code.
 * This is a union of all error code string values.
 */
export type RpcErrorCode =
  (typeof RPC_ERROR_CODES)[keyof typeof RPC_ERROR_CODES];

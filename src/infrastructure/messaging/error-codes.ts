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

  /** RPC request parameters failed method-level validation */
  INVALID_PARAMS: "invalid_params",

  // State Errors
  /** No key is marked as selected in the vault */
  NO_KEY_SELECTED: "no_key_selected",

  /** A key with the same public key already exists */
  KEY_ALREADY_EXISTS: "key_already_exists",

  /** The specified key ID was not found in the vault */
  KEY_NOT_FOUND: "key_not_found",

  // Operation Errors
  /** Approval request exceeded time limit */
  TIMEOUT: "timeout",

  /** RPC method type not supported by handler */
  UNKNOWN_METHOD: "unknown_method",

  /** RPC namespace prefix not registered with router */
  UNKNOWN_NAMESPACE: "unknown_namespace",

  /** Approval queue encountered an error */
  APPROVAL_FAILED: "approval_failed",

  /** Cryptographic signing operation failed */
  SIGNING_FAILED: "signing_failed",

  /** RPC caller exceeded a method or origin rate limit */
  RATE_LIMITED: "rate_limited",

  /** Network dependency failed or was unreachable */
  NETWORK_ERROR: "network_error",
} as const;

/**
 * Type representing any valid RPC error code.
 * This is a union of all error code string values.
 */
export type RpcErrorCode =
  (typeof RPC_ERROR_CODES)[keyof typeof RPC_ERROR_CODES];

export type RpcErrorData = {
  errorCode: RpcErrorCode;
  details?: string;
  debug?: unknown;
  method?: string;
};

export type RpcErrorObject = {
  code: number;
  message: string;
  data: RpcErrorData;
};

export type RpcErrorOptions = {
  message?: string;
  details?: string;
  debug?: unknown;
  method?: string;
};

export const RPC_NUMERIC_ERROR_CODES: Record<RpcErrorCode, number> = {
  [RPC_ERROR_CODES.INVALID_REQUEST]: -32600,
  [RPC_ERROR_CODES.UNKNOWN_METHOD]: -32601,
  [RPC_ERROR_CODES.UNKNOWN_NAMESPACE]: -32601,
  [RPC_ERROR_CODES.INVALID_PARAMS]: -32602,
  [RPC_ERROR_CODES.INVALID_EVENT]: -32602,
  [RPC_ERROR_CODES.INVALID_ORIGIN]: -32602,
  [RPC_ERROR_CODES.INVALID_PASSWORD]: -32602,
  [RPC_ERROR_CODES.INVALID_KEY_INPUT]: -32602,
  [RPC_ERROR_CODES.INVALID_HASH]: -32602,

  [RPC_ERROR_CODES.LOCKED]: -32001,
  [RPC_ERROR_CODES.NEEDS_APPROVAL]: -32002,
  [RPC_ERROR_CODES.DENIED]: -32003,
  [RPC_ERROR_CODES.TIMEOUT]: -32004,
  [RPC_ERROR_CODES.NO_KEY_SELECTED]: -32011,
  [RPC_ERROR_CODES.KEY_ALREADY_EXISTS]: -32012,
  [RPC_ERROR_CODES.KEY_NOT_FOUND]: -32013,
  [RPC_ERROR_CODES.RATE_LIMITED]: -32020,
  [RPC_ERROR_CODES.NETWORK_ERROR]: -32030,
  [RPC_ERROR_CODES.APPROVAL_FAILED]: -32040,
  [RPC_ERROR_CODES.SIGNING_FAILED]: -32041,
};

export const RPC_ERROR_MESSAGES: Record<RpcErrorCode, string> = {
  [RPC_ERROR_CODES.LOCKED]: "Vault is locked",
  [RPC_ERROR_CODES.DENIED]: "Operation denied",
  [RPC_ERROR_CODES.NEEDS_APPROVAL]: "Approval required",
  [RPC_ERROR_CODES.INVALID_EVENT]: "Invalid event",
  [RPC_ERROR_CODES.INVALID_ORIGIN]: "Invalid origin",
  [RPC_ERROR_CODES.INVALID_PASSWORD]: "Invalid password",
  [RPC_ERROR_CODES.INVALID_KEY_INPUT]: "Invalid key input",
  [RPC_ERROR_CODES.INVALID_HASH]: "Invalid hash",
  [RPC_ERROR_CODES.INVALID_REQUEST]: "Invalid request",
  [RPC_ERROR_CODES.INVALID_PARAMS]: "Invalid parameters",
  [RPC_ERROR_CODES.NO_KEY_SELECTED]: "No key selected",
  [RPC_ERROR_CODES.KEY_ALREADY_EXISTS]: "Key already exists",
  [RPC_ERROR_CODES.KEY_NOT_FOUND]: "Key not found",
  [RPC_ERROR_CODES.TIMEOUT]: "Request timed out",
  [RPC_ERROR_CODES.UNKNOWN_METHOD]: "Unknown method",
  [RPC_ERROR_CODES.UNKNOWN_NAMESPACE]: "Unknown namespace",
  [RPC_ERROR_CODES.APPROVAL_FAILED]: "Approval failed",
  [RPC_ERROR_CODES.SIGNING_FAILED]: "Signing failed",
  [RPC_ERROR_CODES.RATE_LIMITED]: "Rate limited",
  [RPC_ERROR_CODES.NETWORK_ERROR]: "Network error",
};

export function createRpcError(
  errorCode: RpcErrorCode,
  options: RpcErrorOptions = {}
): RpcErrorObject {
  const data: RpcErrorData = { errorCode };

  if (options.details) data.details = options.details;
  if (options.debug !== undefined) data.debug = options.debug;
  if (options.method) data.method = options.method;

  return {
    code: RPC_NUMERIC_ERROR_CODES[errorCode],
    message: options.message ?? RPC_ERROR_MESSAGES[errorCode],
    data,
  };
}

export function createRpcErrorResponse(
  errorCode: RpcErrorCode,
  options: RpcErrorOptions = {}
): { ok: false; error: RpcErrorObject } {
  return {
    ok: false,
    error: createRpcError(errorCode, options),
  };
}

export function getRpcErrorCode(error: RpcErrorObject): RpcErrorCode {
  return error.data.errorCode;
}

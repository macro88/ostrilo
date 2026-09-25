# Design: Standardized RPC Errors (JSON-RPC 2.0 Error Object)

## Goals
- Make all RPC errors structured, consistent, and easy to handle.
- Keep a stable machine error code that does not depend on string parsing.
- Provide a uniform place for user-facing messages and safe diagnostics.
- Avoid leaking sensitive information across extension trust boundaries.

## Non-Goals
- Converting the entire internal RPC protocol to JSON-RPC request/response envelopes.
- Adding new product UX.

## Current State
- `RpcResponse` uses a custom discriminated union:
  - success: `{ ok: true, data: unknown }`
  - error: `{ ok: false, error: string, details?: string }`
- Error codes exist and are documented, but `details` usage is inconsistent.
- Client code often rethrows errors as formatted strings, losing structure.
- The `rpc-validation` spec mentions `invalid_params` but the canonical error set does not.

## Proposed Model
### Error Object
Adopt the JSON-RPC 2.0 **error object** shape inside the existing response envelope:

```ts
interface RpcErrorObject {
  code: number;
  message: string;
  data?: {
    errorCode: RpcErrorCode;
    details?: string;
    debug?: unknown;
    method?: string;
  };
}
```

### Machine Codes
Maintain a canonical set of machine codes (string values) as the primary branching key (`error.data.errorCode`).
- This preserves the existing `RPC_ERROR_CODES` idea.
- New codes requested: `rate_limited`, `network_error`.

### Numeric Code Mapping
Define a single mapping from machine codes → numeric `error.code`.

Approach:
- Use JSON-RPC "server error" range for app-defined errors, e.g. `-32000` to `-32099`.
- Reserve `-32600/-32601/-32602` for protocol-ish issues (invalid request/method/params) where applicable.

Example mapping (illustrative; finalized in spec delta):
- `invalid_request` → `-32600`
- `unknown_method` → `-32601`
- `invalid_params` → `-32602`
- `locked` → `-32001`
- `needs_approval` → `-32002`
- `denied` → `-32003`
- `invalid_event` → `-32010`
- `rate_limited` → `-32020`
- `network_error` → `-32030`

### Message Policy
- `error.message` is always present and user-readable.
- Default message is derived from the machine code, but handlers may override with a safer, more specific message.
- Prefer short messages; put extended diagnostics into `data.details`.

### Debug Context Policy
- `data.details` is for safe, user-actionable info.
- `data.debug` is optional and must be sanitized.
- Avoid stack traces and secrets.
- Prefer enabling `debug` only in tests/dev builds if needed.

## Impacted Layers
- Messaging types (`RpcResponse`)
- Router and handlers (constructing errors)
- Client (`rpc()` parsing/throwing)
- NIP-07 bridge (propagating errors to dApps)
- Tests asserting error behavior

## Security Considerations
- Treat anything that can cross into injected/content contexts as untrusted boundary.
- Ensure `debug` does not contain secrets, internal paths, or stack traces.
- Canonical machine codes should not disclose sensitive state.

## Open Questions
1. Do you want full JSON-RPC envelopes (include `jsonrpc` + `id`) or only the error object shape? This proposal assumes **error object only**.
2. Should NIP-07 throw `Error` with `.message` equal to the machine code (e.g. `locked`) or the human message? This proposal assumes `.message` remains the machine code for compatibility, while structured data is available internally.

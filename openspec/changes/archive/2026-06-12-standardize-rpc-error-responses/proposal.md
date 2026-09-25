# Proposal: Standardize RPC Error Responses (JSON-RPC 2.0 Error Object)

## Change ID
`standardize-rpc-error-responses`

## Status
Proposal reviewed 2026-06-11 - ready for development with breaking-change coordination

## 2026-06-11 Review Status

Current code still uses `{ ok: false, error: string, details?: string }` in `src/infrastructure/messaging/rpc.ts` and across handlers, clients, tests, and Playwright helpers. `RPC_ERROR_CODES` exists, but it does not yet include `invalid_params`, `rate_limited`, or `network_error`.

Development readiness: ready, but treat it as a coordinated breaking migration. Implement router/types/helpers, handlers, client propagation, injected/content boundary behavior, and tests in the same branch. Add a temporary client-side reader for the old shape only if needed to stage the migration safely.

## Overview
Standardize all RPC error responses across Ostrilo’s messaging layer to use a single, uniform error shape based on the JSON-RPC 2.0 *error object* format (`{ code, message, data? }`). This includes:
- A stable, machine-readable error code set (e.g. `LOCKED`, `NEEDS_APPROVAL`, `DENIED`, `INVALID_EVENT`, `RATE_LIMITED`, `NETWORK_ERROR`)
- Consistent user-facing `message` strings
- Optional, sanitized debug context via `data` (for developer diagnostics/tests)

This change is focused on the **response shape and error semantics**, not on adding new RPC methods or UI.

## Problem Statement
Ostrilo currently returns RPC errors in a lightweight custom format:

```ts
{ ok: false, error: string, details?: string }
```

While error codes are already standardized (via `RPC_ERROR_CODES`), the current structure has limitations:
- No uniform place for both a human-readable message and structured context
- `details` is loosely defined and inconsistently populated
- Client-side code often converts errors into thrown `Error` strings (e.g. `rpc:<method>:<code>`), which loses structure and makes reliable handling harder
- Specs already show inconsistencies (e.g. `rpc-validation` references `invalid_params`, but it is not currently part of the canonical error code set)

The result is fragmented error handling across UI, background handlers, tests, and potential NIP-07 consumer surfaces.

## Proposed Solution
Adopt a standardized error response payload that follows the JSON-RPC 2.0 *error object* format for **all error responses**.

### Proposed Error Shape
Replace the error branch of `RpcResponse` with:

```ts
{
  ok: false,
  error: {
    code: number,
    message: string,
    data?: {
      errorCode: RpcErrorCode;   // stable machine code (e.g. "locked")
      details?: string;          // safe, user-actionable details
      debug?: unknown;           // optional developer context (sanitized)
      method?: string;           // optional RPC method/type
    }
  }
}
```

Notes:
- This proposal uses the JSON-RPC 2.0 **error object shape**; it does not require converting the entire internal protocol to JSON-RPC request/response envelopes with `jsonrpc` / `id`.
- The stable “code” that callers branch on is `error.data.errorCode` (mapped from `RPC_ERROR_CODES`).
- `error.code` is numeric to align with JSON-RPC conventions and is used for broad category classification.

### Canonical Error Codes
Standardize (and document) a canonical set of machine codes (string values) including at minimum:
- `locked`
- `needs_approval`
- `denied`
- `invalid_params`
- `invalid_event`
- `rate_limited`
- `network_error`

Plus existing codes already in `RPC_ERROR_CODES` (e.g. `invalid_request`, `unknown_method`, `unknown_namespace`, etc.).

### Message Standardization
Define a default message per error code (examples):
- `locked` → "Vault is locked"
- `needs_approval` → "Approval required"
- `denied` → "Operation denied"
- `invalid_event` → "Invalid event"
- `rate_limited` → "Rate limited"
- `network_error` → "Network error"

### Debug Context
`error.data.debug` is optional and MUST be sanitized:
- MUST NOT include secrets (private keys, passwords)
- MUST NOT include stack traces or filesystem paths in responses that cross trust boundaries
- SHOULD be used primarily in tests and internal diagnostics

## Scope
**In Scope**
- Standard error object format for all RPC error responses
- Canonical machine error codes + mapping to numeric JSON-RPC-style `code`
- Standardized default `message` per error code
- Optional structured `data` for safe details/debug
- Align specs so `rpc-error-codes` and `rpc-validation` describe the same error model

**Out of Scope**
- Full JSON-RPC protocol adoption (adding `jsonrpc`, `id`, `result`)
- New UI/flows
- Changes to NIP-07 method surface beyond updating how errors are represented/propagated

## Compatibility / Migration
This is a **breaking change** for callers expecting `error: string`.

Mitigation approach (implementation stage decision):
- Update all internal callers (`rpc()` client, injected bridge, UI hooks, tests) in the same change.
- If needed, provide a temporary compatibility adapter inside the client layer that can read both formats during migration.

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking response shape breaks callers/tests | High | Update client + all internal usage in same change; consider adapter during transition |
| Debug data leaks across boundaries | High | Explicit sanitization requirements; restrict debug fields; prefer method + safe details only |
| Numeric code mapping becomes inconsistent | Medium | Centralize mapping in one module and cover with tests |

## Success Criteria
- [ ] All RPC error responses use the JSON-RPC 2.0 error object shape
- [ ] Callers can branch reliably on `error.data.errorCode`
- [ ] All error codes in use are from the canonical set and documented
- [ ] `rpc-validation` and `rpc-error-codes` specs are consistent
- [ ] Tests assert on machine codes and numeric codes deterministically

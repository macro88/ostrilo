# Design: Standardized RPC Error Code System

## Problem

The current error handling in the RPC layer suffers from several issues:

1. **Inconsistent format**: Mix of snake_case codes (`vault_locked`), prefixed codes (`invalid_password: ${msg}`), and raw messages
2. **Dynamic strings**: Template literals in errors make pattern matching unreliable
3. **No structured format**: Errors are plain strings, losing context like error category or additional details
4. **Cross-layer inconsistency**: Services throw Error objects with messages, handlers return string errors, creating conversion challenges

## Design Principles

1. **Stable Identifiers**: Error codes are immutable strings that won't change with implementation details
2. **Human Readable**: Codes use clear, descriptive names (not numeric codes)
3. **Structured Optional Details**: Diagnostic information separate from error identification
4. **Type Safety**: TypeScript const objects prevent typos and enable IDE autocomplete
5. **Layered Approach**: Keep error codes at infrastructure boundary, preserve Error objects within application layer

## Architecture

### Error Code Constants

```typescript
// src/infrastructure/messaging/error-codes.ts
export const RPC_ERROR_CODES = {
  // Authentication & Authorization
  LOCKED: "locked",
  DENIED: "denied",
  NEEDS_APPROVAL: "needs_approval",
  
  // Validation Errors
  INVALID_EVENT: "invalid_event",
  INVALID_ORIGIN: "invalid_origin",
  INVALID_PASSWORD: "invalid_password",
  INVALID_KEY_INPUT: "invalid_key_input",
  INVALID_HASH: "invalid_hash",
  INVALID_REQUEST: "invalid_request",
  
  // State Errors
  NO_KEY_SELECTED: "no_key_selected",
  KEY_ALREADY_EXISTS: "key_already_exists",
  
  // Operation Errors
  TIMEOUT: "timeout",
  UNKNOWN_METHOD: "unknown_method",
  UNKNOWN_NAMESPACE: "unknown_namespace",
  APPROVAL_FAILED: "approval_failed",
} as const;

export type RpcErrorCode = typeof RPC_ERROR_CODES[keyof typeof RPC_ERROR_CODES];
```

### Enhanced RpcResponse Type

```typescript
// Option 1: Add optional details field (non-breaking)
export type RpcResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: RpcErrorCode; details?: string };

// Option 2: Use discriminated union (more structured but potentially breaking)
export type RpcError = {
  code: RpcErrorCode;
  message?: string;
  details?: Record<string, unknown>;
};

export type RpcResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: RpcError };
```

**Decision**: Use Option 1 for minimal breaking changes. The `error` field becomes a stable code string, and `details` provides diagnostic info when needed.

### Error Translation Pattern

Services continue throwing Error objects with descriptive messages. Handlers catch and translate to RPC error codes:

```typescript
// In RPC handler
try {
  await context.vault.unlock(password);
  return { ok: true, data: { selectedKeyId } };
} catch (error) {
  // Translate service error to RPC error code
  if (error.message === "key_locked_or_missing") {
    return { ok: false, error: RPC_ERROR_CODES.LOCKED };
  }
  if (error.message === "invalid_nsec_prefix") {
    return { 
      ok: false, 
      error: RPC_ERROR_CODES.INVALID_KEY_INPUT,
      details: "Key must be in nsec1 or hex format"
    };
  }
  // Generic fallback
  return { 
    ok: false, 
    error: RPC_ERROR_CODES.UNKNOWN_ERROR,
    details: error.message 
  };
}
```

### Validation Error Handling

Zod validation errors need special handling to preserve useful information:

```typescript
const validation = UnsignedEventSchema.safeParse(event);
if (!validation.success) {
  return {
    ok: false,
    error: RPC_ERROR_CODES.INVALID_EVENT,
    details: validation.error.issues[0]?.message
  };
}
```

## Error Code Categories

### Authentication/Authorization
- `locked` - Operation requires unlocked vault
- `denied` - Policy explicitly denies the operation
- `needs_approval` - User approval required but no queue configured

### Validation Errors
- `invalid_event` - Event structure validation failed
- `invalid_origin` - Origin format or validation failed
- `invalid_password` - Password doesn't meet requirements
- `invalid_key_input` - Private key format unrecognized
- `invalid_hash` - Hash format or length invalid
- `invalid_request` - Malformed RPC request

### State Errors
- `no_key_selected` - No active key available
- `key_already_exists` - Import would create duplicate

### Operation Errors
- `timeout` - Approval request exceeded time limit
- `unknown_method` - RPC method not supported
- `unknown_namespace` - RPC namespace not registered
- `approval_failed` - Approval queue error

## Implementation Strategy

### Phase 1: Foundation (Non-Breaking)
1. Create `error-codes.ts` with constant definitions
2. Add `details?: string` to RpcResponse type
3. Update TypeScript types without changing runtime behavior

### Phase 2: Handler Updates (Breaking)
1. Update all RPC handlers to return error codes instead of raw strings
2. Move diagnostic information to `details` field
3. Ensure all error paths covered

### Phase 3: Service Layer Alignment
1. Review service layer error messages for consistency
2. Document which service errors map to which RPC codes
3. No changes to service layer itself (preserve Error objects)

### Phase 4: Test & Documentation
1. Update all test assertions to check error codes
2. Document error codes in RPC documentation
3. Create migration guide for dApp developers

## Trade-offs

### Chosen Approach: Stable String Codes
**Pros:**
- Simple to understand and debug
- Easy to match in tests and dApp code
- Human-readable in logs and error messages
- No numeric code lookup needed

**Cons:**
- Longer than numeric codes
- No built-in hierarchy (unlike HTTP status codes)

**Alternative Considered: Numeric Codes**
```typescript
enum RpcErrorCode {
  LOCKED = 1001,
  DENIED = 1002,
  INVALID_EVENT = 2001,
}
```
**Rejected because:** Requires documentation lookup, less self-documenting, overkill for the scope

### Details Field vs Structured Error Object
**Chosen:** Simple optional `details?: string` field
- Minimal breaking change
- Preserves backward compatibility if clients ignore details
- Easy to add diagnostic info without changing error code

**Alternative:** Full structured error object with code/message/stack
**Rejected because:** Over-engineered for current needs, larger breaking change

## Testing Strategy

### Error Code Coverage
Every error code must be tested in at least one scenario to ensure:
1. Handler returns the correct code
2. Code is properly propagated through RPC router
3. Content script forwards code to injected script (for NIP-07)
4. dApp-facing error message is stable

### Test Pattern
```typescript
// Old (brittle)
expect(result.error).toContain("locked");

// New (exact)
expect(result).toEqual({ ok: false, error: "locked" });

// With details (when needed)
expect(result.ok).toBe(false);
if (!result.ok) {
  expect(result.error).toBe("invalid_event");
  expect(result.details).toBeDefined();
}
```

## Open Questions

1. **Should we version error codes?** (e.g., `v1.locked`)
   - Decision: No, keep simple. Versioning can be added later if breaking changes needed
   
2. **Should error codes be namespaced?** (e.g., `vault.locked`, `approval.timeout`)
   - Decision: No, flat namespace sufficient for current scale. RPC method already provides context

3. **Should we add error code to Error.name in service layer?**
   - Decision: No, keep service layer unchanged. Translation happens only at RPC boundary

4. **Should content script map error codes for NIP-07 consumers?**
   - Decision: No, pass through as-is. NIP-07 doesn't define standard error codes, so our codes are acceptable

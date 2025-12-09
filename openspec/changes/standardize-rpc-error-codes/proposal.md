# Change: Standardize RPC Error Codes

## Why

The RPC layer currently returns inconsistent error strings across different handlers and scenarios. Error messages range from snake_case codes like `vault_locked` and `no_key_selected` to dynamic strings like `invalid_password: ${message}` and even raw exception messages. This creates several problems:

1. **dApp Integration Friction**: Web applications consuming the NIP-07 API cannot reliably detect specific error conditions to provide appropriate UI feedback or recovery flows
2. **Test Brittleness**: Tests use string matching with `.toContain()` which is fragile and sensitive to message wording changes
3. **Documentation Challenges**: Without stable error codes, it's difficult to document what errors dApps should expect and how to handle them
4. **Inconsistent UX**: Some errors return structured codes while others return free-form messages, leading to unpredictable error handling

By establishing a canonical set of error codes with consistent formatting, we enable reliable error handling for both internal tests and external dApp integrations.

## What Changes

- **Error code enumeration**: Define standard error codes as TypeScript const values
- **Standardized codes for common cases**:
  - `locked` - Vault is locked (currently `vault_locked` or `key_locked_or_missing`)
  - `needs_approval` - User approval required (currently `approval_required`)
  - `denied` - Policy or user denied the operation (currently `policy_denied` or `user_denied`)
  - `invalid_event` - Malformed event structure (currently `invalid_event: ${message}`)
  - `invalid_origin` - Malformed or untrusted origin
  - `invalid_password` - Password validation failed
  - `no_key_selected` - No active key selected
  - `timeout` - Approval request timed out
  - `unknown_method` - Unsupported RPC method (currently `unsupported_method: ${type}`)
- **Error detail preservation**: Add optional `details` field to RpcResponse for diagnostic information while keeping stable `error` codes
- **Backward compatibility consideration**: Update error strings in-place to minimize breaking changes
- **Test updates**: Replace `.toContain()` assertions with exact match or structured error code checks

## Impact

- **Affected specs**: Creates new `rpc-error-codes` capability spec
- **Affected code**:
  - `src/infrastructure/messaging/rpc.ts` - Add error code constants and modify RpcResponse type
  - `src/infrastructure/messaging/rpc-router.ts` - Use standard error codes
  - `src/infrastructure/messaging/handlers/*.ts` - Replace all error strings with standard codes
  - `src/application/services/*.ts` - Update thrown error messages to use standard codes
  - `src/extension/content.ts` - Use standard error codes when forwarding errors
  - All test files - Update error assertions to use exact code matching
- **Breaking change potential**: **BREAKING** for dApps currently parsing specific error strings like `vault_locked` → `locked`
  - Migration path: Document the old→new mapping and provide a transition period with dual support if needed
- **Benefits**:
  - dApps can use `switch` statements on stable error codes
  - Tests become more maintainable with exact assertions
  - Future error additions follow consistent pattern
  - Better TypeScript support with discriminated unions

## Security Considerations

- Error codes must not leak sensitive information (e.g., avoid revealing whether a specific key exists)
- Details field should be sanitized in production builds or when crossing security boundaries
- Origin validation errors should not reveal internal security policies

## Migration Strategy

1. **Phase 1**: Add error code constants and update RPC types (non-breaking)
2. **Phase 2**: Update all internal handlers to use new codes (breaking but controlled)
3. **Phase 3**: Update all tests to use exact matching (validation of consistency)
4. **Phase 4**: Document the error codes for external dApp developers

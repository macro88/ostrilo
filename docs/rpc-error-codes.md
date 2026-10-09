# RPC Error Codes

This document provides a comprehensive reference for all standardized error codes used in the Ostrilo RPC messaging layer. These error codes ensure predictable, stable error handling across all extension contexts and enable reliable integration for both internal tests and external dApp consumers.

## Overview

The RPC system returns errors using a standardized format:

```typescript
{
  ok: false,
  error: string,      // Standard error code from RPC_ERROR_CODES
  details?: string    // Optional diagnostic information
}
```

All error codes are defined as immutable constants in `src/infrastructure/messaging/error-codes.ts` and are available through the `RPC_ERROR_CODES` object.

## Error Code Reference

### Authentication & Authorization Errors

#### `locked`

**When to Use**: The operation requires access to private keys, but the vault is currently locked.

**Examples**:
- User calls `window.nostr.signEvent()` but vault is locked
- Background script attempts to access keys without unlocking first
- NIP-07 method requires key access but vault is in locked state

**Handler Usage**:
```typescript
if (!context.vault.isUnlocked()) {
  return { ok: false, error: RPC_ERROR_CODES.LOCKED };
}
```

**dApp Integration**:
```javascript
try {
  const signed = await window.nostr.signEvent(event);
} catch (error) {
  if (error.message === 'locked') {
    // Prompt user to unlock extension
    showUnlockUI();
  }
}
```

**Breaking Change**: Previously `"vault_locked"`, now `"locked"`

---

#### `denied`

**When to Use**: The operation was explicitly denied by policy rules or direct user action.

**Examples**:
- Origin has explicit deny rule for the event kind
- User clicks "Deny" on approval prompt
- Policy mode set to "deny_all" for origin

**Handler Usage**:
```typescript
if (policyResult.action === "deny") {
  return { 
    ok: false, 
    error: RPC_ERROR_CODES.DENIED,
    details: "Policy denies this operation"
  };
}
```

**dApp Integration**:
```javascript
try {
  const signed = await window.nostr.signEvent(event);
} catch (error) {
  if (error.message === 'denied') {
    // Inform user the extension denied this action
    showDeniedMessage();
  }
}
```

**Breaking Changes**: 
- Previously `"policy_denied"` → now `"denied"`
- Previously `"user_denied"` → now `"denied"`

---

#### `disclosure_refused`

**When to Use**: The user refused to disclose their public key to the calling origin, or has a remembered refusal on record for it.

Deliberately distinct from `denied`. The two mean different things to a dApp: a refused *signature* is about one event, and retrying with a different one is reasonable; a refused *identity* is about the site itself, and retrying is exactly the behaviour the remembered refusal exists to stop.

**Examples**:
- User clicks "Deny" on an identity-disclosure prompt
- The origin has a remembered disclosure denial, so no prompt is shown at all

**Handler Usage**:
```typescript
if (recorded === "deny") {
  return createRpcErrorResponse(RPC_ERROR_CODES.DISCLOSURE_REFUSED, {
    details: "This site is not allowed to read your public key.",
    method: message.type,
  });
}
```

**dApp Integration**:
```javascript
try {
  const pubkey = await window.nostr.getPublicKey();
} catch (error) {
  if (error.message.includes('disclosure_refused')) {
    // The user has said no to THIS SITE. Do not retry on a loop, and do not
    // re-ask on every page load: a remembered refusal is answered without a
    // prompt, so retrying only burns the origin's rate allowance.
    showIdentityRefusedMessage();
  }
}
```

**Note**: `getPublicKey` is also rate limited per origin. A caller that polls will see `rate_limited` rather than a public key.

---

#### `needs_approval`

**When to Use**: User approval is required for the operation, but the approval queue is not configured or available.

**Examples**:
- Policy evaluation returns "ask" but approval UI not initialized
- Approval queue service not available
- Running in context where user prompts not possible

**Handler Usage**:
```typescript
if (policyResult.action === "ask" && !context.approvalQueue) {
  return { 
    ok: false, 
    error: RPC_ERROR_CODES.NEEDS_APPROVAL,
    details: "Approval queue not available"
  };
}
```

**dApp Integration**:
```javascript
try {
  const signed = await window.nostr.signEvent(event);
} catch (error) {
  if (error.message === 'needs_approval') {
    // Extension can't show approval UI, request user to check extension settings
    showApprovalConfigMessage();
  }
}
```

**Breaking Change**: Previously `"approval_required"`, now `"needs_approval"`

---

### Validation Errors

#### `invalid_event`

**When to Use**: A Nostr event structure fails schema validation according to NIP-01.

**Examples**:
- Event missing required fields (kind, content, created_at, tags, pubkey)
- Event field has wrong type (e.g., kind is string instead of number)
- Event content fails specific validation rules

**Handler Usage**:
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

**dApp Integration**:
```javascript
try {
  const signed = await window.nostr.signEvent(event);
} catch (error) {
  if (error.message === 'invalid_event') {
    // Event structure is malformed, check event fields
    console.error('Event validation failed:', error);
  }
}
```

**Breaking Change**: Previously `"invalid_event: ${message}"`, now `"invalid_event"` with message in `details`

---

#### `invalid_origin`

**When to Use**: An origin parameter is malformed or fails validation checks,
or a page request's origin cannot be attested by the browser.

**Examples**:
- Origin is not a valid URL format
- Origin contains invalid characters
- Origin missing required components (protocol, host)
- A `nostr.*` request whose claimed `origin` disagrees with the origin of the
  browser-attested `sender.url`, or whose sender is not this extension's
  top-frame content script on an `https:` page. The router refuses these
  before any handler runs; see "Page origin binding" in
  `docs/rpc-architecture.md`.

**Handler Usage**:
```typescript
const originValidation = OriginSchema.safeParse(message.origin);
if (!originValidation.success) {
  return {
    ok: false,
    error: RPC_ERROR_CODES.INVALID_ORIGIN,
    details: "Origin must be valid URL format"
  };
}
```

---

#### `invalid_password`

**When to Use**: A password fails validation rules during unlock or key generation, or a master-password check fails.

**Examples**:
- Password doesn't meet minimum length requirement
- Password is empty or only whitespace
- Password fails complexity checks
- The current password given to `vault.changePassword` is wrong (charged to the unlock throttle), or its new password fails the creation policy

**Handler Usage**:
```typescript
const passwordValidation = PasswordSchema.safeParse(message.password);
if (!passwordValidation.success) {
  return {
    ok: false,
    error: RPC_ERROR_CODES.INVALID_PASSWORD,
    details: passwordValidation.error.issues[0]?.message
  };
}
```

---

#### `invalid_key_input`

**When to Use**: A private key input is not in valid nsec1 (Bech32) or hex format.

**Examples**:
- Key string doesn't start with "nsec1"
- Hex key is not 64 characters
- Key contains invalid characters for its format
- Key decoding fails

**Handler Usage**:
```typescript
const keyValidation = KeyInputSchema.safeParse(message.privateKey);
if (!keyValidation.success) {
  return {
    ok: false,
    error: RPC_ERROR_CODES.INVALID_KEY_INPUT,
    details: "Key must be nsec1 or 64-char hex format"
  };
}
```

---

#### `invalid_hash`

**When to Use**: A hash parameter is not valid hex format or not exactly 32 bytes.

**Examples**:
- Hash string is not 64 hex characters
- Hash contains non-hex characters
- Hash length is incorrect

**Handler Usage**:
```typescript
const hashValidation = HashSchema.safeParse(message.hash);
if (!hashValidation.success) {
  return {
    ok: false,
    error: RPC_ERROR_CODES.INVALID_HASH,
    details: "Hash must be 64 hex characters (32 bytes)"
  };
}
```

---

#### `invalid_request`

**When to Use**: The RPC request message itself is malformed or lacks required fields.

**Examples**:
- Message is not a valid JSON object
- Required "type" field is missing
- Message has unexpected structure

**Handler Usage**:
```typescript
if (!isValidRpcMessage(message)) {
  return {
    ok: false,
    error: RPC_ERROR_CODES.INVALID_REQUEST,
    details: "Message must be valid RPC request object"
  };
}
```

---

### State Errors

#### `no_key_selected`

**When to Use**: An operation requires an active key, but no key is currently selected in the vault.

**Examples**:
- User calls `window.nostr.signEvent()` with no key selected
- Background operation needs to sign but selectedKeyId is null
- Vault is unlocked but empty or no key marked as selected

**Handler Usage**:
```typescript
if (!context.vault.selectedKeyId) {
  return { 
    ok: false, 
    error: RPC_ERROR_CODES.NO_KEY_SELECTED,
    details: "Please select a key first"
  };
}
```

**dApp Integration**:
```javascript
try {
  const signed = await window.nostr.signEvent(event);
} catch (error) {
  if (error.message === 'no_key_selected') {
    // Guide user to select a key in extension settings
    showKeySelectionPrompt();
  }
}
```

---

#### `key_already_exists`

**When to Use**: Attempting to import a key that already exists in the vault (based on public key).

**Examples**:
- Importing nsec1 key that matches existing key
- Adding duplicate key via different format (nsec1 vs hex)

**Handler Usage**:
```typescript
if (context.vault.hasKey(publicKey)) {
  return {
    ok: false,
    error: RPC_ERROR_CODES.KEY_ALREADY_EXISTS,
    details: "This key is already in your vault"
  };
}
```

---

#### `vault_migration_pending`

**When to Use**: `vault.changePassword` found a key record still in the
pre-envelope (legacy) format. Rotating around it would strand it, so the change
is refused with nothing written. One unlock migrates legacy records.

**Numeric code**: `-32014`. UI-only: a web page can never receive it.

---

#### `vault_records_damaged`

**When to Use**: `vault.changePassword` found key records that do not open, or
do not match their public key, under the current password. The change is
refused with nothing written, and `details` names the affected key ids -
never a password. The user removes the damaged key, then tries again.

**Numeric code**: `-32015`. UI-only: a web page can never receive it.

---

### Operation Errors

#### `timeout`

**When to Use**: An approval request exceeded the configured timeout period without user response.

**Examples**:
- User doesn't respond to approval popup within 60 seconds
- Approval request auto-denies due to timeout

**Handler Usage**:
```typescript
const result = await context.approvalQueue.waitForResponse(requestId, 60000);
if (result.timedOut) {
  return {
    ok: false,
    error: RPC_ERROR_CODES.TIMEOUT,
    details: "User did not respond within 60 seconds"
  };
}
```

**dApp Integration**:
```javascript
try {
  const signed = await window.nostr.signEvent(event);
} catch (error) {
  if (error.message === 'timeout') {
    // User didn't respond in time, can retry
    showTimeoutRetryUI();
  }
}
```

---

#### `unknown_method`

**When to Use**: An RPC method type is not supported by the handler.

**Examples**:
- Calling non-existent method like `"vault.nonExistent"`
- Handler receives method from different namespace
- Method name has typo or incorrect format

**Handler Usage**:
```typescript
default:
  return {
    ok: false,
    error: RPC_ERROR_CODES.UNKNOWN_METHOD,
    details: `Unsupported method: ${(message as any).type}`
  };
```

---

#### `unknown_namespace`

**When to Use**: An RPC namespace prefix does not match any registered module in the router.

**Examples**:
- Calling `"nonexistent.method"` with no "nonexistent" module
- Typo in namespace name
- Module not registered in router

**Router Usage**:
```typescript
const namespace = type.split(".")[0];
if (!this.modules.has(namespace)) {
  return {
    ok: false,
    error: RPC_ERROR_CODES.UNKNOWN_NAMESPACE,
    details: `Unknown namespace: ${namespace}`
  };
}
```

---

#### `approval_failed`

**When to Use**: The approval queue encounters an internal error while processing an approval request.

**Examples**:
- Approval queue service throws unexpected error
- Popup window fails to open
- Internal state corruption in approval system
- The background was ended while the request was open (the content script reports this, since the background can no longer answer; a retry then reports `locked`)

**Handler Usage**:
```typescript
try {
  const approved = await context.approvalQueue.requestApproval(request);
  // ... handle response
} catch (error) {
  return {
    ok: false,
    error: RPC_ERROR_CODES.APPROVAL_FAILED,
    details: error.message
  };
}
```

---

## Usage Guidelines

### TypeScript Integration

All error codes are fully typed for excellent developer experience:

```typescript
import { RPC_ERROR_CODES, type RpcErrorCode } from '@/infrastructure/messaging/error-codes';

// Type-safe error code usage
const errorCode: RpcErrorCode = RPC_ERROR_CODES.LOCKED;

// TypeScript will autocomplete all available codes
const result = { ok: false, error: RPC_ERROR_CODES. /* autocomplete here */ };
```

### Testing Best Practices

**Do**: Use exact equality checks with error code constants
```typescript
expect(result).toEqual({ 
  ok: false, 
  error: RPC_ERROR_CODES.LOCKED 
});
```

**Don't**: Use fragile string matching
```typescript
// ❌ Avoid
expect(result.error).toContain('locked');
```

### Security Considerations

- **Never** include sensitive information (passwords, private keys, internal paths) in error codes or details
- Keep `details` field generic when crossing security boundaries
- Use generic codes like `denied` or `locked` instead of revealing internal policy logic
- Sanitize validation error messages before including in `details` field

### Migration for dApp Developers

If you're integrating with Ostrilo's NIP-07 provider, note these breaking changes:

| Old Error | New Error Code | Migration |
|-----------|---------------|-----------|
| `"vault_locked"` | `"locked"` | Update string checks to `=== "locked"` |
| `"policy_denied"` | `"denied"` | Update string checks to `=== "denied"` |
| `"user_denied"` | `"denied"` | Update string checks to `=== "denied"` |
| `"approval_required"` | `"needs_approval"` | Update string checks to `=== "needs_approval"` |
| `"invalid_event: ..."` | `"invalid_event"` | Check `error === "invalid_event"`, use details if needed |

**Recommended Pattern**:
```javascript
try {
  const result = await window.nostr.signEvent(event);
} catch (error) {
  // Use switch for clean error handling
  switch (error.message) {
    case 'locked':
      // Handle locked vault
      break;
    case 'denied':
      // Handle denial
      break;
    case 'needs_approval':
      // Handle approval needed
      break;
    case 'invalid_event':
      // Handle validation error
      break;
    case 'timeout':
      // Handle timeout
      break;
    default:
      // Handle unexpected errors
      console.error('Unexpected error:', error);
  }
}
```

## Error Code Categories

### Quick Reference

**Authentication/Authorization**: `locked`, `denied`, `needs_approval`

**Validation**: `invalid_event`, `invalid_origin`, `invalid_password`, `invalid_key_input`, `invalid_hash`, `invalid_request`

**State**: `no_key_selected`, `key_already_exists`, `vault_migration_pending`, `vault_records_damaged`

**Operations**: `timeout`, `unknown_method`, `unknown_namespace`, `approval_failed`

## Implementation Details

### Service Layer Error Translation

The application service layer continues using Error objects with descriptive messages. RPC handlers translate these service errors to standardized codes:

```typescript
try {
  await context.vault.unlock(password);
  return { ok: true, data: { selectedKeyId } };
} catch (error) {
  // Translate service error message to RPC error code
  if (error.message === "key_locked_or_missing") {
    return { ok: false, error: RPC_ERROR_CODES.LOCKED };
  }
  if (error.message.includes("invalid_nsec")) {
    return { 
      ok: false, 
      error: RPC_ERROR_CODES.INVALID_KEY_INPUT,
      details: "Invalid nsec format"
    };
  }
  // Generic fallback
  return { 
    ok: false, 
    error: RPC_ERROR_CODES.UNKNOWN_METHOD,
    details: error.message 
  };
}
```

### Content Script Forwarding

The content script (`content.ts`) forwards error responses unchanged, preserving both error codes and optional details fields. No transformation occurs when passing errors from background to injected script context.

## See Also

- [RPC Architecture](./rpc-architecture.md) - Overall RPC system design
- [Testing Guide](./TESTING.md) - How to test RPC error conditions
- [NIP-07 Provider](../openspec/specs/nip07-provider/spec.md) - NIP-07 specific error scenarios

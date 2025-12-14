# NIP-07 Provider - Error Code Modifications

Updates NIP-07 provider error responses to use standardized RPC error codes.

## MODIFIED Requirements

### Requirement: Sign Event

The extension SHALL provide a `window.nostr.signEvent(event)` method that signs Nostr events per NIP-01, using standardized error codes for all error conditions.

#### Scenario: Error when locked (MODIFIED)
- **GIVEN** the vault is locked
- **WHEN** a dApp calls `window.nostr.signEvent(event)`
- **THEN** the Promise SHALL reject with error message `"locked"` (**BREAKING**: was `"vault_locked"`)
- **AND** the error SHALL be a stable error code suitable for programmatic handling

#### Scenario: Error when policy denies (MODIFIED)
- **GIVEN** the vault is unlocked
- **AND** the origin has an explicit deny rule for the event kind
- **WHEN** a dApp calls `window.nostr.signEvent(event)`
- **THEN** the Promise SHALL reject with error message `"denied"` (**BREAKING**: was `"policy_denied"`)
- **AND** the error code SHALL be consistent regardless of denial source (policy or user)

#### Scenario: Error when approval required but unavailable (MODIFIED)
- **GIVEN** the vault is unlocked
- **AND** policy evaluation returns "ask" for the origin and kind
- **AND** the approval queue is not configured
- **WHEN** a dApp calls `window.nostr.signEvent(event)`
- **THEN** the Promise SHALL reject with error message `"needs_approval"` (**BREAKING**: was `"approval_required"`)

#### Scenario: User denies signing request (MODIFIED)
- **GIVEN** an approval prompt is displayed for a signing request
- **WHEN** the user clicks "Deny" or "Deny + Remember"
- **THEN** the Promise SHALL reject with error message `"denied"` (**BREAKING**: was `"user_denied"`)
- **AND** the approval popup SHALL close

#### Scenario: Approval timeout (MODIFIED)
- **GIVEN** an approval prompt is displayed for a signing request
- **WHEN** 60 seconds pass without user action
- **THEN** the Promise SHALL reject with error message `"timeout"` (**BREAKING**: was containing "timeout" but not exact)
- **AND** the approval popup SHALL close

#### Scenario: Invalid event format (MODIFIED)
- **WHEN** a dApp calls `window.nostr.signEvent(event)` with invalid event structure
- **THEN** the Promise SHALL reject with error message `"invalid_event"` (**BREAKING**: was `"invalid_event: ${details}"`)
- **AND** validation details MAY be available via error handling but not in the primary error string

#### Scenario: No key selected (MODIFIED)
- **GIVEN** the vault is unlocked
- **AND** no key is marked as selected
- **WHEN** a dApp calls `window.nostr.signEvent(event)`
- **THEN** the Promise SHALL reject with error message `"no_key_selected"` (unchanged, already standardized)

---

### Requirement: Get Public Key

The extension SHALL provide a `window.nostr.getPublicKey()` method with standardized error codes.

#### Scenario: Error when locked (MODIFIED)
- **GIVEN** the vault is locked
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the Promise SHALL reject with error message `"locked"` (**BREAKING**: was `"vault_locked"`)

#### Scenario: No key selected (MODIFIED)
- **GIVEN** the vault is unlocked
- **AND** no key is marked as selected
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the Promise SHALL reject with error message `"no_key_selected"` (unchanged, already standardized)

---

## Migration Guide for dApp Developers

### Breaking Changes

The following error strings have changed:

| Old Error String | New Error Code | Condition |
|-----------------|----------------|-----------|
| `"vault_locked"` | `"locked"` | Vault is locked |
| `"policy_denied"` | `"denied"` | Policy or user denies operation |
| `"user_denied"` | `"denied"` | User explicitly denies approval |
| `"approval_required"` | `"needs_approval"` | Approval needed but unavailable |
| `"invalid_event: ..."` | `"invalid_event"` | Event validation failed |

### Migration Example

**Before:**
```javascript
try {
  const signed = await window.nostr.signEvent(event);
} catch (error) {
  if (error.message.includes('locked')) {
    // Handle locked vault
  } else if (error.message.includes('denied')) {
    // Handle denial
  }
}
```

**After:**
```javascript
try {
  const signed = await window.nostr.signEvent(event);
} catch (error) {
  switch (error.message) {
    case 'locked':
      // Handle locked vault
      break;
    case 'denied':
      // Handle policy or user denial
      break;
    case 'needs_approval':
      // Handle approval required
      break;
    case 'invalid_event':
      // Handle invalid event
      break;
    case 'timeout':
      // Handle approval timeout
      break;
    default:
      // Handle unexpected error
  }
}
```

### Compatibility Period

Consider supporting both old and new error formats during a transition period if needed, though NIP-07 does not specify standard error formats, making this change acceptable.

---

## Cross-References

This modification depends on:
- **rpc-error-codes**: The base error code specification (see ADDED requirements in rpc-error-codes/spec.md)

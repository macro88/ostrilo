# RPC Error Codes

Standardized error codes for the RPC messaging layer ensuring stable, predictable error handling across all extension contexts.

## ADDED Requirements

### Requirement: Standard Error Code Constants

The RPC system SHALL define a canonical set of error codes as immutable string constants.

#### Scenario: Error code availability
- **GIVEN** a developer imports the RPC types module
- **WHEN** they access `RPC_ERROR_CODES`
- **THEN** all standard error codes SHALL be available as const string properties
- **AND** TypeScript SHALL provide autocomplete for all error codes
- **AND** the `RpcErrorCode` type SHALL be a union of all valid error code strings

#### Scenario: Error code immutability
- **GIVEN** the `RPC_ERROR_CODES` constant object
- **WHEN** code attempts to modify an error code value at runtime
- **THEN** TypeScript SHALL prevent the modification at compile time
- **AND** the object SHALL be marked as `const` to ensure immutability

---

### Requirement: Authentication and Authorization Error Codes

The RPC system SHALL provide standard error codes for authentication and authorization failures.

#### Scenario: Locked vault error
- **GIVEN** an RPC request requires access to private keys
- **WHEN** the vault is locked
- **THEN** the error response SHALL use code `"locked"`
- **AND** SHALL NOT include sensitive information in the error details

#### Scenario: Policy denial error
- **GIVEN** an RPC request is evaluated against origin policy
- **WHEN** the policy explicitly denies the operation
- **THEN** the error response SHALL use code `"denied"`
- **AND** MAY include policy reason in details field for debugging

#### Scenario: Approval required error
- **GIVEN** an RPC request requires user approval
- **WHEN** the approval queue is not configured or available
- **THEN** the error response SHALL use code `"needs_approval"`
- **AND** SHALL NOT block indefinitely waiting for approval

---

### Requirement: Validation Error Codes

The RPC system SHALL provide standard error codes for input validation failures.

#### Scenario: Invalid event structure
- **GIVEN** a Nostr event signing request
- **WHEN** the event structure fails schema validation
- **THEN** the error response SHALL use code `"invalid_event"`
- **AND** the details field SHALL contain the first validation error message from Zod

#### Scenario: Invalid origin format
- **GIVEN** an RPC request includes an origin parameter
- **WHEN** the origin format is invalid or fails validation
- **THEN** the error response SHALL use code `"invalid_origin"`
- **AND** the details field MAY include format requirements

#### Scenario: Invalid password format
- **GIVEN** a vault unlock or key generation request
- **WHEN** the password fails validation rules
- **THEN** the error response SHALL use code `"invalid_password"`
- **AND** the details field SHALL contain validation error message

#### Scenario: Invalid key input format
- **GIVEN** a key import request
- **WHEN** the key input is not valid nsec1 or hex format
- **THEN** the error response SHALL use code `"invalid_key_input"`
- **AND** the details field SHALL indicate expected formats

#### Scenario: Invalid hash format
- **GIVEN** a signing request with explicit hash parameter
- **WHEN** the hash is not valid hex or not 32 bytes
- **THEN** the error response SHALL use code `"invalid_hash"`
- **AND** the details field SHALL indicate correct format

#### Scenario: Invalid RPC request structure
- **GIVEN** a message received by the RPC router
- **WHEN** the message is not a valid object or lacks required fields
- **THEN** the error response SHALL use code `"invalid_request"`
- **AND** SHALL NOT process the malformed request further

---

### Requirement: State Error Codes

The RPC system SHALL provide standard error codes for invalid state conditions.

#### Scenario: No key selected error
- **GIVEN** an RPC request requires an active key
- **WHEN** no key is marked as selected in the vault
- **THEN** the error response SHALL use code `"no_key_selected"`
- **AND** SHALL indicate the user needs to select a key

#### Scenario: Key already exists error
- **GIVEN** a key import request
- **WHEN** a key with the same public key already exists
- **THEN** the error response SHALL use code `"key_already_exists"`
- **AND** SHALL prevent duplicate key creation

---

### Requirement: Operation Error Codes

The RPC system SHALL provide standard error codes for operation failures.

#### Scenario: Approval timeout error
- **GIVEN** an approval request is queued
- **WHEN** the user does not respond within the timeout period
- **THEN** the error response SHALL use code `"timeout"`
- **AND** the request SHALL be auto-denied

#### Scenario: Unknown RPC method error
- **GIVEN** an RPC request is processed by a handler
- **WHEN** the method type does not match any supported methods
- **THEN** the error response SHALL use code `"unknown_method"`
- **AND** the details field MAY include the unsupported method name

#### Scenario: Unknown namespace error
- **GIVEN** an RPC request is processed by the router
- **WHEN** the namespace prefix does not match any registered module
- **THEN** the error response SHALL use code `"unknown_namespace"`
- **AND** the details field SHALL include the unknown namespace

#### Scenario: Approval queue failure
- **GIVEN** an approval request is being processed
- **WHEN** the approval queue encounters an error
- **THEN** the error response SHALL use code `"approval_failed"`
- **AND** the details field SHALL contain diagnostic information

---

### Requirement: Structured Error Response

The RPC system SHALL return errors in a structured, consistent format.

#### Scenario: Error response structure
- **GIVEN** any RPC operation fails
- **WHEN** the handler returns an error response
- **THEN** the response SHALL be typed as `{ ok: false; error: string; details?: string }`
- **AND** the `error` field SHALL contain a standard error code from `RPC_ERROR_CODES`
- **AND** the `details` field MAY contain diagnostic information

#### Scenario: Error details for validation failures
- **GIVEN** an RPC request fails validation
- **WHEN** the error response is constructed
- **THEN** the `details` field SHOULD include the validation error message
- **AND** SHALL NOT include sensitive information like private keys or passwords

#### Scenario: Error propagation through content script
- **GIVEN** an RPC error response from the background script
- **WHEN** the content script forwards it to the injected script
- **THEN** the error code SHALL be preserved unchanged
- **AND** the details field SHALL be included if present

---

### Requirement: Backward Compatibility with Service Layer

The RPC error code system SHALL integrate with existing service layer error handling.

#### Scenario: Service error translation
- **GIVEN** an application service throws an Error with a message
- **WHEN** the RPC handler catches the error
- **THEN** the handler SHALL translate the error message to the appropriate RPC error code
- **AND** MAY preserve the original error message in the details field

#### Scenario: Preserving service layer independence
- **GIVEN** the application and domain layers
- **WHEN** services throw errors
- **THEN** services SHALL continue using Error objects with descriptive messages
- **AND** SHALL NOT import or depend on RPC error codes directly

#### Scenario: Error code mapping documentation
- **GIVEN** a service error is caught by an RPC handler
- **WHEN** translating to an RPC error code
- **THEN** the mapping SHALL be consistent across all handlers
- **AND** SHALL be documented in internal documentation

---

### Requirement: Type Safety and Developer Experience

The RPC error code system SHALL provide strong type safety and excellent developer experience.

#### Scenario: TypeScript autocomplete
- **GIVEN** a developer writing an RPC handler
- **WHEN** they type `RPC_ERROR_CODES.`
- **THEN** their IDE SHALL show autocomplete with all available error codes
- **AND** SHALL show JSDoc documentation for each code

#### Scenario: Type checking in tests
- **GIVEN** a test checking RPC error responses
- **WHEN** they assert on the error field
- **THEN** TypeScript SHALL validate the error code is a valid `RpcErrorCode`
- **AND** SHALL catch typos or invalid codes at compile time

#### Scenario: Discriminated union support
- **GIVEN** code handling an RPC response
- **WHEN** they check `if (!result.ok)`
- **THEN** TypeScript SHALL narrow the type to include `error` and optional `details` fields
- **AND** SHALL prevent access to `data` field in error branch

---

### Requirement: Security Considerations

The RPC error code system SHALL maintain security boundaries and prevent information leakage.

#### Scenario: No sensitive data in error codes
- **GIVEN** any error response
- **WHEN** the error code is set
- **THEN** the code SHALL NOT reveal sensitive information like key existence, internal paths, or security policies
- **AND** SHALL use generic codes for security-related failures

#### Scenario: Details field sanitization
- **GIVEN** an error response with details field
- **WHEN** the response crosses a security boundary (e.g., background to content script)
- **THEN** the details SHALL NOT include stack traces, internal file paths, or sensitive state
- **AND** SHALL only include user-actionable information

#### Scenario: Origin validation errors
- **GIVEN** an origin fails validation
- **WHEN** returning an error
- **THEN** the error SHALL NOT reveal internal origin policies or whitelists
- **AND** SHALL use generic `"invalid_origin"` code without leaking policy details

---

### Requirement: Testing and Validation

The RPC error code system SHALL be comprehensively testable and validated.

#### Scenario: Error code coverage
- **GIVEN** the complete set of RPC error codes
- **WHEN** running the test suite
- **THEN** every error code SHALL be triggered at least once
- **AND** tests SHALL verify the error code is returned correctly

#### Scenario: No hardcoded error strings
- **GIVEN** all RPC handlers and router code
- **WHEN** checking for error string literals
- **THEN** all error responses SHALL use constants from `RPC_ERROR_CODES`
- **AND** SHALL NOT use hardcoded strings like `"some error"` or template literals

#### Scenario: Exact error code matching in tests
- **GIVEN** a test for an error condition
- **WHEN** asserting on the error response
- **THEN** tests SHALL use exact equality checks like `.toBe(RPC_ERROR_CODES.LOCKED)`
- **AND** SHALL NOT use fragile `.toContain()` checks on error strings

---

## Cross-References

This specification creates a new capability that affects:
- **nip07-provider**: Error codes for NIP-07 window.nostr methods (see MODIFIED requirements in nip07-provider spec)
- **approval-queue**: Error codes for approval operations (see MODIFIED requirements in approval-queue spec if exists)
- **vault-operations**: Error codes for vault unlock/lock/sign operations (see MODIFIED requirements in vault-operations spec if exists)

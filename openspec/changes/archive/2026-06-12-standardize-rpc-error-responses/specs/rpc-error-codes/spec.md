# rpc-error-codes Capability Specification (Delta)

## Purpose
Standardize RPC failures using:
- Canonical, machine-readable error codes
- Deterministic error messages
- A structured error object compatible with JSON-RPC 2.0 error object format

## MODIFIED Requirements

### Requirement: Canonical Error Codes

The RPC system SHALL define a canonical set of machine error codes.

#### Scenario: Required machine codes exist
- **GIVEN** a developer imports the RPC error code constants
- **WHEN** they inspect available codes
- **THEN** the canonical set SHALL include at minimum:
  - `locked`
  - `needs_approval`
  - `denied`
  - `invalid_params`
  - `invalid_event`
  - `rate_limited`
  - `network_error`

#### Scenario: Existing codes remain available
- **GIVEN** existing RPC error codes are in use
- **WHEN** the error code set is updated
- **THEN** previously defined codes (e.g. `invalid_request`, `unknown_method`, `unknown_namespace`, `timeout`) SHALL remain available unless explicitly deprecated

---

### Requirement: Structured Error Response Format

The RPC system SHALL return errors using a structured error object compatible with the JSON-RPC 2.0 error object format.

#### Scenario: Error response shape
- **GIVEN** an RPC operation fails
- **WHEN** an error response is returned
- **THEN** the response SHALL have the shape:

```ts
{ ok: false, error: { code: number, message: string, data?: object } }
```

- **AND** `error.code` SHALL be a number
- **AND** `error.message` SHALL be a non-empty string
- **AND** `error.data` MAY be omitted

#### Scenario: Machine code is available in data
- **GIVEN** an RPC operation fails
- **WHEN** an error response is returned
- **THEN** `error.data.errorCode` SHALL contain the canonical machine error code
- **AND** it SHALL match one of the canonical error code constants

---

### Requirement: Numeric Code Mapping

The RPC system SHALL map canonical machine error codes to numeric error codes.

#### Scenario: Protocol-style numeric codes for request/method/params
- **GIVEN** an RPC request is malformed
- **WHEN** the router rejects it
- **THEN** the numeric `error.code` SHOULD align with JSON-RPC conventions:
  - invalid request → `-32600`
  - unknown method → `-32601`
  - invalid params → `-32602`

#### Scenario: Application numeric codes for domain errors
- **GIVEN** an application-level error occurs (e.g. vault locked)
- **WHEN** the error is returned
- **THEN** the numeric `error.code` SHALL be stable and documented
- **AND** codes SHOULD use the JSON-RPC “server error” range (e.g. `-32000` to `-32099`)

---

### Requirement: Message Standardization

The RPC system SHALL provide deterministic, user-readable messages for each canonical machine error code.

#### Scenario: Locked message
- **GIVEN** an error with machine code `locked`
- **WHEN** constructing the error response
- **THEN** the message SHALL be "Vault is locked" (or a documented equivalent)

#### Scenario: Denied message
- **GIVEN** an error with machine code `denied`
- **WHEN** constructing the error response
- **THEN** the message SHALL be "Operation denied" (or a documented equivalent)

#### Scenario: Needs approval message
- **GIVEN** an error with machine code `needs_approval`
- **WHEN** constructing the error response
- **THEN** the message SHALL be "Approval required" (or a documented equivalent)

---

### Requirement: Optional Debug Context

The RPC system MAY include optional debug context under `error.data.debug`. When present, debug context MUST be sanitized.

#### Scenario: Debug context is sanitized
- **GIVEN** an error includes `error.data.debug`
- **WHEN** the response crosses trust boundaries (background → content → injected)
- **THEN** the debug payload SHALL NOT include secrets (private keys, passwords)
- **AND** SHALL NOT include stack traces or filesystem paths

## ADDED Requirements

### Requirement: Rate Limited Error

The RPC system SHALL support a rate limiting error code.

#### Scenario: Too many requests
- **GIVEN** the system enforces rate limits for an RPC method
- **WHEN** the caller exceeds the limit
- **THEN** the error SHALL use machine code `rate_limited`
- **AND** the message SHALL indicate the operation is rate limited

---

### Requirement: Network Error

The RPC system SHALL support a network error code.

#### Scenario: Network dependency fails
- **GIVEN** an RPC method depends on a network operation
- **WHEN** the network operation fails
- **THEN** the error SHALL use machine code `network_error`
- **AND** the message SHALL indicate a network failure occurred

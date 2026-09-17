# rpc-validation Specification

## Purpose

Ensure RPC requests are strictly validated and rejected consistently using the standardized structured RPC error model.

## Requirements

### Requirement: Strict Input Validation
All RPC handlers MUST validate the structure and content of incoming messages against a strict schema before processing. Namespace resolution MUST NOT consider inherited object properties, so a caller-supplied namespace such as `__proto__` or `constructor` MUST resolve to no module. Error responses MUST NOT carry raw internal error text: `error.data.details` MUST be either omitted or a fixed, caller-safe string chosen by the handler. Password parameters that create a new vault password MUST be validated against the shared password policy rather than a non-empty string check, and password parameters supplied for verification MUST be validated for transport hygiene only. Numeric parameters MUST be validated for integrality and range, and origin-bearing methods MUST be validated for a well-formed origin, before any handler reads key material or evaluates policy. Unsigned event payloads MUST additionally be bounded in size so that oversized payloads are rejected before any hashing, signing, or approval work is performed.

#### Scenario: Invalid Activity Filter

- **GIVEN** an `activity.filterBy` RPC request
- **WHEN** the request contains invalid types (e.g., string for limit) or extra fields
- **THEN** the handler MUST return an error with machine code `invalid_params`
- **AND** the numeric error code SHOULD be `-32602`
- **AND** MUST NOT pass the data to the service layer

#### Scenario: Invalid Approval Action

- **GIVEN** an `approval.resolve` RPC request
- **WHEN** the request contains a missing `requestId` or invalid `action`
- **THEN** the handler MUST return an error with machine code `invalid_params`
- **AND** the numeric error code SHOULD be `-32602`

#### Scenario: Validation errors return structured error objects

- **GIVEN** an RPC request fails validation
- **WHEN** constructing the error response
- **THEN** the response MUST use the structured JSON-RPC error object shape
- **AND** it MUST include `error.data.errorCode`
- **AND** it MAY include a safe `error.data.details` explaining the first validation issue

#### Scenario: Prototype-chain namespace resolves to no module

- **GIVEN** an RPC request whose `type` is `__proto__.reveal` or `constructor.reveal`
- **WHEN** the router resolves the namespace
- **THEN** the router MUST return an error with machine code `unknown_namespace`
- **AND** MUST NOT invoke any inherited object property as a handler

#### Scenario: Unexpected internal errors do not leak error text

- **GIVEN** a handler throws an unexpected error while processing a request
- **WHEN** the router builds the error response
- **THEN** the response MUST include `error.data.errorCode`
- **AND** MUST NOT include the thrown error's message, stack, or stringified form in `error.data.details`

#### Scenario: New vault password below policy

- **GIVEN** a `vault.generate` or `vault.import` RPC request that would create the first key in the vault
- **WHEN** the password does not satisfy the shared password policy
- **THEN** the handler MUST return an error with machine code `invalid_password`
- **AND** MUST NOT pass the password to the service layer
- **AND** `error.data.details` MUST NOT echo the submitted password

#### Scenario: Verification password is not held to the creation policy

- **GIVEN** a `vault.unlock`, `vault.reveal` or `crypto.evaluatePassword` RPC request
- **WHEN** the password is non-empty and within the transport length limit
- **THEN** the handler MUST accept it for processing even if it is below the creation policy
- **AND** `crypto.evaluatePassword` MUST return the violations rather than an error, so the UI can explain them

#### Scenario: Missing origin on a NIP-07 method

- **GIVEN** a `nostr.getPublicKey` or `nostr.signEvent` RPC request
- **WHEN** the request omits the origin or supplies one that is not a valid HTTP or HTTPS URL
- **THEN** the handler MUST return an error with machine code `invalid_origin`
- **AND** MUST NOT read the selected key or evaluate policy

#### Scenario: Oversized event content is rejected

- **GIVEN** a `nostr.signEvent` RPC request
- **WHEN** the event `content` exceeds the maximum accepted UTF-8 byte length
- **THEN** the handler MUST return an error with machine code `invalid_event`
- **AND** MUST NOT compute an event id for the payload
- **AND** MUST NOT enqueue an approval request for the payload

#### Scenario: Oversized tag structures are rejected

- **GIVEN** a `nostr.signEvent` RPC request
- **WHEN** the event has more tags than the maximum accepted tag count
- **OR** any single tag has more elements than the maximum accepted element count
- **OR** any single tag element exceeds the maximum accepted UTF-8 byte length
- **THEN** the handler MUST return an error with machine code `invalid_event`

#### Scenario: Oversized serialized event is rejected

- **GIVEN** a `nostr.signEvent` RPC request whose individual fields are each within their limits
- **WHEN** the total serialized event exceeds the maximum accepted serialized byte length
- **THEN** the handler MUST return an error with machine code `invalid_event`

#### Scenario: Size limits are measured in UTF-8 bytes

- **GIVEN** an event whose `content` is composed of multi-byte characters
- **WHEN** the size bound is evaluated
- **THEN** the bound MUST be applied to the UTF-8 byte length
- **AND** MUST NOT be applied to the JavaScript string length

#### Scenario: Ordinary events remain accepted

- **GIVEN** a `nostr.signEvent` RPC request for a typical note, reaction, profile, relay list, or contact list event
- **WHEN** the bounded schema validates the event
- **THEN** validation MUST succeed
- **AND** the request MUST continue to policy evaluation

### Requirement: Integer-Bounded Numeric Parameters

All RPC schemas that accept a numeric value representing a discrete quantity - event kinds, minute durations, entry counts, and epoch timestamps - MUST constrain that value to an integer as well as to a range, so a fractional or non-finite value cannot reach code that compares it for equality or set membership.

#### Scenario: Fractional event kind is rejected
- **GIVEN** an RPC request carrying event kind `1.0000001`
- **WHEN** the schema validates the kind
- **THEN** validation MUST fail
- **AND** the handler MUST return a machine error code of `invalid_event` for `nostr.signEvent` or `invalid_params` for other methods

#### Scenario: Non-finite numeric value is rejected
- **GIVEN** an RPC request carrying `NaN` or `Infinity` where a discrete numeric value is expected
- **WHEN** the schema validates the value
- **THEN** validation MUST fail

#### Scenario: Numeric settings fields require integers
- **GIVEN** a `settings.update` request setting `autoLockMinutes`, `sessionTTLMinutes`, or a `mediumAllowKinds` element to a fractional value
- **WHEN** the schema validates the patch
- **THEN** validation MUST fail with machine code `invalid_params`

#### Scenario: Timestamp fields require integers
- **GIVEN** a request setting `updatedAt` or `onboardingCompletedAt` to a fractional value
- **WHEN** the schema validates the value
- **THEN** validation MUST fail with machine code `invalid_params`

#### Scenario: Valid integer values still pass
- **GIVEN** an RPC request carrying event kind `1` and `sessionTTLMinutes` of `15`
- **WHEN** the schemas validate those values
- **THEN** validation MUST succeed

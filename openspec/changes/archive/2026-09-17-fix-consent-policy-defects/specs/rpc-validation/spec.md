## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Strict Input Validation
All RPC handlers MUST validate the structure and content of incoming messages against a strict schema before processing. Numeric parameters MUST be validated for integrality and range, and origin-bearing methods MUST be validated for a well-formed origin, before any handler reads key material or evaluates policy.

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

#### Scenario: Missing origin on a NIP-07 method
- **GIVEN** a `nostr.getPublicKey` or `nostr.signEvent` RPC request
- **WHEN** the request omits the origin or supplies one that is not a valid HTTP or HTTPS URL
- **THEN** the handler MUST return an error with machine code `invalid_origin`
- **AND** MUST NOT read the selected key or evaluate policy

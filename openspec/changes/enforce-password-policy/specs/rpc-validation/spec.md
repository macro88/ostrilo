## MODIFIED Requirements

### Requirement: Strict Input Validation
All RPC handlers MUST validate the structure and content of incoming messages against a strict schema before processing. Password parameters that create a new vault password MUST be validated against the shared password policy rather than a non-empty string check, and password parameters supplied for verification MUST be validated for transport hygiene only.

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

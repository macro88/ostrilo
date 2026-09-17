## MODIFIED Requirements

### Requirement: Strict Input Validation
All RPC handlers MUST validate the structure and content of incoming messages against a strict schema before processing. Namespace resolution MUST NOT consider inherited object properties, so a caller-supplied namespace such as `__proto__` or `constructor` MUST resolve to no module. Error responses MUST NOT carry raw internal error text: `error.data.details` MUST be either omitted or a fixed, caller-safe string chosen by the handler.

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

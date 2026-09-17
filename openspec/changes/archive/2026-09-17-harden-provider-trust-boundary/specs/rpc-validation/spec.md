## MODIFIED Requirements

### Requirement: Strict Input Validation

All RPC handlers MUST validate the structure and content of incoming messages against a strict schema before processing. Unsigned event payloads MUST additionally be bounded in size so that oversized payloads are rejected before any hashing, signing, or approval work is performed.

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

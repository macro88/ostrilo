## MODIFIED Requirements

### Requirement: Get Public Key

The extension SHALL provide a `window.nostr.getPublicKey()` method that returns the currently selected public key only to origins the user has consented to, and SHALL evaluate per-origin consent for the origin supplied by the content script before disclosing the key.

#### Scenario: Successful retrieval when unlocked and consented
- **GIVEN** the vault is unlocked with at least one key
- **AND** the requesting origin has a recorded identity-disclosure grant
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the method SHALL return a Promise
- **AND** the Promise SHALL resolve to a 64-character hex string (32-byte public key)
- **AND** the disclosure SHALL be recorded in the activity log

#### Scenario: First call from an unconsented origin prompts
- **GIVEN** the vault is unlocked with at least one key
- **AND** the requesting origin has no recorded identity-disclosure decision
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the extension SHALL queue a user approval request for identity disclosure
- **AND** the Promise SHALL NOT resolve with the public key before the user decides

#### Scenario: Error when consent is denied
- **GIVEN** the vault is unlocked with at least one key
- **AND** the requesting origin is denied identity disclosure by a recorded decision or by the user's answer to the prompt
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the Promise SHALL reject with error message containing "denied"
- **AND** the public key SHALL NOT be returned

#### Scenario: Error when origin is missing or invalid
- **GIVEN** the vault is unlocked with at least one key
- **WHEN** a `nostr.getPublicKey` request reaches the background without a valid HTTP or HTTPS origin
- **THEN** the Promise SHALL reject with error message containing "invalid_origin"
- **AND** the public key SHALL NOT be returned

#### Scenario: Error when locked
- **GIVEN** the vault is locked
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the Promise SHALL reject with error message containing "locked"
- **AND** no consent prompt SHALL be shown

#### Scenario: Error when no keys exist
- **GIVEN** no keys have been imported or generated
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the Promise SHALL reject with error message containing "no_key"

### Requirement: Pending Request Queue

The extension SHALL maintain a queue of signing requests with event de-duplication keyed by the requesting origin together with the computed event ID hash, so an approval shown for one origin can never satisfy a request from a different origin.

#### Scenario: Event de-duplication by origin and hash
- **GIVEN** an unsigned event requiring approval is received
- **WHEN** the event ID hash is computed per NIP-01
- **AND** a pending request from the same origin with the same event ID hash already exists in the queue
- **THEN** the new request SHALL NOT be added to the queue
- **AND** the existing pending Promise SHALL be returned to the new caller
- **AND** both callers SHALL receive the same result when the event is approved or denied

#### Scenario: Duplicate detection across origins
- **GIVEN** two signing requests for identical events from different origins
- **WHEN** both requests compute to the same event ID hash
- **THEN** each origin SHALL get its own approval entry in the queue
- **AND** the approval UI SHALL display each requesting origin separately
- **AND** resolving one origin's approval SHALL NOT resolve the other origin's request
- **AND** a signature SHALL be returned only to an origin whose own approval was granted

#### Scenario: Event ID computation before enqueueing
- **GIVEN** a signing request requires approval
- **WHEN** the background script processes the request
- **THEN** the event ID hash SHALL be computed immediately after policy evaluation
- **AND** the hash SHALL be passed to the approval queue service together with the request origin
- **AND** the queue service SHALL check for duplicates using the origin and hash together before creating a new entry

#### Scenario: Queue cleanup on resolution
- **GIVEN** a pending request is resolved
- **WHEN** the request is removed from the queue
- **THEN** the origin and event ID hash mapping SHALL also be removed
- **AND** subsequent requests with the same origin and event ID SHALL be treated as new

#### Scenario: Queue cleanup on timeout
- **GIVEN** a pending request times out
- **WHEN** the timeout handler executes
- **THEN** the request SHALL be removed from both the UUID queue and the origin-scoped event ID hash map
- **AND** the dApp SHALL receive a timeout error
- **AND** subsequent requests with the same origin and event ID SHALL be allowed

#### Scenario: Queue state inspection
- **GIVEN** requests are pending in the queue
- **WHEN** the approval UI requests the full queue state via `approval.getAll` RPC
- **THEN** the service SHALL return an array of all pending requests
- **AND** each entry SHALL include request ID, origin, unsigned event, remaining timeout, and event ID hash
- **AND** the array SHALL be ordered by queue insertion time

#### Scenario: Multiple requests from same origin - no duplicates
- **GIVEN** a dApp sends three unique signing requests
- **WHEN** all three requests require approval
- **THEN** all three SHALL appear as separate entries in the queue
- **AND** SHALL be grouped under the same origin in the UI
- **AND** SHALL each have independent countdown timers

### Requirement: Message Security

The extension SHALL maintain security boundaries between page context, content script, and background script, and SHALL bind every forwarded NIP-07 method to the origin observed by the content script.

#### Scenario: Content script isolation
- **WHEN** processing messages from page context
- **THEN** the content script SHALL validate message format before forwarding
- **AND** SHALL only forward recognized message types (getPublicKey, signEvent)
- **AND** SHALL include the page origin in every forwarded message, including `getPublicKey`
- **AND** SHALL take the origin from the content-script context rather than from page-supplied data

#### Scenario: Background validation
- **WHEN** the background script receives a signing request or a public-key request
- **THEN** it SHALL validate the event structure using Zod schemas
- **AND** SHALL validate the supplied origin before any key material is read
- **AND** SHALL evaluate policy using the provided origin for both `getPublicKey` and `signEvent`
- **AND** SHALL NOT trust any pre-computed id or sig from the request

#### Scenario: Message channel uniqueness
- **WHEN** communicating between injected script and content script
- **THEN** messages SHALL use prefix `OSTRILO_NIP07_` to avoid collision
- **AND** SHALL include unique request IDs for correlation

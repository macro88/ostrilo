# nip07-provider Specification

## Purpose
TBD - created by archiving change add-nip07-provider. Update Purpose after archive.
## Requirements
### Requirement: Window Nostr Object Injection

The extension SHALL inject a `window.nostr` object into web page contexts that implements the NIP-07 interface.

#### Scenario: Object available on page load
- **WHEN** a web page loads with the extension installed and enabled
- **THEN** `window.nostr` SHALL be defined and accessible to page scripts
- **AND** `window.nostr` SHALL have `getPublicKey` method
- **AND** `window.nostr` SHALL have `signEvent` method

#### Scenario: Injection timing
- **WHEN** content script injection is configured
- **THEN** the `window.nostr` object SHALL be available before DOMContentLoaded
- **AND** page scripts can reliably access it during initialization

#### Scenario: Conflict with existing provider
- **WHEN** `window.nostr` is already defined by another extension
- **THEN** Ostrilo SHALL NOT override the existing object
- **AND** SHALL log a warning to the console

---

### Requirement: Get Public Key

The extension SHALL provide a `window.nostr.getPublicKey()` method that returns the currently selected public key.

#### Scenario: Successful retrieval when unlocked
- **GIVEN** the vault is unlocked with at least one key
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the method SHALL return a Promise
- **AND** the Promise SHALL resolve to a 64-character hex string (32-byte public key)

#### Scenario: Error when locked
- **GIVEN** the vault is locked
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the Promise SHALL reject with error message containing "locked"

#### Scenario: Error when no keys exist
- **GIVEN** no keys have been imported or generated
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the Promise SHALL reject with error message containing "no_key"

---

### Requirement: Sign Event

The extension SHALL provide a `window.nostr.signEvent(event)` method that signs Nostr events per NIP-01.

#### Scenario: Successful signing when allowed
- **GIVEN** the vault is unlocked
- **AND** the origin has policy allowing the event kind (via trust level, explicit rule, or session grant)
- **WHEN** a dApp calls `window.nostr.signEvent(event)` with a valid unsigned event
- **THEN** the method SHALL return a Promise resolving to a signed event object
- **AND** the signed event SHALL include the original fields (kind, content, tags, created_at)
- **AND** the signed event SHALL include `pubkey` set to the selected key's public key
- **AND** the signed event SHALL include `id` computed per NIP-01 (SHA-256 of serialized event)
- **AND** the signed event SHALL include `sig` as a valid Schnorr signature

#### Scenario: Error when locked
- **GIVEN** the vault is locked
- **WHEN** a dApp calls `window.nostr.signEvent(event)`
- **THEN** the Promise SHALL reject with error message containing "locked"

#### Scenario: Error when policy denies
- **GIVEN** the vault is unlocked
- **AND** the origin has an explicit deny rule for the event kind
- **WHEN** a dApp calls `window.nostr.signEvent(event)`
- **THEN** the Promise SHALL reject with error message containing "denied"

#### Scenario: Error when policy requires approval
- **GIVEN** the vault is unlocked
- **AND** policy evaluation returns "ask" for the origin and kind
- **WHEN** a dApp calls `window.nostr.signEvent(event)`
- **THEN** the Promise SHALL reject with error message containing "needs_approval"
- **AND** the error message SHALL indicate the user should adjust trust settings

#### Scenario: Invalid event format
- **WHEN** a dApp calls `window.nostr.signEvent(event)` with invalid event structure
- **THEN** the Promise SHALL reject with error message containing "invalid_event"

---

### Requirement: Event ID Computation

The extension SHALL compute event IDs per NIP-01 specification.

#### Scenario: Correct serialization
- **GIVEN** an unsigned event with kind, content, tags, and created_at
- **WHEN** computing the event ID
- **THEN** the extension SHALL serialize as JSON array: `[0, pubkey, created_at, kind, tags, content]`
- **AND** SHALL compute SHA-256 hash of the UTF-8 encoded JSON string
- **AND** SHALL return the hash as a 64-character lowercase hex string

#### Scenario: Deterministic output
- **GIVEN** the same event fields and pubkey
- **WHEN** computing the event ID multiple times
- **THEN** the result SHALL be identical each time

---

### Requirement: Message Security

The extension SHALL maintain security boundaries between page context, content script, and background script.

#### Scenario: Content script isolation
- **WHEN** processing messages from page context
- **THEN** the content script SHALL validate message format before forwarding
- **AND** SHALL only forward recognized message types (getPublicKey, signEvent)
- **AND** SHALL include the page origin in forwarded messages

#### Scenario: Background validation
- **WHEN** the background script receives a signing request
- **THEN** it SHALL validate the event structure using Zod schemas
- **AND** SHALL evaluate policy using the provided origin
- **AND** SHALL NOT trust any pre-computed id or sig from the request

#### Scenario: Message channel uniqueness
- **WHEN** communicating between injected script and content script
- **THEN** messages SHALL use prefix `OSTRILO_NIP07_` to avoid collision
- **AND** SHALL include unique request IDs for correlation

---

### Requirement: Error Handling

The extension SHALL return consistent, informative error messages.

#### Scenario: Standard error codes
- **WHEN** an error occurs during NIP-07 operations
- **THEN** the error message SHALL contain one of: `locked`, `denied`, `needs_approval`, `invalid_event`, `no_key`, `timeout`

#### Scenario: Timeout handling
- **GIVEN** a NIP-07 request is made
- **WHEN** no response is received within 10 seconds
- **THEN** the Promise SHALL reject with error containing "timeout"

### Requirement: Approval Prompt Display

The extension SHALL display a managed approval window for signing requests requiring user decision, with intelligent queue management and de-duplication.

#### Scenario: Single window instance
- **GIVEN** signing requests require approval
- **WHEN** multiple requests are queued
- **THEN** only one approval window SHALL be created
- **AND** new requests SHALL focus the existing window instead of creating duplicates
- **AND** the window SHALL update to show all pending requests

#### Scenario: Queue list display
- **GIVEN** the approval window is open with pending requests
- **THEN** the window SHALL display all pending requests in a scrollable list
- **AND** SHALL group requests by origin domain
- **AND** each group SHALL be collapsible with a request count badge
- **AND** each request item SHALL show origin favicon, event kind, timestamp, and truncated content preview

#### Scenario: Full event detail view
- **GIVEN** a pending request is displayed in the queue list
- **WHEN** the user selects a request to sign it
- **THEN** a detailed view SHALL be displayed showing complete event information
- **AND** SHALL display the origin domain
- **AND** SHALL display the event kind number and human-readable name
- **AND** SHALL display the created_at timestamp in readable format
- **AND** SHALL display the complete event content
- **AND** SHALL display the full tags array in formatted JSON or structured view
- **AND** SHALL display the signing key that will be used
- **AND** the detailed view SHALL allow the user to approve or deny the specific event
- **AND** after approval or denial, SHALL return to queue list or show the next pending request

#### Scenario: Batch action buttons
- **GIVEN** the approval window displays multiple pending requests
- **THEN** each origin group SHALL show an "Approve All from [origin]" button
- **AND** the window SHALL show a global "Deny All" button
- **AND** batch actions SHALL resolve all targeted requests with the appropriate action

#### Scenario: Window lifecycle - focus existing
- **GIVEN** an approval window is already open
- **WHEN** a new signing request requiring approval is queued
- **THEN** the existing window SHALL gain focus
- **AND** the badge count SHALL update to reflect the new queue size
- **AND** no new window SHALL be created

#### Scenario: Window lifecycle - auto-close on empty queue
- **GIVEN** an approval window is open with pending requests
- **WHEN** the last pending request is resolved
- **THEN** the approval window SHALL automatically close
- **AND** the window ID tracking SHALL be cleared

#### Scenario: Window lifecycle - user closes window
- **GIVEN** pending requests exist in the queue
- **WHEN** the user closes the approval window manually
- **THEN** pending requests SHALL remain in the queue
- **AND** SHALL be accessible from the Activity page in the main popup
- **AND** SHALL timeout according to their individual countdown timers

#### Scenario: Queue visibility in Activity page
- **GIVEN** pending approval requests exist
- **WHEN** the user opens the Activity tab in the main popup
- **THEN** a "Pending Approvals" section SHALL be displayed
- **AND** SHALL show the count of pending requests
- **AND** SHALL provide an "Open Approval Window" button
- **AND** clicking the button SHALL open or focus the approval window

#### Scenario: Countdown timer per request
- **GIVEN** the approval window displays pending requests
- **THEN** each request SHALL show its individual countdown timer
- **AND** the timer SHALL count down from remaining time
- **AND** requests SHALL timeout independently according to their timers

---

### Requirement: Pending Request Queue

The extension SHALL maintain a queue of signing requests with event de-duplication by computed event ID hash.

#### Scenario: Event de-duplication by hash
- **GIVEN** an unsigned event requiring approval is received
- **WHEN** the event ID hash is computed per NIP-01
- **AND** a pending request with the same event ID hash already exists in the queue
- **THEN** the new request SHALL NOT be added to the queue
- **AND** the existing pending Promise SHALL be returned to the new caller
- **AND** both callers SHALL receive the same result when the event is approved or denied

#### Scenario: Duplicate detection across origins
- **GIVEN** two signing requests for identical events from different origins
- **WHEN** both requests compute to the same event ID hash
- **THEN** only one approval entry SHALL appear in the queue
- **AND** the first origin to request SHALL be displayed in the approval UI
- **AND** resolving the approval SHALL fulfill both requests

#### Scenario: Event ID computation before enqueueing
- **GIVEN** a signing request requires approval
- **WHEN** the background script processes the request
- **THEN** the event ID hash SHALL be computed immediately after policy evaluation
- **AND** the hash SHALL be passed to the approval queue service
- **AND** the queue service SHALL check for duplicates before creating a new entry

#### Scenario: Queue cleanup on resolution
- **GIVEN** a pending request is resolved
- **WHEN** the request is removed from the queue
- **THEN** the event ID hash mapping SHALL also be removed
- **AND** subsequent requests with the same event ID SHALL be treated as new

#### Scenario: Queue cleanup on timeout
- **GIVEN** a pending request times out
- **WHEN** the timeout handler executes
- **THEN** the request SHALL be removed from both the UUID queue and event ID hash map
- **AND** the dApp SHALL receive a timeout error
- **AND** subsequent requests with the same event ID SHALL be allowed

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

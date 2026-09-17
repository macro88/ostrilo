## MODIFIED Requirements

### Requirement: Window Nostr Object Injection

The extension SHALL inject a `window.nostr` object into HTTPS web page contexts that implements the NIP-07 interface, using a non-writable, non-configurable property descriptor.

#### Scenario: Object available on page load
- **WHEN** an HTTPS web page loads with the extension installed and enabled
- **THEN** `window.nostr` SHALL be defined and accessible to page scripts
- **AND** `window.nostr` SHALL have `getPublicKey` method
- **AND** `window.nostr` SHALL have `signEvent` method
- **AND** `window.nostr` SHALL NOT expose `nip04` or `nip44`

#### Scenario: Plaintext page receives no object
- **WHEN** a page served over `http://` loads with the extension installed and enabled
- **THEN** the content script SHALL NOT run
- **AND** `window.nostr` SHALL be undefined

#### Scenario: Injection timing
- **WHEN** content script injection is configured
- **THEN** the `window.nostr` object SHALL be available before DOMContentLoaded
- **AND** page scripts can reliably access it during initialization

#### Scenario: Property cannot be replaced by the page
- **GIVEN** `window.nostr` has been defined by the extension
- **WHEN** a page script assigns to `window.nostr`, redefines it, or deletes it
- **THEN** the operation SHALL NOT replace the extension's provider
- **AND** the provider object and its methods SHALL be frozen against modification

#### Scenario: Conflict with existing provider
- **WHEN** `window.nostr` is already defined by another extension
- **THEN** Ostrilo SHALL NOT override the existing object
- **AND** SHALL log a warning to the console
- **AND** SHALL NOT throw an uncaught error when the existing property is non-configurable

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
- **AND** the extension SHALL NOT open the unlock popup in response to the call
- **AND** the locked state SHALL be signalled on the toolbar action instead

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
- **AND** the extension SHALL NOT open the unlock popup in response to the call

#### Scenario: Error when policy denies
- **GIVEN** the vault is unlocked
- **AND** the origin has an explicit deny rule for the event kind
- **WHEN** a dApp calls `window.nostr.signEvent(event)`
- **THEN** the Promise SHALL reject with error message containing "denied"

#### Scenario: Request queued when policy requires approval
- **GIVEN** the vault is unlocked
- **AND** policy evaluation returns "ask" for the origin and kind
- **WHEN** a dApp calls `window.nostr.signEvent(event)`
- **THEN** the request SHALL be enqueued for user approval
- **AND** the Promise SHALL remain pending until the user decides or the extension-side approval deadline elapses
- **AND** the page-side deadline SHALL NOT be shorter than the extension-side approval deadline

#### Scenario: Error when approval cannot be queued
- **GIVEN** the vault is unlocked
- **AND** policy evaluation returns "ask" for the origin and kind
- **AND** no approval queue is configured
- **WHEN** a dApp calls `window.nostr.signEvent(event)`
- **THEN** the Promise SHALL reject with error message containing "needs_approval"

#### Scenario: Error when the origin is flooding the queue
- **GIVEN** the vault is unlocked
- **AND** the origin has exceeded its approval enqueue rate limit or pending capacity
- **WHEN** a dApp calls `window.nostr.signEvent(event)` for an event requiring approval
- **THEN** the Promise SHALL reject with error message containing "rate_limited"

#### Scenario: Invalid event format
- **WHEN** a dApp calls `window.nostr.signEvent(event)` with invalid event structure
- **THEN** the Promise SHALL reject with error message containing "invalid_event"

#### Scenario: Oversized event rejected before hashing
- **WHEN** a dApp calls `window.nostr.signEvent(event)` with content, tags, or a serialized event exceeding the accepted size bounds
- **THEN** the Promise SHALL reject with error message containing "invalid_event"
- **AND** the extension SHALL NOT compute an event id for the oversized payload
- **AND** the extension SHALL NOT create an approval entry for it

---

### Requirement: Event ID Computation

The extension SHALL compute event IDs per NIP-01 specification, only for events that have passed size and structure validation.

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

#### Scenario: Validation precedes computation
- **GIVEN** an unsigned event received from a page
- **WHEN** the background script handles the signing request
- **THEN** it SHALL validate the event against the bounded schema before computing the event id
- **AND** SHALL NOT hash a payload that failed validation

---

### Requirement: Message Security

The extension SHALL maintain security boundaries between page context, content script, and background script. No security-critical decision SHALL be taken in the page realm.

#### Scenario: Content script isolation
- **WHEN** processing messages from page context
- **THEN** the content script SHALL validate message format before forwarding
- **AND** SHALL only forward recognized message types (getPublicKey, signEvent)
- **AND** SHALL construct the RPC request itself rather than forwarding a caller-supplied request type
- **AND** SHALL include the page origin taken from `window.location.origin` in forwarded messages
- **AND** SHALL ignore any origin value supplied in the page message

#### Scenario: Message acceptance checks
- **WHEN** the content script receives a `message` event
- **THEN** it SHALL ignore the event unless `source` is `window`
- **AND** SHALL ignore the event unless `origin` equals `window.location.origin`
- **AND** SHALL ignore the event unless the message type and a string request id are present

#### Scenario: Background validation
- **WHEN** the background script receives a signing request
- **THEN** it SHALL validate the event structure using Zod schemas
- **AND** SHALL evaluate policy using the provided origin
- **AND** SHALL NOT trust any pre-computed id or sig from the request

#### Scenario: Message channel uniqueness
- **WHEN** communicating between injected script and content script
- **THEN** messages SHALL use the `OSTRILO_NOSTR_` type prefix to avoid collision
- **AND** SHALL include unique request IDs for correlation
- **AND** request IDs SHALL be generated with `crypto.randomUUID()`

#### Scenario: Response targeting
- **WHEN** the content script posts a response back to the page
- **THEN** the `targetOrigin` SHALL be the page's own origin
- **AND** SHALL NOT be `"*"`

#### Scenario: Page messages cannot drive extension UI
- **WHEN** the content script or background script receives a message that originated in a page realm
- **THEN** it SHALL NOT open, focus, or create any extension popup or window as a result
- **AND** the approval window SHALL only be opened as a consequence of a policy decision that requires approval

---

### Requirement: Error Handling

The extension SHALL return consistent, informative error messages.

#### Scenario: Standard error codes
- **WHEN** an error occurs during NIP-07 operations
- **THEN** the error message SHALL contain one of: `locked`, `denied`, `needs_approval`, `invalid_event`, `no_key`, `rate_limited`, `timeout`

#### Scenario: Timeout handling
- **GIVEN** a NIP-07 signing request that requires approval
- **WHEN** the extension-side approval deadline elapses without a user decision
- **THEN** the request SHALL be auto-denied by the approval queue
- **AND** the Promise SHALL reject with error containing "timeout"

#### Scenario: Page-side deadline is a backstop only
- **GIVEN** a NIP-07 request is in flight
- **WHEN** the page-side backstop deadline elapses before any extension response
- **THEN** the Promise SHALL reject with error containing "timeout"
- **AND** the queued request SHALL be cancelled so no signature is produced for it afterwards

#### Scenario: Locked errors carry no UI side effect
- **WHEN** a NIP-07 operation fails with `locked`
- **THEN** the error SHALL be returned to the page
- **AND** no extension popup or window SHALL be opened as part of returning that error

---

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
- **WHEN** the queue list is rendered
- **THEN** the window SHALL display all pending requests in a scrollable list
- **AND** SHALL group requests by full origin including scheme
- **AND** each group SHALL be collapsible with a request count badge
- **AND** each request item SHALL show a site glyph, event kind, timestamp, and a truncated content preview whose invisible and direction-control characters are escaped

#### Scenario: Full event detail view
- **GIVEN** a pending request is displayed in the queue list
- **WHEN** the user selects a request to sign it
- **THEN** a detailed view SHALL be displayed showing complete event information
- **AND** SHALL display the full requesting origin including scheme and any non-default port, without visual truncation
- **AND** SHALL flag the origin when it is not HTTPS
- **AND** SHALL display the event kind number and human-readable name
- **AND** SHALL display the created_at timestamp in readable format
- **AND** SHALL display the complete event content with its UTF-8 byte size and with invisible and direction-control characters escaped
- **AND** SHALL display the full tags array in formatted JSON or structured view, with tag count and total tag byte size
- **AND** SHALL display the signing key bound to the pending request
- **AND** the detailed view SHALL allow the user to approve or deny the specific event
- **AND** after approval or denial, SHALL return to the queue list without automatically binding the approve action to another request

#### Scenario: Batch action buttons
- **GIVEN** the approval window displays multiple pending requests
- **WHEN** the approval inbox is displayed
- **THEN** each origin group SHALL show a "Deny all from [origin]" button
- **AND** the window SHALL show a global "Deny All" button
- **AND** the window SHALL NOT offer any action that approves multiple requests without opening each request's detail view
- **AND** batch deny actions SHALL resolve all targeted requests as denied

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
- **WHEN** the queue list is rendered
- **THEN** each request SHALL show its individual countdown timer
- **AND** the timer SHALL count down from remaining time
- **AND** requests SHALL timeout independently according to their timers

---

### Requirement: Pending Request Queue

The extension SHALL maintain a queue of signing requests with event de-duplication by computed event ID hash, bounded per-origin and global capacity, and a per-origin enqueue rate limit.

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

#### Scenario: Signing key bound at enqueue time
- **GIVEN** a signing request requires approval
- **WHEN** the queue entry is created
- **THEN** the pending request SHALL record the signing public key used to compute the event ID hash
- **AND** resolving the request as allowed SHALL sign with that recorded key

#### Scenario: Capacity limits reject further enqueues
- **GIVEN** the queue is at its per-origin or global pending capacity
- **WHEN** a further distinct request requiring approval arrives
- **THEN** the queue SHALL refuse the enqueue
- **AND** the caller SHALL receive the `rate_limited` error code

#### Scenario: Queue cleanup on resolution
- **GIVEN** a pending request is resolved
- **WHEN** the request is removed from the queue
- **THEN** the event ID hash mapping SHALL also be removed
- **AND** the per-origin pending count SHALL be decremented
- **AND** subsequent requests with the same event ID SHALL be treated as new

#### Scenario: Queue cleanup on timeout
- **GIVEN** a pending request times out
- **WHEN** the timeout handler executes
- **THEN** the request SHALL be removed from both the UUID queue and event ID hash map
- **AND** the per-origin pending count SHALL be decremented
- **AND** the dApp SHALL receive a timeout error
- **AND** subsequent requests with the same event ID SHALL be allowed

#### Scenario: Queue state inspection
- **GIVEN** requests are pending in the queue
- **WHEN** the approval UI requests the full queue state via `approval.getAll` RPC
- **THEN** the service SHALL return an array of all pending requests
- **AND** each entry SHALL include request ID, origin, unsigned event, remaining timeout, event ID hash, and bound signing public key
- **AND** the array SHALL be ordered by queue insertion time

#### Scenario: Multiple requests from same origin - no duplicates
- **GIVEN** a dApp sends three unique signing requests
- **WHEN** all three requests require approval
- **AND** the origin is within its rate limit and pending capacity
- **THEN** all three SHALL appear as separate entries in the queue
- **AND** SHALL be grouped under the same origin in the UI
- **AND** SHALL each have independent countdown timers

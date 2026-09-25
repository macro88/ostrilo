# NIP-07 Provider - Approval Prompt Modifications

Modifies the NIP-07 provider to show an interactive approval prompt when policy evaluates to `ask`.

## MODIFIED Requirements

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

#### Scenario: Approval prompt when policy requires approval
- **GIVEN** the vault is unlocked
- **AND** policy evaluation returns "ask" for the origin and kind
- **WHEN** a dApp calls `window.nostr.signEvent(event)`
- **THEN** an approval prompt popup SHALL open
- **AND** the popup SHALL display the requesting origin
- **AND** the popup SHALL display the event kind with human-readable name
- **AND** the popup SHALL display a preview of the event content
- **AND** the popup SHALL display which key will be used for signing
- **AND** the Promise SHALL remain pending until user decides or timeout

#### Scenario: User approves signing request
- **GIVEN** an approval prompt is displayed for a signing request
- **WHEN** the user clicks "Allow" or "Allow Once"
- **THEN** the event SHALL be signed and returned to the dApp
- **AND** the approval popup SHALL close
- **AND** no policy changes SHALL be made

#### Scenario: User denies signing request
- **GIVEN** an approval prompt is displayed for a signing request
- **WHEN** the user clicks "Deny"
- **THEN** the Promise SHALL reject with error message containing "denied"
- **AND** the approval popup SHALL close
- **AND** no policy changes SHALL be made

#### Scenario: User denies with remember
- **GIVEN** an approval prompt is displayed for a signing request
- **WHEN** the user clicks "Deny + Remember"
- **THEN** the Promise SHALL reject with error message containing "denied"
- **AND** the approval popup SHALL close
- **AND** a deny rule SHALL be created for the origin and event kind
- **AND** future requests for the same origin and kind SHALL be auto-denied

#### Scenario: Approval timeout
- **GIVEN** an approval prompt is displayed for a signing request
- **WHEN** 60 seconds pass without user action
- **THEN** the Promise SHALL reject with error message containing "timeout"
- **AND** the approval popup SHALL close

#### Scenario: Invalid event format
- **WHEN** a dApp calls `window.nostr.signEvent(event)` with invalid event structure
- **THEN** the Promise SHALL reject with error message containing "invalid_event"

---

## ADDED Requirements

### Requirement: Approval Prompt Display

The extension SHALL display an approval prompt popup for signing requests requiring user decision.

#### Scenario: Prompt content display
- **GIVEN** a signing request requires approval
- **WHEN** the approval prompt opens
- **THEN** the popup SHALL display the origin domain (e.g., "primal.net")
- **AND** SHALL display the origin favicon if available
- **AND** SHALL display the event kind number and human-readable name
- **AND** SHALL display a truncated preview of event content (max 200 characters)
- **AND** SHALL display the public key that will sign (truncated with copy option)

#### Scenario: Action buttons
- **GIVEN** an approval prompt is displayed
- **THEN** the popup SHALL show "Allow" button
- **AND** SHALL show "Allow Once" button
- **AND** SHALL show "Deny" button
- **AND** SHALL show "Deny + Remember" button

#### Scenario: Countdown timer
- **GIVEN** an approval prompt is displayed
- **THEN** the popup SHALL show remaining time until auto-deny
- **AND** the timer SHALL count down from 60 seconds

#### Scenario: Multiple pending requests
- **GIVEN** multiple signing requests are pending approval
- **WHEN** the approval prompt is displayed
- **THEN** the popup SHALL show the count of pending requests
- **AND** SHALL process requests in FIFO order (oldest first)

---

### Requirement: Pending Request Queue

The extension SHALL maintain a queue of signing requests awaiting user approval.

#### Scenario: Request queuing
- **GIVEN** a signing request requires approval
- **WHEN** no approval prompt is currently displayed
- **THEN** the request SHALL be added to the pending queue
- **AND** an approval popup SHALL open

#### Scenario: Request ordering
- **GIVEN** multiple requests are added to the queue
- **WHEN** processing pending requests
- **THEN** requests SHALL be processed in FIFO order (first in, first out)

#### Scenario: Queue persistence during popup lifecycle
- **GIVEN** requests are pending in the queue
- **WHEN** the user closes the approval popup without deciding
- **THEN** the pending request SHALL timeout after the remaining time
- **AND** the next pending request SHALL be displayed in a new popup

#### Scenario: Request cleanup on timeout
- **GIVEN** a request has been pending for 60 seconds
- **WHEN** the timeout elapses
- **THEN** the request SHALL be removed from the queue
- **AND** the dApp SHALL receive a timeout error

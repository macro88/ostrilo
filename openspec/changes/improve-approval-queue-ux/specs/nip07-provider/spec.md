## MODIFIED Requirements

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
- **THEN** the window SHALL display all pending requests in a scrollable list (inbox-style)
- **AND** SHALL group requests by origin domain
- **AND** each group SHALL be collapsible with a request count badge
- **AND** each request item SHALL show origin favicon, event kind, timestamp, and truncated content preview

#### Scenario: Full event detail view
- **GIVEN** a pending request is displayed in the queue list
- **WHEN** the user selects/clicks a request to sign it
- **THEN** a detailed view SHALL be displayed showing complete event information
- **AND** SHALL display the origin domain (envelope header style)
- **AND** SHALL display the event kind number and human-readable name
- **AND** SHALL display the created_at timestamp in readable format
- **AND** SHALL display the complete event content (not truncated)
- **AND** SHALL display the full tags array in formatted JSON or structured view
- **AND** SHALL display the signing key (pubkey) that will be used
- **AND** the detailed view SHALL allow the user to approve or deny the specific event
- **AND** after approval/denial, SHALL return to queue list or show next pending request

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
- **WHEN** the last pending request is resolved (approved or denied)
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
- **AND** the timer SHALL count down from remaining time (60 seconds minus elapsed)
- **AND** requests SHALL timeout independently according to their timers

---

### Requirement: Pending Request Queue

The extension SHALL maintain a queue of signing requests with event de-duplication by computed event ID hash.

#### Scenario: Event de-duplication by hash
- **GIVEN** an unsigned event requiring approval is received
- **WHEN** the event ID hash is computed (per NIP-01: SHA-256 of [0, pubkey, created_at, kind, tags, content])
- **AND** a pending request with the same event ID hash already exists in the queue
- **THEN** the new request SHALL NOT be added to the queue
- **AND** the existing pending Promise SHALL be returned to the new caller
- **AND** both callers SHALL receive the same result when the event is approved or denied

#### Scenario: Duplicate detection across origins
- **GIVEN** two signing requests for identical events from different origins (origin-a and origin-b)
- **WHEN** both requests compute to the same event ID hash
- **THEN** only one approval entry SHALL appear in the queue
- **AND** the first origin to request SHALL be displayed in the approval UI
- **AND** resolving the approval SHALL fulfill both requests

#### Scenario: Event ID computation before enqueueing
- **GIVEN** a signing request requires approval (policy returns "ask")
- **WHEN** the background script processes the request
- **THEN** the event ID hash SHALL be computed immediately after policy evaluation
- **AND** the hash SHALL be passed to the approval queue service
- **AND** the queue service SHALL check for duplicates before creating a new entry

#### Scenario: Queue cleanup on resolution
- **GIVEN** a pending request is resolved (approved or denied)
- **WHEN** the request is removed from the queue
- **THEN** the event ID hash mapping SHALL also be removed
- **AND** subsequent requests with the same event ID SHALL be treated as new (not duplicates)

#### Scenario: Queue cleanup on timeout
- **GIVEN** a pending request times out after 60 seconds
- **WHEN** the timeout handler executes
- **THEN** the request SHALL be removed from both the UUID queue and event ID hash map
- **AND** the dApp SHALL receive a timeout error
- **AND** subsequent requests with the same event ID SHALL be allowed (retry scenario)

#### Scenario: Queue state inspection
- **GIVEN** requests are pending in the queue
- **WHEN** the approval UI requests the full queue state via `approval.getAll` RPC
- **THEN** the service SHALL return an array of all pending requests
- **AND** each entry SHALL include: request ID, origin, unsigned event, remaining timeout, event ID hash
- **AND** the array SHALL be ordered by queue insertion time (FIFO)

#### Scenario: Multiple requests from same origin - no duplicates
- **GIVEN** a dApp sends three unique signing requests (different content or created_at)
- **WHEN** all three requests require approval
- **THEN** all three SHALL appear as separate entries in the queue
- **AND** SHALL be grouped under the same origin in the UI
- **AND** SHALL each have independent countdown timers

---

## REMOVED Requirements

### Requirement: Approval Prompt Display - Multiple pending requests scenario

**Removed scenario:**
```markdown
#### Scenario: Multiple pending requests
- **GIVEN** multiple signing requests are pending approval
- **WHEN** the approval prompt is displayed
- **THEN** the popup SHALL show the count of pending requests
- **AND** SHALL process requests in FIFO order (oldest first)
```

**Reason:** This scenario is replaced by the new "Queue list display" scenario which provides full queue visibility instead of just a count. The new approach shows all pending requests simultaneously rather than processing them one-at-a-time.

**Migration:** Existing behavior of showing pending count is preserved but enhanced. Instead of displaying count only with single-request view, users now see the full list of all pending requests grouped by origin.

---

### Requirement: Pending Request Queue - Request queuing scenario

**Removed scenario:**
```markdown
#### Scenario: Request queuing
- **GIVEN** a signing request requires approval
- **WHEN** no approval prompt is currently displayed
- **THEN** the request SHALL be added to the pending queue
- **AND** an approval popup SHALL open
```

**Reason:** Behavior refined to focus/reuse existing window instead of always opening new popup. The fundamental queuing behavior remains but window management is more sophisticated.

**Migration:** Core queuing logic unchanged. Window creation logic updated to check for existing window first. No API changes visible to dApps.

---

### Requirement: Pending Request Queue - Queue persistence during popup lifecycle scenario

**Removed scenario:**
```markdown
#### Scenario: Queue persistence during popup lifecycle
- **GIVEN** requests are pending in the queue
- **WHEN** the user closes the approval popup without deciding
- **THEN** the pending request SHALL timeout after the remaining time
- **AND** the next pending request SHALL be displayed in a new popup
```

**Reason:** Replaced with improved behavior where closing window keeps queue intact and accessible via Activity page. Requests no longer automatically create new popups after window close.

**Migration:** Users can now close approval window without triggering new popups. Pending requests remain accessible from Activity tab with "Open Approval Window" button. Individual timeout behavior preserved.

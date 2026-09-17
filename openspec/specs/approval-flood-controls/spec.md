# approval-flood-controls Specification

## Purpose

Protects the approval queue from being flooded by a hostile origin, and protects the user from approving a request they never read. Covers per-origin enqueue rate limits, queue capacity caps, the absence of bulk-approve affordances, and the cooldown that follows a detail-view rebind.

## Requirements

### Requirement: Per-Origin Enqueue Rate Limit

The approval queue SHALL limit how many new approval requests a single origin can enqueue within a rolling time window. Requests that exceed the limit SHALL be rejected with the `rate_limited` error code and SHALL NOT create a queue entry or a user-visible prompt.

#### Scenario: Burst beyond the window limit is rejected

- **GIVEN** the per-origin limit is 10 new approval requests per 60 seconds
- **AND** `https://example.com` has already enqueued 10 distinct requests in the current window
- **WHEN** `https://example.com` requests signing for an eleventh distinct event
- **THEN** the request SHALL be rejected with the `rate_limited` error code
- **AND** no new queue entry SHALL be created
- **AND** no additional approval prompt SHALL be shown

#### Scenario: Limit is scoped per origin

- **GIVEN** `https://example.com` has exhausted its per-origin enqueue allowance
- **WHEN** `https://primal.net` requests signing for an event that requires approval
- **THEN** the request from `https://primal.net` SHALL be enqueued normally

#### Scenario: Allowance recovers after the window

- **GIVEN** `https://example.com` was rate limited
- **WHEN** the rolling window has elapsed with no further enqueues
- **THEN** a new request from `https://example.com` SHALL be enqueued normally

#### Scenario: De-duplicated requests do not consume allowance

- **GIVEN** a pending request from `https://example.com` with a given event id hash
- **WHEN** the same origin requests signing for an event with the same event id hash
- **THEN** the existing queue entry SHALL be reused
- **AND** the enqueue allowance SHALL NOT be decremented

#### Scenario: Auto-signed requests are unaffected

- **GIVEN** an origin whose policy auto-signs an unprotected event kind
- **WHEN** that origin submits many signing requests for that kind
- **THEN** the enqueue rate limit SHALL NOT apply because no approval entry is created

---

### Requirement: Approval Queue Capacity Limits

The approval queue SHALL enforce a maximum number of pending requests per origin and a maximum total number of pending requests. Requests that would exceed either cap SHALL be rejected with the `rate_limited` error code.

#### Scenario: Per-origin pending cap is enforced

- **GIVEN** the per-origin pending cap is 5
- **AND** `https://example.com` already has 5 pending approval requests
- **WHEN** `https://example.com` requests signing for a sixth distinct event
- **THEN** the request SHALL be rejected with the `rate_limited` error code
- **AND** the existing 5 pending requests SHALL be unaffected

#### Scenario: Global queue cap is enforced

- **GIVEN** the global pending cap is 20
- **AND** the queue already holds 20 pending requests across all origins
- **WHEN** any origin requests signing for another distinct event
- **THEN** the request SHALL be rejected with the `rate_limited` error code

#### Scenario: Capacity is released on resolution

- **GIVEN** an origin is at its per-origin pending cap
- **WHEN** the user resolves one of that origin's pending requests
- **THEN** the origin SHALL be able to enqueue one further request within its rate allowance

#### Scenario: Capacity is released on timeout

- **GIVEN** an origin is at its per-origin pending cap
- **WHEN** one of that origin's pending requests reaches the approval deadline and is auto-denied
- **THEN** the pending count for that origin SHALL decrease by one

---

### Requirement: No Bulk Approve Without Review

The approval queue UI SHALL NOT offer an action that signs multiple queued requests without the user opening each request's detail view. Bulk denial SHALL remain available.

#### Scenario: Approve-all affordance is absent

- **GIVEN** an origin group in the approval inbox holds several pending requests
- **WHEN** the group is expanded
- **THEN** no control SHALL be offered that approves every request in the group
- **AND** a control SHALL be offered that denies every request in the group

#### Scenario: Global deny-all remains available

- **GIVEN** the approval inbox holds pending requests from more than one origin
- **WHEN** the inbox header is displayed
- **THEN** a global deny-all control SHALL be available
- **AND** activating it SHALL deny every pending request

#### Scenario: Approval requires the detail view

- **GIVEN** a pending request in the approval inbox
- **WHEN** the user wants to approve it
- **THEN** the user SHALL first open that request's detail view
- **AND** the approve action SHALL apply only to the request shown in that view

---

### Requirement: Approval Action Requires Explicit Re-Selection

After a request is resolved, the approval UI SHALL NOT automatically bind the approve action to another queued request in the same screen position. Binding the detail view to a different request SHALL briefly disable the approve action.

#### Scenario: Detail pane clears after resolution

- **GIVEN** the approval window shows a request in the detail pane
- **AND** other requests remain queued
- **WHEN** the user resolves the displayed request
- **THEN** the detail pane SHALL NOT automatically display another request
- **AND** the user SHALL be returned to the queue list to choose the next request

#### Scenario: Approve action has a cooldown on rebind

- **GIVEN** the approval detail view binds to a request it was not previously showing
- **WHEN** the view first renders that request
- **THEN** the approve action SHALL be disabled for a short cooldown period
- **AND** SHALL become enabled after the cooldown so a mis-click cannot approve the newly bound request

#### Scenario: Deny action is not delayed

- **GIVEN** the approval detail view has just bound to a request
- **WHEN** the cooldown period is still active
- **THEN** the deny action SHALL remain available

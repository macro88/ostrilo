## MODIFIED Requirements

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

#### Scenario: Auto-signed requests do not consume the enqueue allowance

- **GIVEN** an origin whose policy auto-signs an unprotected event kind
- **AND** the origin is within its automatic-signing budget
- **WHEN** that origin submits signing requests for that kind
- **THEN** no approval entry SHALL be created
- **AND** the origin's enqueue allowance SHALL NOT be decremented

## ADDED Requirements

### Requirement: Auto-Signed Requests Have A Per-Origin Budget

The extension SHALL limit how many requests site policy signs without a prompt for a single origin to 60 within a rolling 60 second window. A request within the budget SHALL be signed as policy decided. A request over the budget SHALL be routed to the approval window through the same enqueue path an `ask` decision takes, subject to the queue's existing per-origin rate, per-origin pending and global pending limits. A request SHALL NOT be refused because the origin has exceeded the auto-sign budget. Requests of protected kinds, which always require approval, SHALL NOT be counted. A request refused before policy evaluation SHALL NOT be counted. A request routed to approval because of the budget SHALL NOT be counted against it.

#### Scenario: The 60th request in a window signs without a prompt

- **GIVEN** an origin with a remembered allow rule for an unprotected kind
- **AND** it has had 59 requests signed without a prompt in the last 60 seconds
- **WHEN** it requests signing for that kind
- **THEN** the request SHALL be signed without an approval prompt

#### Scenario: The 61st request is routed to the approval window

- **GIVEN** an origin with a remembered allow rule for an unprotected kind
- **AND** it has had 60 requests signed without a prompt in the last 60 seconds
- **WHEN** it requests signing for that kind
- **THEN** the request SHALL be enqueued for approval and the approval window SHALL be shown, exactly as for a request that policy answers `ask`
- **AND** nothing SHALL be signed until the user approves
- **AND** the page SHALL NOT receive a refusal because of the budget

#### Scenario: Approving an over-budget request signs it

- **GIVEN** a request was routed to approval because its origin was over budget
- **WHEN** the user approves it
- **THEN** the event SHALL be signed with the key bound to the request at enqueue time
- **AND** the approval SHALL NOT be counted against the origin's budget

#### Scenario: Denying an over-budget request is an ordinary denial

- **GIVEN** a request was routed to approval because its origin was over budget
- **WHEN** the user denies it
- **THEN** the page SHALL receive the `denied` error code

#### Scenario: The queue's own limit applies to an over-budget request

- **GIVEN** an origin is over its auto-sign budget
- **AND** the origin already has 5 pending approval requests
- **WHEN** it requests signing for another distinct event
- **THEN** the request SHALL be rejected with the `rate_limited` error code
- **AND** the rejection SHALL be the approval queue's, with the same wording as for any other request it refuses

#### Scenario: The budget is scoped per origin

- **GIVEN** `https://example.com` has used its auto-sign budget
- **WHEN** `https://primal.net`, with its own remembered allow rule, requests signing for an unprotected kind
- **THEN** the request SHALL be signed without a prompt

#### Scenario: The budget recovers as the window rolls

- **GIVEN** an origin used its whole auto-sign budget
- **WHEN** 60 seconds have passed since the earliest of those requests
- **THEN** a request for an unprotected kind SHALL again be signed without a prompt

#### Scenario: An unreadable key does not spend the budget

- **GIVEN** the selected key cannot be read
- **WHEN** an origin submits signing requests
- **THEN** each request SHALL be refused with the `vault_unreadable` error code before policy is evaluated
- **AND** none SHALL be counted against the budget

#### Scenario: The approval window says why it is asking

- **GIVEN** a request was routed to approval because its origin was over its auto-sign budget
- **WHEN** the approval window shows the request
- **THEN** it SHALL state that the site went over its automatic-signing limit and that requests beyond it need approval
- **AND** it SHALL NOT change what approving or denying does
- **AND** a request that policy answered `ask` SHALL NOT carry that statement

### Requirement: Rate-Limit Counters Survive A Worker Restart

The extension SHALL persist the approval queue's per-origin enqueue window, the `getPublicKey` rate window and the auto-sign budget window in `storage.session`, each under its own key, so that a restart of the background worker does not return an allowance to an origin. A request that arrives at a restarted worker SHALL be judged against the persisted windows, not before they are read. A persisted record SHALL be bounded in the number of origins and in the entries kept per origin, and SHALL be validated when read. A record that cannot be read as a valid window SHALL be treated as an empty window. Persisted counters SHALL hold only origins and timestamps, SHALL NOT be written to storage that outlives the browser session, and SHALL NOT use the key of the lock-state record.

#### Scenario: An exhausted auto-sign budget survives a restart

- **GIVEN** an origin has used its whole auto-sign budget
- **WHEN** the background worker is restarted and the origin requests signing for an unprotected kind it is allowed to auto-sign
- **THEN** the request SHALL be routed to approval, not signed without a prompt

#### Scenario: An exhausted enqueue allowance survives a restart

- **GIVEN** an origin has enqueued 10 approval requests within the last 60 seconds
- **WHEN** the background worker is restarted and the origin requests signing for an event that requires approval
- **THEN** the request SHALL be rejected with the `rate_limited` error code

#### Scenario: Entries roll off on their original schedule

- **GIVEN** an origin's requests were charged before a restart
- **WHEN** the worker restarts
- **THEN** each charged request SHALL leave the window 60 seconds after it was made, not 60 seconds after the restart

#### Scenario: A malformed record is an empty window

- **GIVEN** a persisted counter record that is not an object, carries an unknown version, lists timestamps that are not finite numbers, or lists more entries than the limiter could have written
- **WHEN** the background worker reads it
- **THEN** the unreadable part SHALL be treated as an empty window
- **AND** the limit SHALL remain in force for requests made from then on
- **AND** reading the record SHALL NOT throw

#### Scenario: The record is bounded

- **GIVEN** requests arrive from more distinct origins than the record may hold
- **WHEN** the record is written
- **THEN** it SHALL hold no more than the bounded number of origins
- **AND** it SHALL keep those with the most recent activity

#### Scenario: A failed write does not lift the limit

- **GIVEN** writing a counter record to `storage.session` fails
- **WHEN** the origin continues to make requests
- **THEN** the limit SHALL continue to be enforced from the worker's memory

#### Scenario: Pending approvals are not persisted

- **GIVEN** an approval request is pending
- **WHEN** the background worker is restarted
- **THEN** the restarted worker SHALL hold no pending approval requests

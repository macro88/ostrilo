## ADDED Requirements

### Requirement: A Request The Background Cannot Answer Fails With A Canonical Error

When the background does not answer a relayed request, for example because the worker was ended while the request awaited approval, the content script SHALL answer the page with the `approval_failed` error code. It SHALL NOT forward the browser's own error text, and SHALL NOT leave the page without an answer. The page-side backstop deadline remains the last resort for a request nothing answers.

A worker ended while the vault is unlocked comes back locked, because decrypted keys are not persisted. A retry from the page SHALL therefore report `locked`.

#### Scenario: The worker ends while a request awaits approval

- **GIVEN** a dApp's `signEvent` request is awaiting user approval
- **WHEN** the browser ends the background worker
- **THEN** the Promise SHALL reject with error message `approval_failed`
- **AND** the rejection SHALL NOT contain the browser's internal wording for a closed message channel
- **AND** the rejection SHALL arrive without waiting for the page-side backstop deadline

#### Scenario: A retry after the worker restarts reports a locked vault

- **GIVEN** the background worker was ended and restarted
- **WHEN** the dApp calls `window.nostr.signEvent(event)` again
- **THEN** the Promise SHALL reject with error message containing "locked"

#### Scenario: Locking denies pending approvals

- **GIVEN** a dApp's request is awaiting user approval
- **WHEN** the vault locks
- **THEN** the pending request SHALL be denied and the Promise SHALL reject

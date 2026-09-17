## ADDED Requirements

### Requirement: Public Key Requests Carry The Page Origin

The content script SHALL include the page origin in every forwarded `nostr.getPublicKey` request, and the background handler SHALL validate that origin before doing any other work.

#### Scenario: Content script attaches the origin

- **WHEN** the injected provider calls `getPublicKey` and the content script forwards the request
- **THEN** the forwarded `nostr.getPublicKey` RPC message includes the page origin taken from the content-script context
- **AND** the origin is not read from any page-supplied field

#### Scenario: Missing origin is rejected

- **WHEN** the background receives a `nostr.getPublicKey` request with no origin
- **THEN** the request is rejected with error code `invalid_origin`
- **AND** no public key is returned

#### Scenario: Malformed origin is rejected

- **WHEN** the background receives a `nostr.getPublicKey` request whose origin is not a valid HTTP or HTTPS URL
- **THEN** the request is rejected with error code `invalid_origin`
- **AND** no public key is returned

### Requirement: Public Key Disclosure Requires Per-Origin Consent

The extension SHALL evaluate per-origin consent before returning the selected public key, and MUST NOT disclose the public key to an origin that has no recorded consent decision allowing it.

#### Scenario: First request from an unknown origin prompts

- **GIVEN** the vault is unlocked with a selected key
- **AND** no identity-disclosure decision exists for `https://example.com`
- **WHEN** `https://example.com` calls `getPublicKey`
- **THEN** the extension queues an approval request describing the identity-disclosure decision
- **AND** the public key is not returned until the user decides

#### Scenario: Approved disclosure returns the public key

- **GIVEN** an identity-disclosure prompt is open for `https://example.com`
- **WHEN** the user approves it
- **THEN** the Promise resolves to the 64-character hex public key of the selected key

#### Scenario: Denied disclosure returns an error

- **GIVEN** an identity-disclosure prompt is open for `https://example.com`
- **WHEN** the user denies it
- **THEN** the Promise rejects with error code `denied`
- **AND** no public key is returned

#### Scenario: Timed-out disclosure returns an error

- **GIVEN** an identity-disclosure prompt is open for `https://example.com`
- **WHEN** the prompt times out with no user decision
- **THEN** the Promise rejects with error code `timeout`
- **AND** no public key is returned

#### Scenario: A silent read is never possible from an unconsented origin

- **GIVEN** the vault is unlocked with a selected key
- **AND** no identity-disclosure decision exists for `https://tracker.example`
- **WHEN** a script on `https://tracker.example` calls `getPublicKey`
- **THEN** the public key is not returned without a user decision

### Requirement: Identity Consent Is Remembered And Revocable

The extension SHALL persist an identity-disclosure decision per origin so a consenting user is prompted only once per origin, and SHALL allow the user to revoke that decision in Settings.

#### Scenario: Remembered grant skips later prompts

- **GIVEN** the user approved identity disclosure for `https://example.com` with the remember option enabled
- **AND** the vault is unlocked
- **WHEN** `https://example.com` calls `getPublicKey` again
- **THEN** the public key is returned without a prompt

#### Scenario: One-time approval does not persist

- **GIVEN** the user approved identity disclosure for `https://example.com` without the remember option
- **WHEN** `https://example.com` calls `getPublicKey` again
- **THEN** the extension prompts again

#### Scenario: Remembered deny rejects without prompting

- **GIVEN** the user denied identity disclosure for `https://example.com` with the remember option enabled
- **WHEN** `https://example.com` calls `getPublicKey`
- **THEN** the Promise rejects with error code `denied`
- **AND** no prompt is shown

#### Scenario: Revoking consent restores prompting

- **GIVEN** a remembered identity-disclosure grant exists for `https://example.com`
- **WHEN** the user revokes it in Settings
- **THEN** the next `getPublicKey` call from `https://example.com` prompts again

#### Scenario: Identity consent is scoped to one origin

- **GIVEN** a remembered identity-disclosure grant exists for `https://example.com`
- **WHEN** `https://other.example` calls `getPublicKey`
- **THEN** the grant for `https://example.com` does not apply
- **AND** `https://other.example` is prompted

### Requirement: Identity Disclosure Is Recorded In The Activity Log

The extension SHALL write an activity-log entry for every `nostr.getPublicKey` outcome, and that entry SHALL be distinguishable from event-signing entries.

#### Scenario: Approved disclosure is logged

- **WHEN** identity disclosure is allowed for `https://example.com`
- **THEN** an activity-log entry records origin `https://example.com` and decision `allow`
- **AND** the entry identifies the operation as identity disclosure rather than event signing

#### Scenario: Denied disclosure is logged

- **WHEN** identity disclosure is denied for `https://example.com`
- **THEN** an activity-log entry records origin `https://example.com` and decision `deny`

#### Scenario: Auto-allowed disclosure from a remembered grant is logged

- **GIVEN** a remembered identity-disclosure grant exists for `https://example.com`
- **WHEN** `https://example.com` calls `getPublicKey`
- **THEN** an activity-log entry is still recorded for the disclosure

### Requirement: Locked Vault Fails Before Consent Evaluation

The extension SHALL keep returning a locked error for `nostr.getPublicKey` when the vault is locked, without prompting for consent and without recording a consent decision.

#### Scenario: Locked vault returns locked

- **GIVEN** the vault is locked
- **WHEN** `https://example.com` calls `getPublicKey`
- **THEN** the Promise rejects with error code `locked`
- **AND** no identity-disclosure prompt is shown
- **AND** no identity-disclosure decision is persisted

#### Scenario: No key selected returns no_key_selected

- **GIVEN** the vault is unlocked
- **AND** no key is selected
- **WHEN** `https://example.com` calls `getPublicKey`
- **THEN** the Promise rejects with error code `no_key_selected`

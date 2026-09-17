## MODIFIED Requirements

### Requirement: Get Public Key

The extension SHALL provide a `window.nostr.getPublicKey()` method that returns the currently selected public key to an origin that has consented to identity disclosure, and SHALL NOT return it to an origin that has not.

#### Scenario: Successful retrieval when unlocked and consented

- **GIVEN** the vault is unlocked with at least one key
- **AND** the calling origin has a recorded identity-disclosure decision allowing it
- **AND** the origin is within its per-origin rate allowance
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the method SHALL return a Promise
- **AND** the Promise SHALL resolve to a 64-character hex string (32-byte public key)

#### Scenario: Unconsented origin is prompted rather than answered

- **GIVEN** the vault is unlocked with at least one key
- **AND** the calling origin has no recorded identity-disclosure decision
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the Promise SHALL NOT resolve until the user decides
- **AND** the public key SHALL NOT be returned if the user refuses

#### Scenario: Error when locked

- **GIVEN** the vault is locked
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the Promise SHALL reject with error message containing "locked"

#### Scenario: Error when no key is selected

- **GIVEN** the vault is unlocked and no key is selected
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the Promise SHALL reject with error message containing "no_key"

#### Scenario: A vault with no keys reports locked, not no_key

- **GIVEN** no keys have been imported or generated
- **WHEN** a dApp calls `window.nostr.getPublicKey()`
- **THEN** the Promise SHALL reject with error message containing "locked"
- **AND** it SHALL NOT report that no key exists, because a vault with no keys cannot be unlocked and the lock gate answers first

#### Scenario: Refusal is distinguishable from a signing refusal

- **GIVEN** the calling origin's identity disclosure is refused
- **WHEN** the Promise rejects
- **THEN** the error code SHALL differ from the code returned when a signing request is denied
- **AND** a client branching on the error code can tell the two apart

## ADDED Requirements

### Requirement: Single Source Of Truth For Password Policy

The extension SHALL define the vault password policy once in the domain layer and SHALL expose exactly one acceptance verdict for callers to act on. Callers MUST NOT construct their own acceptance predicate from the strength score or from individual requirement flags.

#### Scenario: Evaluation exposes one verdict and a display-only score

- **WHEN** any caller evaluates a password
- **THEN** the evaluation returns an `acceptable` boolean that is the only acceptance predicate
- **AND** the evaluation returns machine-readable violation codes explaining a rejection
- **AND** the evaluation returns a `score` that is documented as display-only
- **AND** the evaluation does not expose a `meetsMinimum` field

#### Scenario: Every enforcement point agrees

- **GIVEN** the same candidate password
- **WHEN** the RPC boundary, the vault service and the UI each evaluate it
- **THEN** all three reach the same verdict from the same policy definition
- **AND** none of them re-implements any part of the policy locally

### Requirement: Minimum Length For New Vault Passwords

The extension SHALL reject a newly created vault password shorter than 12 characters and SHALL NOT require any particular mix of character classes.

#### Scenario: Four character password is rejected

- **WHEN** a new vault password of `Aa1!` is submitted on any creation path
- **THEN** the password is rejected with a `too_short` violation
- **AND** no key is created

#### Scenario: Eight character password is rejected

- **WHEN** a new vault password of eight characters is submitted
- **THEN** the password is rejected with a `too_short` violation
- **AND** the rejection message states the 12 character minimum

#### Scenario: Long single-class password is accepted

- **WHEN** a new vault password of `harbourlanterns` is submitted
- **THEN** the password is accepted
- **AND** no character class violation is reported

#### Scenario: Composition is guidance, not a gate

- **WHEN** a new vault password of `unmark thicket parcel` is submitted
- **THEN** the password is accepted despite containing no digit, symbol or uppercase letter
- **AND** the UI does not present character classes as requirements

### Requirement: Structural And Dictionary Weakness Is Rejected Offline

The extension SHALL reject new vault passwords that satisfy the length minimum but remain structurally guessable, using only offline checks against a bundled list and local pattern rules. The extension MUST NOT transmit a password, a hash of a password, or any prefix of such a hash outside the extension.

#### Scenario: Decorated common password is rejected

- **WHEN** a new vault password of `Password123!` is submitted
- **THEN** normalization folds case, leet substitutions and trailing digits and punctuation
- **AND** the normalized value matches the bundled common-password list
- **AND** the password is rejected with a `common_password` violation

#### Scenario: Keyboard walk is rejected

- **WHEN** a new vault password of `qwertyuiop12` is submitted
- **THEN** the password is rejected with a `keyboard_pattern` violation

#### Scenario: Repeated character is rejected

- **WHEN** a new vault password of `aaaaaaaaaaaa` is submitted
- **THEN** the password is rejected with a `repeated_characters` violation

#### Scenario: Sequential run is rejected

- **WHEN** a new vault password of `abcdefghijkl` is submitted
- **THEN** the password is rejected with a `sequential_characters` violation

#### Scenario: Product and identity terms are rejected

- **WHEN** a new vault password of `ostrilonostr` is submitted
- **THEN** the password is rejected with a `product_term` violation
- **AND** a password equal to the key label being created is rejected the same way

#### Scenario: Evaluation makes no network request

- **WHEN** the extension evaluates any password
- **THEN** no network request is made
- **AND** no password, password hash, or hash prefix leaves the extension
- **AND** any future breach-corpus lookup remains out of scope unless the user explicitly consents to it

### Requirement: Policy Is Enforced On Every Creation Path

The extension SHALL enforce the password policy for the password that creates a vault regardless of which surface initiates creation, and SHALL enforce it at the RPC boundary and in the vault service rather than in UI components alone.

#### Scenario: Onboarding wizard path is gated

- **GIVEN** no keys exist
- **WHEN** the user submits a four character password in the onboarding create-key step
- **THEN** the wizard shows the policy violation
- **AND** no `vault.generate` request succeeds

#### Scenario: Options page path is gated

- **GIVEN** no keys exist
- **WHEN** the user submits a four character password in the options page key-creation form
- **THEN** the form shows the policy violation
- **AND** no key is created

#### Scenario: Direct RPC call with no UI is gated

- **GIVEN** no keys exist
- **WHEN** a `vault.generate` request carries a four character password
- **THEN** the handler returns an error with machine code `invalid_password`
- **AND** `error.data.details` explains the policy without echoing the password
- **AND** no key record is written to storage

#### Scenario: Import path is gated

- **GIVEN** no keys exist
- **WHEN** a `vault.import` request carries a valid `nsec` and a four character password
- **THEN** the handler returns an error with machine code `invalid_password`
- **AND** no key record is written to storage

### Requirement: Verification Paths Do Not Apply The Creation Policy

The extension SHALL NOT apply the new-password policy to a password supplied for verification, so that users who already hold a below-policy password are not locked out of their own vault. Verification paths are `vault.unlock`, `vault.reveal`, and `vault.generate` or `vault.import` when the vault already holds a key.

#### Scenario: Existing below-policy password still unlocks

- **GIVEN** a vault whose password is eight characters and was created before this change
- **WHEN** the user submits that password to `vault.unlock`
- **THEN** the vault unlocks
- **AND** the password is not rejected for policy

#### Scenario: Adding a key reuses the existing vault password

- **GIVEN** a vault that already holds a key encrypted under a below-policy password
- **WHEN** the user creates an additional key with that same password
- **THEN** the request is not rejected for policy
- **AND** the password is verified against existing key material
- **AND** an incorrect password is still rejected as `invalid_password`

#### Scenario: Below-policy vault password produces a dismissible advisory

- **GIVEN** a vault whose password is below the current policy
- **WHEN** the user unlocks successfully
- **THEN** the extension records only that the vault password is below policy, never the password
- **AND** the UI shows a dismissible advisory recommending a stronger passphrase
- **AND** the advisory does not block any operation

### Requirement: Passphrase Guidance And Offline Generator

The extension SHALL recommend a passphrase as the preferred form of vault password and SHALL offer an offline generator that produces at least six words drawn from a bundled wordlist using a cryptographically secure random source.

#### Scenario: Guidance names the preferred form

- **WHEN** the user reaches a new-password field
- **THEN** the UI recommends several unrelated words rather than a short complex string
- **AND** the UI states the 12 character minimum
- **AND** the UI explains that length defeats guessing more effectively than character variety

#### Scenario: Generator produces a compliant passphrase

- **WHEN** the user requests a generated passphrase
- **THEN** the extension returns at least six words selected with a cryptographically secure random source
- **AND** the result satisfies the password policy
- **AND** generation makes no network request

#### Scenario: Generated passphrase is not retained

- **WHEN** a generated passphrase is placed into the password field
- **THEN** it is not written to storage
- **AND** it is not written to any log or console output
- **AND** it is not held in persistent component state

### Requirement: Confirm Password Is Required Wherever The Password Is New

The UI SHALL require a matching confirmation field on every surface where the password being submitted is new, and SHALL NOT require confirmation where the password is verified against existing key material.

#### Scenario: Onboarding requires a matching confirmation

- **WHEN** the user creates the first key in the onboarding wizard
- **THEN** a confirmation field is present
- **AND** submission is blocked while the two values differ

#### Scenario: Options page first-key creation requires a matching confirmation

- **GIVEN** no keys exist
- **WHEN** the user creates a key from the options page form
- **THEN** a confirmation field is present
- **AND** submission is blocked while the two values differ

#### Scenario: Adding a key to an existing vault asks once

- **GIVEN** a vault that already holds a key
- **WHEN** the user creates an additional key
- **THEN** the form presents a single password field with no confirmation field
- **AND** an incorrect password is rejected by verification against stored key material

## ADDED Requirements

### Requirement: Cleanup Is Verified On Failures Raised Before The Operation Body

The security suite SHALL cover the window between a secret's successful acquisition
and the start of the operation's main work. For each operation that acquires a secret
and then performs fallible work, a test SHALL induce a failure inside that window and
SHALL assert on the retained buffer's contents.

A test that induces its failure inside the operation's main body SHALL NOT be accepted
as coverage of this window, because a cleanup block that begins after the acquisition
satisfies it while still leaking the acquired buffer.

#### Scenario: Import parse failure is covered

- **GIVEN** a `KeyVaultService` wired to a key-derivation adapter that returns a buffer the test retains by object identity
- **WHEN** `importKey` is called with input the private-key parser rejects
- **THEN** the test asserts the retained derived-key buffer was non-zero at handoff
- **AND** asserts every byte of it reads zero after the call rejects
- **AND** asserts the rejection carries the parser's own error, not a substituted one

#### Scenario: Generation randomness failure is covered

- **GIVEN** a `KeyVaultService` whose key derivation succeeds and whose platform random number generator throws when the private key is drawn
- **WHEN** `generateKey` rejects
- **THEN** the test asserts every byte of the retained derived-key buffer reads zero
- **AND** the randomness failure is induced only for the private-key draw, so that the key-derivation salt and initialisation vectors are unaffected and the test cannot pass or fail for an unrelated reason

#### Scenario: A cleanup regression turns these tests red

- **GIVEN** the tests covering this window
- **WHEN** work that follows a secret's acquisition is moved back outside the operation's cleanup block
- **THEN** those tests fail
- **AND** the failure identifies the buffer that was not cleared

### Requirement: Tests Distinguish Owned Buffers From Intentionally Retained Buffers

A zeroization test SHALL assert on the buffers the operation under test owns, and SHALL
NOT assert that every sensitive buffer reachable after the operation reads zero. Where
the production code intentionally retains a secret — the decrypted private keys an
unlocked vault holds in memory — the test SHALL state that the retention is intended
and SHALL NOT assert that the retained buffer is cleared while it is still in use.

#### Scenario: Operation-owned buffers are asserted cleared

- **GIVEN** an operation that derives a key-encryption key and draws a private key
- **WHEN** the operation completes or fails without unlocking the vault
- **THEN** the test asserts both buffers read zero
- **AND** the test identifies them as owned by that operation

#### Scenario: Vault-retained keys are not asserted cleared while unlocked

- **GIVEN** a successful `unlock` that transfers decrypted private keys into the unlocked-key set
- **WHEN** the test inspects those buffers
- **THEN** it MUST NOT assert they read zero while the vault remains unlocked
- **AND** it MUST assert they read zero only after `lock`

#### Scenario: Ownership transfer is visible in the test

- **GIVEN** production code that marks a handoff by dropping its own reference to a secret
- **WHEN** a test covers that path
- **THEN** the test records which holder owns the buffer after the transfer
- **AND** a later change that makes the operation retain the buffer instead fails a test

### Requirement: Tests Exercise Production Code Rather Than Restating It

A test SHALL import and execute the production code whose behavior it claims to
verify. A test whose assertions only re-evaluate an expression written inside the test
itself SHALL NOT be presented as coverage of that behavior, and SHALL be removed or
replaced by one that calls the production code.

A test SHALL NOT re-implement a production validation predicate in order to assert
against its own copy.

#### Scenario: A constant assertion is not coverage

- **GIVEN** a test whose assertion is a literal comparison that holds independently of the code under test
- **WHEN** the test file is reviewed
- **THEN** that test MUST be removed or replaced with one that calls the production code
- **AND** replacing the literal with a different assertion against test-local logic MUST NOT be accepted as the fix

#### Scenario: Validation is asserted through the production predicate

- **GIVEN** a test covering a URL, password, or metadata validation rule
- **WHEN** the test asserts which inputs are accepted and rejected
- **THEN** it MUST call the exported production validator
- **AND** it MUST NOT construct an equivalent check inside the test

#### Scenario: Coverage that already exists is not duplicated

- **GIVEN** a guarantee already asserted against production code in an existing test
- **WHEN** an ineffective test of the same guarantee is removed
- **THEN** the effective test MUST be identified as the remaining coverage
- **AND** a second assertion of the same guarantee MUST NOT be added merely to replace the removed test

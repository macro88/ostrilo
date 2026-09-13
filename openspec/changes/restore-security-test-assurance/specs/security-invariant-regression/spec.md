## ADDED Requirements

### Requirement: Key Derivation Parameters Are Pinned By Test

The test suite SHALL assert the vault key-derivation algorithm and its cost parameters against the values the security design requires, so that lowering the work factor fails a test rather than passing silently.

#### Scenario: Iteration count cannot be lowered silently

- **GIVEN** the vault key-derivation adapter
- **WHEN** its configured cost parameters are read by a test
- **THEN** the test asserts the algorithm identifier and each cost parameter against the required minimum
- **AND** reducing the parameter below the required minimum fails the test

#### Scenario: Recorded parameters are honored on unlock

- **GIVEN** a stored vault record that records the derivation parameters used to encrypt it
- **WHEN** the vault unlocks that record
- **THEN** derivation uses the recorded parameters
- **AND** a record whose parameters fall below the required minimum is reported rather than accepted as current

### Requirement: Randomness Source Is Pinned By Test

The test suite SHALL assert that every path producing key material, salts, IVs, or signing nonces draws from the platform cryptographically secure random number generator, so that swapping the source fails a test.

#### Scenario: Swapped RNG source fails

- **GIVEN** the randomness source used for key, salt, or IV generation is replaced with a non-CSPRNG source
- **WHEN** the invariant suite runs
- **THEN** a test fails and names the affected generation path

#### Scenario: Salt and IV lengths and uniqueness are pinned

- **WHEN** two key records are created with the same password
- **THEN** their salts differ
- **AND** their IVs differ
- **AND** each salt and IV has the length the design requires

### Requirement: Policy Evaluation Checks Are Pinned By Test

The test suite SHALL contain one assertion per policy guard in `evaluatePolicy`, so that deleting any guard fails a named test rather than widening authority silently.

#### Scenario: Deleting the lock check fails a test

- **GIVEN** the locked-vault guard in policy evaluation
- **WHEN** the guard is removed
- **THEN** a named test fails

#### Scenario: Deleting the protected-kind check fails a test

- **GIVEN** the protected-kind guard that forces kinds `1` and `9734` to approval
- **WHEN** the guard is removed
- **THEN** a named test fails for the trust-default path, the session-grant path, and the explicit-allow path

#### Scenario: Deleting the explicit-deny precedence fails a test

- **GIVEN** an explicit deny rule combined with a session grant
- **WHEN** the deny-first ordering is removed
- **THEN** a named test fails

#### Scenario: Unknown origin falls back to ask

- **WHEN** an origin with no stored policy requests signing
- **THEN** evaluation returns an approval-required decision
- **AND** a test fails if the fallback is changed to allow

### Requirement: Lock State Fails Closed

The test suite SHALL assert that lock state resolves to locked whenever the state cannot be read, parsed, or trusted, so that a change making `getLockState` fail open turns a test red.

#### Scenario: Missing session state reports locked

- **GIVEN** no lock state exists in session storage
- **WHEN** lock state is read
- **THEN** the result reports the vault as locked

#### Scenario: Failing session storage reports locked

- **GIVEN** session storage rejects the read
- **WHEN** lock state is read
- **THEN** the result reports the vault as locked
- **AND** no signing operation is permitted on the strength of that read

#### Scenario: Malformed session state reports locked

- **GIVEN** session lock state that is present but not of the expected shape
- **WHEN** lock state is read
- **THEN** the result reports the vault as locked

### Requirement: Password Gates Are Pinned By Test

The test suite SHALL assert every operation that requires the vault password before releasing or re-encrypting key material, so that weakening a gate fails a named test.

#### Scenario: Key material release requires password re-verification

- **GIVEN** an unlocked vault
- **WHEN** a private key is requested for export or reveal
- **THEN** the operation requires the correct vault password
- **AND** an incorrect password is rejected without releasing key material
- **AND** removing the password check fails a named test

#### Scenario: Key creation and import require the vault password

- **WHEN** a key is generated or imported
- **THEN** the operation requires a password that satisfies the vault password policy
- **AND** the password is validated against existing vault records before the new key is stored

#### Scenario: Wrong password does not unlock

- **GIVEN** a vault holding at least one key record
- **WHEN** an incorrect password is supplied to unlock
- **THEN** unlock fails
- **AND** the session lock state remains locked

### Requirement: Each Invariant Test Is Demonstrated To Fail On Revert

For every security invariant covered by this capability, the change SHALL record a demonstration that the test fails when the corresponding protection is deliberately reverted. A test that has never been observed failing SHALL NOT be treated as evidence.

#### Scenario: Revert demonstration is recorded

- **GIVEN** a named security-invariant test
- **WHEN** the protection it covers is temporarily reverted in a scratch working tree
- **THEN** the test fails
- **AND** the observed failure is recorded against that invariant
- **AND** the revert is discarded before the change is handed off

#### Scenario: Invariant maps to a companion change

- **WHEN** an invariant test is added
- **THEN** it names the defect and the companion change that fixes it, among `harden-vault-key-derivation`, `enforce-password-policy`, `implement-session-auto-lock`, `fix-consent-policy-defects`, and `remove-key-exfiltration-surface`

## ADDED Requirements

### Requirement: The Master Password Can Be Changed With The Current Password

The extension SHALL provide a `vault.changePassword` method, reachable only from verified extension pages and only while the vault is unlocked, that replaces the master password when given the correct current password and an acceptable new one. The method SHALL refuse the change with `invalid_params` when the new password equals the current one, and SHALL leave every stored item unchanged on any refusal.

#### Scenario: Successful change

- **GIVEN** an unlocked vault holding three keys
- **WHEN** `vault.changePassword` is sent with the correct current password and a new password that meets the policy
- **THEN** the response is successful
- **AND** after locking, unlock with the new password succeeds and every key's public key is unchanged
- **AND** unlock with the old password fails with `invalid_password`

#### Scenario: Wrong current password

- **WHEN** `vault.changePassword` is sent with an incorrect current password
- **THEN** the response carries `invalid_password`
- **AND** a failure is recorded against the unlock throttle
- **AND** the envelope and every key record are unchanged

#### Scenario: Refused while locked

- **GIVEN** the vault is locked
- **WHEN** `vault.changePassword` is sent
- **THEN** the response carries the `locked` error code

#### Scenario: Refused from a web page

- **WHEN** `vault.changePassword` arrives from a content-script sender
- **THEN** it is refused as an unknown namespace, as every privileged method is

#### Scenario: Refused during a throttle backoff

- **GIVEN** an unlock-throttle backoff is active
- **WHEN** `vault.changePassword` is sent with any current password
- **THEN** the response carries `rate_limited` with the remaining wait
- **AND** no key derivation is performed

### Requirement: Rotation Re-Wraps Keys Without Re-Encrypting Them

A password change SHALL derive a new KEK under a fresh salt and the current default KDF parameters, SHALL re-wrap every record's DEK under it with AAD bound to the new parameters, SHALL seal a new verifier, SHALL verify each re-wrapped record by opening it and matching its public key before committing, and SHALL zeroize the old KEK, the new KEK, and every DEK and private key it handled.

#### Scenario: Private key ciphertexts are preserved

- **WHEN** a password change completes
- **THEN** every record's private-key ciphertext and IV are byte-identical to before
- **AND** every record's wrapped DEK and the envelope's salt and verifier differ from before

#### Scenario: A vault on an older work factor is upgraded

- **GIVEN** an envelope whose KDF parameters are above the floor but differ from `KDF_DEFAULTS`
- **WHEN** the password is changed
- **THEN** the new envelope records `KDF_DEFAULTS` with a fresh salt

#### Scenario: Secret buffers are zeroed

- **GIVEN** a test retaining references to the KEK and DEK buffers used by a password change
- **WHEN** the change completes or fails
- **THEN** every byte of every retained buffer reads zero

### Requirement: Rotation Is Refused When A Record Cannot Be Carried

A password change SHALL be refused, with no stored item changed, when any stored record is unversioned (legacy) or its DEK cannot be unwrapped under the current KEK. The refusal SHALL say which condition applies, and for damaged records SHALL identify them by key id.

#### Scenario: A legacy record blocks the change

- **GIVEN** a vault containing an unversioned key record
- **WHEN** a password change is requested
- **THEN** it is refused with a result stating that the vault must finish migrating first

#### Scenario: A damaged record blocks the change

- **GIVEN** a vault in which one record's wrapped DEK fails to open
- **WHEN** a password change is requested
- **THEN** it is refused with a result naming that record's key id
- **AND** no stored item changes

### Requirement: An Interrupted Rotation Never Loses The Vault

A password change SHALL commit through a single-item rotation journal holding the complete before and after states, written before the envelope or records change and removed only after both are written. The method SHALL report success only after the journal is removed. When the journal is present, unlock and password verification SHALL first recover. A password that opens the journal's after-state SHALL roll forward to it. A password that opens the journal's before-state SHALL roll back to it. Recovery SHALL be idempotent.

#### Scenario: Interrupted after the journal is written

- **GIVEN** a rotation interrupted after writing the journal and before writing the envelope
- **WHEN** the user unlocks with the old password
- **THEN** unlock succeeds with every key intact and the journal is removed
- **AND** the old password remains the vault password

#### Scenario: Interrupted between the envelope and records writes

- **GIVEN** a rotation interrupted after writing the new envelope and before writing the new records
- **WHEN** the user unlocks with the new password
- **THEN** unlock succeeds with every key intact and the journal is removed
- **AND** the new password is the vault password

#### Scenario: Old password after the envelope was written

- **GIVEN** a rotation interrupted after writing the new envelope and before writing the new records
- **WHEN** the user unlocks with the old password
- **THEN** unlock succeeds with every key intact and the journal is removed
- **AND** the old password remains the vault password

#### Scenario: Interrupted recovery is resumed

- **GIVEN** a recovery that was itself interrupted after writing the envelope
- **WHEN** the user unlocks again with the same password
- **THEN** recovery completes and every key is intact

### Requirement: Vault Writes Are Serialised Against Rotation

Key generation, import, deletion, rename, legacy migration and password change SHALL run one at a time, so no record is written under a KEK that a concurrent rotation is replacing, and no rotation overwrites a record added during it.

#### Scenario: Import during a rotation

- **GIVEN** a password change is in progress
- **WHEN** a key import is requested
- **THEN** the import runs after the rotation commits
- **AND** after locking, unlock with the new password opens both the existing keys and the imported key

### Requirement: The Session Survives A Password Change

A successful password change SHALL leave the vault unlocked, with the in-memory keys, selected key and session grants unchanged, and SHALL record user activity for the auto-lock deadline.

#### Scenario: Signing continues after a change

- **GIVEN** an origin with an active session grant
- **WHEN** the master password is changed
- **THEN** a signing request from that origin is still covered by the grant without an unlock

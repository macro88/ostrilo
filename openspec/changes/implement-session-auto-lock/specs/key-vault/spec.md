## MODIFIED Requirements

### Requirement: Zero-Retention Password Handling

The system MUST NOT store the user's master password in memory or storage for longer than the duration of a single cryptographic operation. This applies to the password supplied at unlock, the password supplied when adding a key, and the password supplied to re-authenticate a high-risk action.

#### Scenario: Unlock Vault

- **GIVEN** the vault is locked
- **WHEN** the user enters their password to unlock
- **THEN** the system derives the master key
- **AND** decrypts the stored keys into memory
- **AND** immediately zeroizes the password and derived master key
- **AND** does NOT store the password in any class property or storage

#### Scenario: Add Key

- **GIVEN** the vault is unlocked
- **WHEN** the user wants to add a new key
- **THEN** the system MUST require the user to re-enter their password
- **AND** use the password to encrypt the new key
- **AND** immediately zeroize the password

#### Scenario: Re-Authenticate High-Risk Action

- **GIVEN** the vault is unlocked
- **WHEN** the user re-enters their password to authorize a high-risk action
- **THEN** the system verifies the password by decrypting a stored key record
- **AND** immediately zeroizes the password and derived key material
- **AND** does NOT retain the password for a subsequent action

### Requirement: Memory Zeroization

The system MUST explicitly zeroize all sensitive buffers (passwords, private keys, derived keys) immediately after use, including when the vault is locked automatically after inactivity rather than by an explicit user action.

#### Scenario: Cryptographic Operations

- **GIVEN** a cryptographic operation (encrypt, decrypt, sign)
- **WHEN** the operation completes or fails
- **THEN** all intermediate buffers containing sensitive data MUST be filled with zeros

#### Scenario: Automatic Lock

- **GIVEN** the vault is unlocked and holds decrypted private keys in memory
- **WHEN** the vault is locked automatically after the inactivity window elapses
- **THEN** every decrypted private key buffer MUST be filled with zeros
- **AND** the in-memory unlocked key map MUST be emptied
- **AND** no decrypted private key remains reachable from the background

## ADDED Requirements

### Requirement: Unlock Requires A Verified Password

The vault MUST NOT report a successful unlock, and MUST NOT record unlocked lock state, unless the supplied password has been verified by decrypting at least one stored key record. An unlock attempt against a vault that holds zero key records MUST fail with a distinct error.

#### Scenario: Unlock with an empty vault

- **GIVEN** the vault holds zero key records
- **WHEN** an unlock is attempted with any password
- **THEN** the unlock fails with a distinct empty-vault error
- **AND** stored lock state continues to record a locked vault

#### Scenario: Unlock with an incorrect password

- **GIVEN** the vault holds at least one key record
- **WHEN** an unlock is attempted with an incorrect password
- **THEN** the unlock fails
- **AND** no key material is retained in memory
- **AND** stored lock state continues to record a locked vault

#### Scenario: Unlock with the correct password

- **GIVEN** the vault holds at least one key record
- **WHEN** an unlock is attempted with the correct password
- **THEN** the stored key records are decrypted into memory
- **AND** stored lock state records an unlocked vault with the current activity timestamp

### Requirement: Unlocked Key Material Stays In Background Memory Only

Decrypted private keys SHALL exist only in the in-memory unlocked key map inside the background service worker. The system MUST NOT write decrypted private keys, passwords, or derived key material to session, local, or sync storage, and MUST NOT return them across a message boundary except through the explicit password-verified reveal and export operations.

#### Scenario: Storage holds no key material after unlock

- **GIVEN** the vault has been unlocked
- **WHEN** session, local, and sync storage are inspected
- **THEN** the only lock-related values present are lock state and session grants
- **AND** no decrypted private key, password, or derived key material is present

#### Scenario: Background termination is not worked around by persistence

- **GIVEN** the background worker may be terminated while the vault is unlocked
- **WHEN** the system prepares to survive that termination
- **THEN** it MUST NOT persist decrypted private keys, the password, or derived key material
- **AND** a subsequent privileged access MUST report locked instead of resuming from persisted secrets

### Requirement: High-Risk Vault Actions Require Password Re-Authentication

The system SHALL require the user to re-enter and verify their password before completing a high-risk action while the vault is unlocked, following the verification pattern already used by the reveal operation. High-risk actions SHALL include deleting a key, revealing or exporting a private key, raising an origin to `high` trust, changing a per-kind rule to `allow`, enabling a session grant, and changing the auto-lock or session grant timeout. Verification MUST decrypt a stored key record and MUST fail when the vault holds zero key records.

#### Scenario: Key deletion requires the password

- **GIVEN** the vault is unlocked and holds more than one key
- **WHEN** the user deletes a key without supplying a password
- **THEN** the deletion is refused
- **AND** the key record is unchanged

#### Scenario: Incorrect password does not authorize a high-risk action

- **GIVEN** the vault is unlocked
- **WHEN** the user supplies an incorrect password for a high-risk action
- **THEN** the action fails with an incorrect-password error
- **AND** no stored key, policy, or security setting is changed

#### Scenario: Raising trust requires the password

- **GIVEN** the vault is unlocked
- **WHEN** the user raises an origin to `high` trust
- **THEN** the password is required and verified before the policy is stored

#### Scenario: Renaming a key does not require the password

- **GIVEN** the vault is unlocked
- **WHEN** the user renames a key
- **THEN** the rename completes without password re-entry
- **AND** the action still requires an unlocked vault

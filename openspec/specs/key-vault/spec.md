# key-vault Specification

## Purpose

Define how the extension protects Nostr private keys at rest and in memory: password-derived envelope encryption of stored key records, a verified unlock, password re-authentication before any high-risk or disclosing action, and zeroization of sensitive key material as soon as an operation completes or fails.

## Requirements

### Requirement: Zero-Retention Password Handling

The system MUST NOT store the user's master password in memory or storage for longer than the duration of a single cryptographic operation. This applies to the password supplied at unlock, the password supplied when adding a key, and the password supplied to re-authenticate a high-risk action. The system SHALL verify the password against stored verification material on every unlock attempt, including when the vault holds zero key records, and SHALL derive exactly one password-derived key-encryption key per unlock attempt.

#### Scenario: Unlock Vault

- **GIVEN** the vault is locked
- **WHEN** the user enters their password to unlock
- **THEN** the system derives one key-encryption key from the password using the parameters recorded in the stored vault envelope
- **AND** verifies the password against the stored verification material before marking the session unlocked
- **AND** unwraps each key record's data-encryption key and decrypts the stored keys into memory
- **AND** verifies each decrypted key against its record's stored public key
- **AND** immediately zeroizes the password, the derived key-encryption key, and every unwrapped data-encryption key
- **AND** does NOT store the password in any class property or storage

#### Scenario: Unlock Empty Vault

- **GIVEN** the vault is locked, a stored vault envelope exists, and the vault holds zero key records
- **WHEN** the user enters an incorrect password to unlock
- **THEN** the system reports an incorrect password
- **AND** the session lock state remains locked
- **AND** the system does NOT report the unlock as successful merely because there was nothing to decrypt

#### Scenario: Add Key

- **GIVEN** the vault is unlocked
- **WHEN** the user wants to add a new key
- **THEN** the system MUST require the user to re-enter their password
- **AND** derive the vault key-encryption key at most once for that operation
- **AND** generate a fresh data-encryption key, encrypt the new key with it, and wrap that data-encryption key under the key-encryption key
- **AND** immediately zeroize the password, the derived key-encryption key, and the new data-encryption key

#### Scenario: Re-Authenticate High-Risk Action

- **GIVEN** the vault is unlocked
- **WHEN** the user re-enters their password to authorize a high-risk action
- **THEN** the system verifies the password against the stored vault envelope verification material
- **AND** immediately zeroizes the password and derived key material
- **AND** does NOT retain the password for a subsequent action

### Requirement: Memory Zeroization

The system MUST explicitly zeroize all sensitive buffers (passwords, private keys, key-encryption keys, data-encryption keys, and any other derived keys) immediately after use, including when the vault is locked automatically after inactivity rather than by an explicit user action.

#### Scenario: Cryptographic Operations

- **GIVEN** a cryptographic operation (encrypt, decrypt, wrap, unwrap, sign)
- **WHEN** the operation completes or fails
- **THEN** all intermediate buffers containing sensitive data MUST be filled with zeros

#### Scenario: Zeroization Is Observable

- **GIVEN** a test holding a reference to the byte storage of a sensitive buffer
- **WHEN** the operation that owns that buffer completes or fails
- **THEN** every byte of the retained buffer MUST read zero
- **AND** the guarantee MUST be verifiable by inspecting buffer contents rather than by counting calls to a zeroization helper

#### Scenario: No Unzeroized Copy Survives

- **GIVEN** an operation that copies key material into a second buffer, such as a copy made to satisfy a platform crypto API
- **WHEN** the operation completes or fails
- **THEN** that copy MUST be zeroized or MUST be unreachable with its contents intact
- **AND** introducing a new unzeroized copy of key material MUST fail a test

#### Scenario: String Password Handling

- **GIVEN** a vault password supplied as a string to unlock, key creation, key import, or key reveal
- **WHEN** the operation completes or fails
- **THEN** the system MUST NOT hold the password on any instance property, module variable, or storage
- **AND** the system MUST NOT create a byte copy of the password that the operation does not require
- **AND** any byte copy the operation does require MUST be filled with zeros before the operation returns
- **AND** the system MUST NOT claim the password string itself was erased

#### Scenario: Envelope Key Material

- **GIVEN** an unlock that derives a key-encryption key and unwraps one or more data-encryption keys
- **WHEN** the unlock completes or fails at any point
- **THEN** the key-encryption key buffer MUST be filled with zeros
- **AND** every unwrapped data-encryption key buffer MUST be filled with zeros

#### Scenario: Rejected Key Material

- **GIVEN** a key record that decrypts but fails verification against its stored public key
- **WHEN** the system rejects that record
- **THEN** the decrypted private key buffer MUST be filled with zeros
- **AND** the rejected material MUST NOT be retained in the unlocked key set

#### Scenario: Automatic Lock

- **GIVEN** the vault is unlocked and holds decrypted private keys in memory
- **WHEN** the vault is locked automatically after the inactivity window elapses
- **THEN** every decrypted private key buffer MUST be filled with zeros
- **AND** the in-memory unlocked key map MUST be emptied
- **AND** no decrypted private key remains reachable from the background

### Requirement: Password Re-Verification For Private Key Disclosure

Any operation that returns private-key material out of the vault SHALL require the user's password and SHALL verify it by re-deriving the encryption key from the stored salt and decrypting the stored key record. An unlocked vault SHALL NOT by itself authorize disclosure. The derived key material and the decrypted private key SHALL be zeroized before the operation returns.

#### Scenario: Correct password discloses the key

- **GIVEN** the vault is unlocked
- **AND** the user requests their private key for backup
- **WHEN** the user supplies the correct password
- **THEN** the vault re-derives the encryption key from the stored salt
- **AND** decrypts the stored key record
- **AND** returns the `nsec` and hex encodings
- **AND** zeroizes the derived key material and the decrypted private key

#### Scenario: Incorrect password discloses nothing

- **GIVEN** the vault is unlocked
- **WHEN** the user supplies an incorrect password
- **THEN** the operation fails with an incorrect-password error
- **AND** no private-key material is returned
- **AND** the derived key material is zeroized

#### Scenario: Unlocked state alone is not sufficient

- **GIVEN** the vault is unlocked
- **WHEN** a caller requests private-key material without supplying a password
- **THEN** the request is rejected
- **AND** no `nsec`, hex key, or key bytes are returned

### Requirement: Password Policy Enforced At Key Creation

`KeyVaultService` SHALL apply the shared password policy before encrypting the first key in a vault, and SHALL reject a non-conforming password with a distinct error that the RPC layer can translate. When the vault already holds a key, the service SHALL apply only verification against existing key material.

#### Scenario: First generated key rejects a below-policy password

- **GIVEN** no key records exist
- **WHEN** `generateKey` is called with a four character password
- **THEN** the service throws a password policy error
- **AND** no private key is generated or encrypted
- **AND** no key record is written to storage

#### Scenario: First imported key rejects a below-policy password

- **GIVEN** no key records exist
- **WHEN** `importKey` is called with a valid private key and a four character password
- **THEN** the service throws a password policy error
- **AND** no key record is written to storage

#### Scenario: Subsequent keys are verified, not policy-checked

- **GIVEN** the vault already holds a key encrypted under a below-policy password
- **WHEN** `generateKey` is called with that same password
- **THEN** the service verifies the password against existing key material
- **AND** the service does not apply the creation policy
- **AND** an incorrect password still throws `incorrect_password`

#### Scenario: Rejected creation still zeroizes sensitive buffers

- **GIVEN** a key creation request is rejected for password policy
- **WHEN** the service returns control to the caller
- **THEN** any buffer holding the password or candidate private key is filled with zeros
- **AND** the error message does not contain the submitted password

### Requirement: Unlock Requires A Verified Password

The vault MUST NOT report a successful unlock, and MUST NOT record unlocked lock state, unless the supplied password has been verified against the stored vault envelope's verification material. An unlock attempt against a vault that has no stored envelope and no key records MUST fail with a distinct error identifying that no vault has been created, rather than reporting success because there was nothing to decrypt.

#### Scenario: Unlock when no vault has been created

- **GIVEN** there is no stored vault envelope and zero key records
- **WHEN** an unlock is attempted with any password
- **THEN** the unlock fails with a distinct error identifying that no vault has been created
- **AND** stored lock state continues to record a locked vault

#### Scenario: Unlock a created vault that holds zero key records

- **GIVEN** a stored vault envelope exists and the vault holds zero key records
- **WHEN** an unlock is attempted with the correct password
- **THEN** the password is verified against the envelope's verification material
- **AND** the unlock succeeds with an empty set of unlocked keys

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

### Requirement: Secret Cleanup Begins At Acquisition

Cleanup responsibility for a sensitive buffer SHALL begin at the moment the buffer is
successfully acquired, not at the moment the operation's main body is entered. Once an
operation holds a password-derived key-encryption key, a private key, a
data-encryption key, or any other secret buffer, every subsequent code path in that
operation — including a failure raised before the operation's main work starts — SHALL
zeroize that buffer before control returns to the caller.

An operation that acquires a secret and then performs fallible work outside its
cleanup block does not satisfy the Memory Zeroization requirement, even when its
success path and its main body both zeroize correctly.

Cleanup SHALL NOT alter the error the caller observes. The original error SHALL
propagate unchanged, with its message intact, so that cleanup can never mask or
replace a failure.

Where an operation transfers ownership of a secret to a longer-lived holder — the
unlocked-key set, or a caller documented as owning the returned buffer — it SHALL
zeroize that buffer on every failure path and SHALL NOT zeroize it on the success path
that performs the transfer.

#### Scenario: Malformed private key input still clears the derived key

- **GIVEN** a vault whose password successfully derives a key-encryption key
- **WHEN** `importKey` is called with a private-key string that the parser rejects
- **THEN** the call MUST reject with the parser's own error
- **AND** every byte of the derived key-encryption key MUST read zero
- **AND** no key record MUST be written to storage

#### Scenario: Random number generator failure still clears the derived key

- **GIVEN** a vault whose password successfully derives a key-encryption key
- **WHEN** `generateKey` is called and the platform random number generator throws while drawing the private key
- **THEN** the call MUST reject with that error
- **AND** every byte of the derived key-encryption key MUST read zero
- **AND** no key record MUST be written to storage

#### Scenario: Envelope persistence failure still clears the derived key

- **GIVEN** a vault with no envelope, so a write creates one
- **WHEN** the new envelope is created successfully but persisting it to storage fails
- **THEN** the call MUST reject
- **AND** every byte of the key-encryption key derived for that envelope MUST read zero

#### Scenario: Successful acquisition hands ownership to the caller

- **GIVEN** an internal helper documented as returning a live key-encryption key that the caller MUST zeroize
- **WHEN** the helper returns successfully
- **THEN** the returned buffer MUST still hold its derived bytes
- **AND** the calling operation MUST zeroize it before returning to its own caller, on both its success and its failure paths

#### Scenario: Existing success behavior is unchanged

- **WHEN** `generateKey` or `importKey` is called with a valid password and valid input
- **THEN** the key record MUST be created exactly as before this requirement was added
- **AND** the first key in an empty vault MUST still be marked selected
- **AND** the private key and the key-encryption key MUST both read zero after the call resolves

#### Scenario: Cleanup does not replace the original error

- **GIVEN** an operation that fails after acquiring a secret buffer
- **WHEN** the operation's cleanup runs
- **THEN** the error observed by the caller MUST be the error originally raised
- **AND** cleanup MUST NOT substitute a different error, swallow the failure, or return a value

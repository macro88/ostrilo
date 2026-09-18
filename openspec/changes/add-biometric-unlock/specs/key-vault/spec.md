## MODIFIED Requirements

### Requirement: Zero-Retention Password Handling

The system MUST NOT store the user's master password in memory or storage for longer than the duration of a single cryptographic operation. This applies to the password supplied at unlock, the password supplied when adding a key, and the password supplied to re-authenticate a high-risk action. The system SHALL verify the password against stored verification material on every unlock attempt, including when the vault holds zero key records, and SHALL derive exactly one password-derived key-encryption key per unlock attempt.

The vault SHALL admit exactly two producers of the vault key-encryption key: password derivation, and the biometric wrapping. Both producers SHALL prove the recovered key against the stored verification material before any per-record work, and neither SHALL retain the credential that produced it beyond the operation. The system SHALL NOT admit a third producer, and SHALL NOT accept a key-encryption key that has not been proven against the stored verification material. Each producer SHALL return the key-encryption key as a buffer owned by the caller, and the caller SHALL zeroize that buffer on every path.

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

#### Scenario: The second producer proves its key the same way

- **GIVEN** a vault with a biometric factor enrolled
- **WHEN** the key-encryption key is recovered from the biometric wrapping
- **THEN** it MUST decrypt the stored verification material before any key record is read
- **AND** a recovered value that fails the verification material MUST leave the vault locked
- **AND** no per-record unwrap or decrypt MUST be attempted

#### Scenario: Neither producer retains its credential

- **WHEN** an unlock completes or fails by either producer
- **THEN** the password MUST NOT be held on any class property or in storage
- **AND** the pseudo-random-function output MUST NOT be held on any class property or in storage
- **AND** neither credential MUST be reusable for a subsequent operation

#### Scenario: A third producer is not admitted

- **WHEN** the vault is searched for code paths that yield a vault key-encryption key
- **THEN** exactly two exist: password derivation and the biometric wrapping
- **AND** every other path that needs the key-encryption key obtains it from one of those two
- **AND** no path marks a session unlocked from an unproven key-encryption key

#### Scenario: The key-encryption key is owned by the caller

- **GIVEN** either producer returns a key-encryption key
- **WHEN** the calling operation completes or fails at any point
- **THEN** every byte of the returned buffer MUST read zero
- **AND** the producer MUST NOT retain a reference to it

### Requirement: Memory Zeroization

The system MUST explicitly zeroize all sensitive buffers (passwords, private keys, key-encryption keys, data-encryption keys, and any other derived keys) immediately after use, including when the vault is locked automatically after inactivity rather than by an explicit user action. This extends to the pseudo-random-function output, the buffer it is decoded into at the message boundary, and every intermediate buffer produced while unwrapping the key-encryption key from the biometric wrapping. Each of these MUST be zeroized in a `finally` block so the guarantee holds on the failure paths as well as the success path.

Two things CANNOT be zeroized and MUST NOT be claimed as erased: a non-extractable key object, which the platform holds and this code cannot reach; and the structured-clone copy the message bus makes of any value passed across it. The system SHALL address these by construction rather than by claim — the wrapping key SHALL exist only as a non-extractable key object and never as a byte buffer, and the exposure of the cloned copy SHALL be bounded by the lifetime of the message. Documentation and code comments SHALL state these limits plainly, as they already do for JavaScript strings.

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

#### Scenario: Pseudo-Random-Function Output

- **GIVEN** a pseudo-random-function output received at the message boundary
- **WHEN** the operation that decoded it completes or fails
- **THEN** the decoded buffer MUST be filled with zeros in a `finally` block
- **AND** the buffer holding the output inside the producing document MUST be filled with zeros in a `finally` block
- **AND** neither buffer MUST be retained on a class property, module variable, or in storage

#### Scenario: Unwrapping Intermediates

- **GIVEN** an unwrap of the key-encryption key from the biometric wrapping
- **WHEN** the unwrap completes or fails at any point, including a failure before the wrapping is opened
- **THEN** every intermediate buffer it produced MUST be filled with zeros in a `finally` block
- **AND** a recovered key-encryption key that fails the verification material MUST be filled with zeros before the failure is reported

#### Scenario: A Non-Extractable Key Is Not Claimed To Be Erased

- **GIVEN** a wrapping key derived from the pseudo-random-function output
- **WHEN** the operation that used it completes or fails
- **THEN** the key MUST be a non-extractable key object that never existed as a byte buffer
- **AND** the system MUST NOT claim that the key object was zeroized
- **AND** no code path MUST export its bytes

#### Scenario: The Message Bus Copy Is Not Claimed To Be Erased

- **GIVEN** a secret passed across the extension message boundary, which the bus structured-clones
- **WHEN** the message has been handled
- **THEN** the system MUST NOT claim the cloned copy was erased
- **AND** the documented exposure MUST be stated as bounded by the message lifetime
- **AND** the buffers on both sides that the code does own MUST still be filled with zeros

### Requirement: Unlock Requires A Verified Password

The vault MUST NOT report a successful unlock, and MUST NOT record unlocked lock state, unless the supplied password has been verified against the stored vault envelope's verification material. An unlock attempt against a vault that has no stored envelope and no key records MUST fail with a distinct error identifying that no vault has been created, rather than reporting success because there was nothing to decrypt.

A biometric unlock SHALL run the same per-record path a password unlock runs: unwrap each record's data-encryption key under the key-encryption key, decrypt each stored key into memory, and verify each decrypted key against its record's stored public key. The session SHALL be recorded as unlocked only after the decrypted key material is held in memory, by either producer. Before clearing the in-memory unlocked key map, an unlock SHALL zeroize every private key that map already holds, on the same terms as an explicit lock.

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

#### Scenario: A biometric unlock runs the same per-record path

- **GIVEN** the vault holds at least one key record and a biometric factor is enrolled
- **WHEN** a biometric unlock succeeds
- **THEN** each record's data-encryption key is unwrapped under the recovered key-encryption key
- **AND** each stored key is decrypted into memory and verified against its record's stored public key
- **AND** a record that fails verification is reported damaged exactly as it is on a password unlock
- **AND** the resulting set of unlocked keys is identical to the set a password unlock produces

#### Scenario: Unlocked state is recorded only after key material is held

- **GIVEN** an unlock by either producer
- **WHEN** the per-record path fails before any key material is held in memory
- **THEN** stored lock state continues to record a locked vault
- **AND** unlocked lock state is written only after the decrypted key material is present in the in-memory unlocked key map

#### Scenario: A re-entrant unlock zeroizes the keys it replaces

- **GIVEN** a vault already unlocked and holding decrypted private keys in memory
- **WHEN** a second unlock runs by either producer
- **THEN** every private key buffer the in-memory map already held MUST be filled with zeros before the map is cleared
- **AND** a test holding a reference to one of those buffers MUST read every byte as zero
- **AND** clearing the map without zeroizing MUST fail a test

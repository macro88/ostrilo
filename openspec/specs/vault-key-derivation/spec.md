# vault-key-derivation Specification

## Purpose

Defines how the extension derives the vault encryption key from the user's password and how every stored key record declares the format version and derivation parameters that produced it. Covers memory-hard derivation, per-record authenticated encryption bound to record metadata, verification of decrypted keys, and migration of legacy records.
## Requirements
### Requirement: Vault Records Declare Their Own Format Version

Every stored vault record SHALL carry an explicit numeric format version field. Code that reads a vault record SHALL branch on that version and MUST NOT infer the format from the presence or absence of other fields.

#### Scenario: New record is written with a version

- **WHEN** the extension encrypts a private key and writes the record to storage
- **THEN** the stored record includes a numeric format version field
- **AND** the version identifies the envelope layout and the derivation scheme in use

#### Scenario: Unknown future version is refused, not guessed

- **GIVEN** a stored record whose format version is higher than any version this build understands
- **WHEN** the user attempts to unlock the vault
- **THEN** the extension does not attempt to decrypt that record
- **AND** the extension reports an unsupported-vault-format condition distinct from an incorrect password
- **AND** the extension does not delete, rewrite, or overwrite the record

#### Scenario: Missing version is treated as the legacy format

- **GIVEN** a stored record with no format version field
- **WHEN** the extension reads that record
- **THEN** the extension treats it as the legacy PBKDF2-HMAC-SHA256 100,000-iteration format
- **AND** the extension does not treat it as corrupt

### Requirement: Vault Records Declare Their Own KDF Parameters

Every stored vault record SHALL carry the key derivation parameters that produced its encryption key, including the algorithm identifier, the salt, and every cost parameter the algorithm takes. Derivation on read SHALL use the parameters recorded in the record and MUST NOT use compiled-in constants.

#### Scenario: Argon2id parameters are recorded

- **WHEN** the extension derives a key with Argon2id and writes the resulting record
- **THEN** the record stores the algorithm identifier, the salt, the memory cost, the time cost, the parallelism, and the derived key length

#### Scenario: PBKDF2 parameters are recorded

- **WHEN** the extension derives a key with PBKDF2-HMAC-SHA256 and writes the resulting record
- **THEN** the record stores the algorithm identifier, the salt, the iteration count, the hash function, and the derived key length

#### Scenario: Read path honours recorded parameters over code defaults

- **GIVEN** a record whose recorded cost parameters differ from this build's current defaults
- **WHEN** the user unlocks the vault with the correct password
- **THEN** the extension derives the key using the parameters recorded in the record
- **AND** the decryption succeeds

#### Scenario: Parameters below the accepted floor are rejected on read

- **GIVEN** a record whose recorded cost parameters fall below the minimum this build accepts
- **WHEN** the extension reads that record
- **THEN** the extension refuses to accept the recorded parameters as sufficient
- **AND** the extension reports a downgraded-parameters condition distinct from an incorrect password

### Requirement: Password Derivation Is Memory-Hard

The extension SHALL derive the vault encryption key from the user's password using Argon2id with a memory cost of at least 65536 KiB, a time cost of at least 3, a parallelism of at least 1, a random salt of at least 16 bytes, and a derived key length of 32 bytes.

#### Scenario: Default derivation uses Argon2id

- **WHEN** a user sets a vault password and the extension derives the encryption key
- **THEN** the extension uses Argon2id
- **AND** the memory cost is at least 65536 KiB
- **AND** the time cost is at least 3
- **AND** the derived key is 32 bytes

#### Scenario: Salt is unique per derivation

- **WHEN** the extension derives a vault encryption key
- **THEN** the salt is generated from a cryptographically secure random source
- **AND** the salt is at least 16 bytes
- **AND** the salt differs from the salt of any previously written vault envelope

#### Scenario: Interim PBKDF2 fallback meets current guidance

- **GIVEN** a runtime where Argon2id derivation cannot be completed
- **WHEN** the extension falls back to PBKDF2-HMAC-SHA256
- **THEN** the iteration count is at least 600,000
- **AND** the derivation uses the platform WebCrypto implementation rather than a pure-JavaScript implementation
- **AND** the fallback parameters are recorded in the written record

### Requirement: One Password Derivation Unlocks The Whole Vault

The extension SHALL derive exactly one password-derived key-encryption key per unlock attempt, regardless of how many key records the vault holds. Each key record SHALL be encrypted under its own data-encryption key, and each data-encryption key SHALL be wrapped by the vault's key-encryption key.

#### Scenario: Unlock cost does not scale with key count

- **GIVEN** a vault holding five key records
- **WHEN** the user unlocks the vault with the correct password
- **THEN** the password-based key derivation function runs exactly once
- **AND** all five key records are decrypted

#### Scenario: Adding a key does not require re-deriving from the password more than once

- **GIVEN** an unlocked vault holding one key record
- **WHEN** the user adds a second key with the correct password
- **THEN** the password-based key derivation function runs at most once for that operation
- **AND** the new key record is encrypted under a freshly generated data-encryption key
- **AND** that data-encryption key is wrapped by the existing vault key-encryption key

#### Scenario: Each key record has an independent data-encryption key

- **GIVEN** a vault holding two key records
- **WHEN** the stored envelope is inspected
- **THEN** each key record's wrapped data-encryption key differs from the other's
- **AND** each key record has its own initialization vector

### Requirement: Ciphertext Is Bound To Its Record Metadata

The extension SHALL pass additional authenticated data to every AES-GCM encryption and decryption of vault material. The additional authenticated data SHALL cover the record format version, the serialized KDF parameters, the key record identifier, and the record's stored public key. Decryption SHALL fail when any bound field does not match the value supplied at encryption time.

#### Scenario: Swapped ciphertext between records is rejected

- **GIVEN** two key records A and B in the vault
- **WHEN** an attacker with storage write access copies record B's ciphertext into record A
- **AND** the user unlocks the vault with the correct password
- **THEN** decryption of record A fails authentication
- **AND** the extension does not report the failure as an incorrect password

#### Scenario: Downgraded KDF parameters are rejected

- **GIVEN** a record encrypted with recorded Argon2id parameters
- **WHEN** an attacker rewrites the record's KDF parameters to weaker values
- **AND** the user unlocks the vault with the correct password
- **THEN** decryption fails authentication because the bound parameters no longer match
- **AND** the extension reports a tampered-record condition

#### Scenario: Substituted public key is rejected

- **GIVEN** a record whose ciphertext was bound to its stored public key
- **WHEN** an attacker rewrites the record's stored public key
- **AND** the user unlocks the vault with the correct password
- **THEN** decryption fails authentication
- **AND** no private key material is loaded into memory for that record

#### Scenario: Substituted record identifier is rejected

- **GIVEN** a record whose ciphertext was bound to its record identifier
- **WHEN** an attacker rewrites the record identifier
- **AND** the user unlocks the vault with the correct password
- **THEN** decryption fails authentication for that record

### Requirement: Decrypted Keys Are Verified Against The Stored Public Key

After decrypting a key record, the extension SHALL derive the public key from the recovered private key and compare it with the record's stored public key. The extension MUST NOT make a key available for signing when the derived public key does not match.

#### Scenario: Matching key is admitted

- **GIVEN** a key record whose ciphertext holds the private key for its stored public key
- **WHEN** the user unlocks the vault with the correct password
- **THEN** the extension derives the public key from the decrypted private key
- **AND** the derived public key equals the stored public key
- **AND** the key becomes available for signing

#### Scenario: Mismatched key is rejected and zeroized

- **GIVEN** a key record whose decrypted private key does not derive its stored public key
- **WHEN** the user unlocks the vault with the correct password
- **THEN** the extension does not add that key to the unlocked set
- **AND** the decrypted private key buffer is zeroized
- **AND** the extension reports a damaged-record condition for that record

#### Scenario: Reveal path verifies before returning material

- **GIVEN** the user requests to reveal a key with the correct password
- **WHEN** the record decrypts but the recovered private key does not derive the stored public key
- **THEN** the extension does not return the recovered material to the caller
- **AND** the extension reports a damaged-record condition

### Requirement: Record Failures Are Isolated From Password Failures

Unlock SHALL evaluate each key record independently. A failure to decrypt or verify one record MUST NOT prevent other verified records from becoming available, and MUST NOT be reported to the user as an incorrect password.

#### Scenario: One damaged record does not block the vault

- **GIVEN** a vault holding three key records where one record's ciphertext is corrupt
- **WHEN** the user unlocks the vault with the correct password
- **THEN** the two intact keys become available for signing
- **AND** the vault reports the damaged record separately
- **AND** the unlock is not reported as an incorrect password

#### Scenario: Wrong password is reported as a wrong password

- **GIVEN** a vault holding intact key records
- **WHEN** the user attempts to unlock with an incorrect password
- **THEN** the extension reports an incorrect password
- **AND** the vault remains locked
- **AND** no key becomes available for signing

#### Scenario: Damaged record surfaces distinct user-facing copy

- **GIVEN** a vault where every key record fails verification but the password is correct
- **WHEN** the user attempts to unlock
- **THEN** the extension reports that stored key data is damaged or has been altered
- **AND** the extension does not tell the user the password was wrong

### Requirement: Empty Vault Unlock Requires Real Password Verification

The extension SHALL verify the supplied password against stored verification material before marking the session unlocked, including when the vault holds zero key records. The extension MUST NOT report an unlock as successful on the basis of there being nothing to decrypt.

#### Scenario: Empty vault rejects an arbitrary password

- **GIVEN** a vault with a password set and zero key records
- **WHEN** the user attempts to unlock with an incorrect password
- **THEN** the extension reports an incorrect password
- **AND** the session lock state remains locked

#### Scenario: Empty vault accepts the correct password

- **GIVEN** a vault with a password set and zero key records
- **WHEN** the user unlocks with the correct password
- **THEN** the extension verifies the password against stored verification material
- **AND** the session lock state becomes unlocked
- **AND** no key is reported as available for signing

#### Scenario: Vault with no password set cannot be unlocked

- **GIVEN** storage that holds no vault envelope and no key records
- **WHEN** an unlock is attempted with any password
- **THEN** the extension does not mark the session unlocked
- **AND** the extension reports that no vault has been created

### Requirement: Legacy Records Migrate On Successful Unlock

The extension SHALL migrate unversioned legacy records to the current envelope format after the password has been verified against that legacy record. Migration SHALL write the new envelope and confirm it decrypts and verifies before the legacy record is removed. A migration failure MUST leave the legacy record intact and the key recoverable.

#### Scenario: Legacy record is re-encrypted after unlock

- **GIVEN** a vault holding one unversioned record encrypted with PBKDF2-HMAC-SHA256 at 100,000 iterations
- **WHEN** the user unlocks with the correct password
- **THEN** the extension decrypts the legacy record using the legacy parameters
- **AND** the extension re-encrypts the key into the current versioned envelope
- **AND** the new record carries the current format version and KDF parameters

#### Scenario: Legacy record is retained until the new envelope verifies

- **GIVEN** a legacy record being migrated during unlock
- **WHEN** the newly written envelope is read back
- **THEN** the extension decrypts it and verifies the recovered key against the stored public key
- **AND** only after that verification succeeds does the extension remove the legacy record

#### Scenario: Interrupted migration loses no key

- **GIVEN** a legacy record being migrated during unlock
- **WHEN** the extension is terminated before the migration completes
- **THEN** the legacy record is still present in storage on the next start
- **AND** the user can unlock with the same password
- **AND** the migration is retried

#### Scenario: Failed migration does not block signing

- **GIVEN** a legacy record whose re-encryption fails
- **WHEN** the user unlocks with the correct password
- **THEN** the decrypted key is still available for signing in this session
- **AND** the extension records that the record remains on the legacy format

#### Scenario: Mixed-format vault unlocks

- **GIVEN** a vault holding one unversioned legacy record and one current-version record
- **WHEN** the user unlocks with the correct password
- **THEN** both keys become available for signing

### Requirement: Unlock Remains Responsive Under Hardened Parameters

The extension SHALL select derivation parameters so that a single unlock derivation completes within one second on a mid-range laptop, and SHALL show a pending state for the duration of the derivation. The unlock control SHALL be disabled while a derivation is in flight so a single unlock attempt cannot be submitted concurrently.

#### Scenario: Unlock shows a pending state

- **WHEN** the user submits an unlock attempt
- **THEN** the unlock control enters a pending state until the derivation resolves
- **AND** the control cannot be submitted again while pending

#### Scenario: Derivation yields to the runtime

- **WHEN** the extension performs the unlock derivation in the background context
- **THEN** the derivation does not block the runtime for the whole derivation in one uninterruptible step

#### Scenario: Parameters are documented against a latency budget

- **WHEN** the shipped derivation parameters are changed
- **THEN** the change records the measured derivation time on a mid-range laptop
- **AND** the measured time is within the stated one-second unlock budget

### Requirement: Stored KDF Parameters Are Bounded Above

The vault SHALL refuse, before any key derivation, a stored record or envelope whose recorded KDF parameters exceed the ceilings defined beside `KDF_FLOORS`, in the same way it refuses parameters below the floor. The shipped defaults SHALL lie within the floors and ceilings.

#### Scenario: A tampered memory cost is refused without deriving

- **GIVEN** a stored envelope whose Argon2id memory cost exceeds the ceiling
- **WHEN** the user attempts to unlock
- **THEN** unlock fails with a KDF-parameter error
- **AND** no Argon2id derivation is started

#### Scenario: Defaults sit inside the bounds

- **WHEN** the security suite compares `KDF_DEFAULTS` with the floors and ceilings
- **THEN** every default parameter is at or above its floor and at or below its ceiling


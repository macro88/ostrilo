## MODIFIED Requirements

### Requirement: Vault Records Declare Their Own Format Version

Every stored vault record SHALL carry an explicit numeric format version field. Code that reads a vault record SHALL branch on that version and MUST NOT infer the format from the presence or absence of other fields. Adding an alternative wrapping of the vault key-encryption key, such as a biometric wrapping, SHALL NOT bump the vault envelope version and SHALL NOT cause the envelope verifier or any key record ciphertext to be re-encrypted.

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

#### Scenario: Enrolling a biometric wrapping does not bump the envelope version

- **GIVEN** a vault envelope at the current format version
- **WHEN** a biometric wrapping of the vault key-encryption key is enrolled
- **THEN** the envelope version field is unchanged
- **AND** the set of supported vault versions this build accepts is unchanged

#### Scenario: Enrolling a biometric wrapping re-encrypts no existing ciphertext

- **GIVEN** a vault holding an envelope verifier and one or more key records
- **WHEN** a biometric wrapping is enrolled
- **THEN** the envelope verifier ciphertext is byte-identical to its value before enrolment
- **AND** every key record's wrapped data-encryption key and ciphertext are byte-identical to their values before enrolment

#### Scenario: A build that predates the biometric wrapping still reads the vault

- **GIVEN** a vault carrying a biometric wrapping stored outside the envelope
- **WHEN** a build that does not understand that wrapping reads the envelope
- **THEN** the envelope version is one that build already supports
- **AND** the user unlocks with the correct password unchanged

### Requirement: Vault Records Declare Their Own KDF Parameters

Every stored vault record SHALL carry the key derivation parameters that produced its encryption key, including the algorithm identifier, the salt, and every cost parameter the algorithm takes. Derivation on read SHALL use the parameters recorded in the record and MUST NOT use compiled-in constants. The parameter-acceptance check SHALL continue to refuse an unrecognised algorithm identifier. A wrapping of the key-encryption key produced from a credential rather than from the password, such as a biometric wrapping, SHALL NOT be expressed as a key-derivation algorithm variant, SHALL NOT be recorded in a record's key derivation parameters, and SHALL NOT be submitted to or accepted by the parameter-acceptance check. Such a wrapping SHALL instead bind the live envelope's format version, algorithm identifier, every cost parameter and salt into its authenticated encryption, so that a replaced or rolled-back envelope makes the wrapping undecryptable by construction rather than by a separate consistency check.

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

#### Scenario: An unrecognised algorithm identifier is still refused

- **GIVEN** a record whose recorded algorithm identifier is not one this build derives passwords with
- **WHEN** the extension checks the recorded parameters
- **THEN** the extension refuses them as an unknown algorithm
- **AND** the acceptance check is not widened to admit any credential-derived wrapping

#### Scenario: A biometric wrapping is not a KDF variant

- **GIVEN** a vault with a biometric wrapping enrolled
- **WHEN** the stored key derivation parameters of the envelope and every key record are inspected
- **THEN** none of them names a biometric, credential, or pseudo-random-function algorithm
- **AND** the wrapping is stored outside the recorded key derivation parameters

#### Scenario: A biometric wrapping is never submitted to the parameter-acceptance check

- **WHEN** a biometric wrapping is opened
- **THEN** no key derivation parameters describing that wrapping are passed to the parameter-acceptance check
- **AND** the check continues to see only password-derivation parameters

#### Scenario: A rolled-back envelope makes the wrapping undecryptable

- **GIVEN** a biometric wrapping bound to the live envelope's version, algorithm, cost parameters and salt
- **WHEN** an attacker with storage write access replaces the envelope with an earlier one carrying a different salt or weaker cost parameters
- **THEN** the wrapping fails authenticated decryption
- **AND** no key-encryption key is recovered
- **AND** the refusal comes from the authenticated encryption itself, not from a separate comparison of the recorded parameters

#### Scenario: An envelope replaced outside the extension makes a surviving wrapping undecryptable

- **GIVEN** a wrapping that survives an envelope replacement the extension did not perform, such as a restored or attacker-supplied envelope carrying a fresh salt
- **WHEN** a biometric unlock is attempted against a wrapping bound to the previous envelope
- **THEN** the wrapping fails authenticated decryption
- **AND** the vault remains unlocked only by the password

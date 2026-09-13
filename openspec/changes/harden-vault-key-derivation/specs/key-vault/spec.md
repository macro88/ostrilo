## MODIFIED Requirements

### Requirement: Zero-Retention Password Handling

The system MUST NOT store the user's master password in memory or storage for longer than the duration of a single cryptographic operation. The system SHALL verify the password against stored verification material on every unlock attempt, including when the vault holds zero key records, and SHALL derive exactly one password-derived key-encryption key per unlock attempt.

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

- **GIVEN** the vault is locked and holds zero key records
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

### Requirement: Memory Zeroization

The system MUST explicitly zeroize all sensitive buffers (passwords, private keys, key-encryption keys, data-encryption keys, and any other derived keys) immediately after use.

#### Scenario: Cryptographic Operations

- **GIVEN** a cryptographic operation (encrypt, decrypt, wrap, unwrap, sign)
- **WHEN** the operation completes or fails
- **THEN** all intermediate buffers containing sensitive data MUST be filled with zeros

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

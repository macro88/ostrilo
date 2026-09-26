## ADDED Requirements

### Requirement: Backup File KDF Parameters Are Bounded Above

Restoring an encrypted backup SHALL refuse, before any key derivation, a file whose recorded KDF parameters exceed the ceilings defined beside `KDF_FLOORS`, and SHALL report it with the same generic decryption-failure message used for a wrong passphrase or a parameter below the floor.

#### Scenario: A crafted backup with an extreme memory cost

- **GIVEN** a backup file whose Argon2id memory cost exceeds the ceiling
- **WHEN** the user imports it with any passphrase
- **THEN** the import fails with the generic decryption-failure message
- **AND** no Argon2id derivation is started

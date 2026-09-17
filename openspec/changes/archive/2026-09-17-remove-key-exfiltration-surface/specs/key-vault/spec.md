## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Passwordless Private Key Export

**Reason**: `KeyVaultService.exportKey()` and the `vault.export` RPC method returned the raw `nsec` and hex private key whenever the vault was unlocked, with no password, no user consent, and no activity-log entry. The method had no caller in the extension: the only private-key disclosure the product actually uses is the password re-verified reveal path. Keeping an uncallable, unlogged, passwordless key-disclosure method on the message bus was pure downside for a signer.

**Migration**: Use `vault.reveal`, which requires the user's password, re-derives the encryption key from the stored key record's salt, verifies the password by decrypting, and zeroizes derived and decrypted material. The onboarding backup flow and the reveal-key dialog already use this path, so no user-facing behavior changes. Callers of the removed `exportKey()` client wrapper must collect the password and call `revealKey(password, keyId)` instead.

#### Scenario: Passwordless export is no longer available

- **GIVEN** the vault is unlocked
- **WHEN** a caller attempts a passwordless private-key export
- **THEN** no such operation exists on the vault service or the RPC surface
- **AND** private-key disclosure is available only through the password re-verified reveal path

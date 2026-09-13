## ADDED Requirements

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

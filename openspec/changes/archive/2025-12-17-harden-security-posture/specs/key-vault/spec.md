# Key Vault Security

## ADDED Requirements

### Requirement: Zero-Retention Password Handling
The system MUST NOT store the user's master password in memory or storage for longer than the duration of a single cryptographic operation.

#### Scenario: Unlock Vault
**Given** the vault is locked
**When** the user enters their password to unlock
**Then** the system derives the master key
**And** decrypts the stored keys into memory
**And** immediately zeroizes the password and derived master key
**And** does NOT store the password in any class property or storage

#### Scenario: Add Key
**Given** the vault is unlocked
**When** the user wants to add a new key
**Then** the system MUST require the user to re-enter their password
**And** use the password to encrypt the new key
**And** immediately zeroize the password

### Requirement: Memory Zeroization
The system MUST explicitly zeroize all sensitive buffers (passwords, private keys, derived keys) immediately after use.

#### Scenario: Cryptographic Operations
**Given** a cryptographic operation (encrypt, decrypt, sign)
**When** the operation completes or fails
**Then** all intermediate buffers containing sensitive data MUST be filled with zeros

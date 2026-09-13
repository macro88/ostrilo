## MODIFIED Requirements

### Requirement: Memory Zeroization

The system MUST explicitly zeroize all sensitive byte buffers (private keys, derived keys, decrypted plaintext) immediately after use. For secrets held as JavaScript strings, notably the vault password, erasure is not achievable: a string is immutable and its backing storage is not addressable from script. For those secrets the system MUST instead create no copy that the operation does not require, MUST NOT retain the value on any instance property, module variable, or storage, and MUST drop its references as soon as the operation completes or fails. Specifications, tests, and user-facing claims MUST NOT assert that a string secret has been wiped from memory.

#### Scenario: Cryptographic Operations

- **GIVEN** a cryptographic operation (encrypt, decrypt, sign)
- **WHEN** the operation completes or fails
- **THEN** all intermediate byte buffers containing sensitive data MUST be filled with zeros

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

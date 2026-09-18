## MODIFIED Requirements

### Requirement: Cryptographic Libraries Confined To The Adapter Layer

Modules under `src/infrastructure/` SHALL be the only modules permitted to import `@noble/*` or `@scure/*`. Domain, application, extension entry-point and UI modules SHALL obtain cryptographic operations through the ports declared in `src/application/ports/crypto.ts`. HKDF-SHA256 and ECDSA P-256 signature verification SHALL each be reached through a port declared in that file, and each SHALL have exactly one adapter, located under `src/infrastructure/crypto/`. The HKDF port SHALL return a non-extractable key object and SHALL NOT expose derived key bytes to any caller. The ECDSA P-256 port SHALL be verify-only: it SHALL expose no signing operation and no key generation operation. No cryptographic package SHALL be added to the project's dependencies to satisfy these ports.

#### Scenario: Domain layer cannot import a crypto library

- **GIVEN** the lint configuration restricts cryptographic library imports
- **WHEN** a module under `src/domain/` imports from `@noble/curves`, `@noble/hashes` or `@scure/base`
- **THEN** linting SHALL fail with an error naming the restricted import
- **AND** the error SHALL direct the author to the crypto ports

#### Scenario: Application layer cannot import a crypto library

- **GIVEN** the lint configuration restricts cryptographic library imports
- **WHEN** a module under `src/application/` imports from `@noble/*` or `@scure/*`
- **THEN** linting SHALL fail
- **AND** the application layer SHALL instead declare its need as a port and receive an adapter by constructor injection

#### Scenario: Adapter layer may import crypto libraries

- **GIVEN** the lint configuration restricts cryptographic library imports
- **WHEN** a module under `src/infrastructure/crypto/` imports from `@noble/*` or `@scure/*`
- **THEN** linting SHALL pass
- **AND** that module SHALL implement a port declared in `src/application/ports/crypto.ts`

#### Scenario: UI layer cannot reach a primitive directly

- **GIVEN** the UI runs outside the background context and never handles private key material
- **WHEN** a module under `src/ui/` imports from `@noble/*` or `@scure/*`
- **THEN** linting SHALL fail
- **AND** the UI SHALL obtain the result through the messaging client or through a pure domain helper

#### Scenario: HKDF is reached through a port with one adapter

- **GIVEN** a caller that must stretch input keying material into a wrapping key
- **WHEN** it performs HKDF-SHA256
- **THEN** it SHALL reach the operation through a port declared in `src/application/ports/crypto.ts`
- **AND** exactly one HKDF-SHA256 implementation SHALL exist in `src/`
- **AND** that implementation SHALL live under `src/infrastructure/crypto/`

#### Scenario: The HKDF port never yields derived bytes

- **GIVEN** the declared signature of the HKDF port
- **WHEN** it is inspected
- **THEN** it SHALL return a non-extractable key object
- **AND** it SHALL declare no return type and no parameter that carries derived key bytes
- **AND** no caller SHALL be able to read the derived key as a byte buffer

#### Scenario: ECDSA P-256 is reached through a port with one adapter

- **GIVEN** a caller that must verify an ECDSA P-256 signature
- **WHEN** it performs the verification
- **THEN** it SHALL reach the operation through a port declared in `src/application/ports/crypto.ts`
- **AND** exactly one ECDSA P-256 implementation SHALL exist in `src/`
- **AND** that implementation SHALL live under `src/infrastructure/crypto/`

#### Scenario: The ECDSA P-256 port offers no signing or key generation

- **GIVEN** the declared ECDSA P-256 port and its adapter
- **WHEN** they are inspected
- **THEN** they SHALL expose a verification operation only
- **AND** they SHALL expose no signing operation
- **AND** they SHALL expose no key-generation operation

#### Scenario: No cryptographic package is added

- **GIVEN** the project dependency manifest before and after this change
- **WHEN** they are compared
- **THEN** no cryptographic package SHALL have been added
- **AND** the ECDSA P-256 adapter SHALL use the already-declared `@noble/curves` dependency
- **AND** the HKDF adapter SHALL use the platform `crypto.subtle` implementation

## ADDED Requirements

### Requirement: Credential-Management Access Is A Separate Platform Port

Access to the browser credential-management API SHALL be reached only through a port dedicated to it, declared separately from the cryptographic ports, with exactly one adapter that runs in a document context. The credential-management API is platform input and output, not a cryptographic primitive. The background worker SHALL NOT import that port's adapter, and the background bundle SHALL contain no reference to the credential-management API.

#### Scenario: Ceremony access is declared outside the crypto ports

- **GIVEN** the port declarations in `src/application/ports/`
- **WHEN** they are inspected
- **THEN** the credential-management operations SHALL be declared in their own port module
- **AND** they SHALL NOT be declared in `src/application/ports/crypto.ts`

#### Scenario: Exactly one document-context adapter exists

- **GIVEN** a repository-wide search for credential-management API usage in `src/`
- **WHEN** it is run
- **THEN** it SHALL report exactly one module
- **AND** that module SHALL implement the credential-management port
- **AND** that module SHALL run only in a document context

#### Scenario: The background bundle contains no credential-management reference

- **GIVEN** the built background bundle
- **WHEN** it is inspected
- **THEN** it SHALL contain no credential-management API reference
- **AND** it SHALL not import the credential-management adapter

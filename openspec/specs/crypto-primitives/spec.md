# crypto-primitives Specification

## Purpose
Defines how cryptographic primitives are implemented and layered in the extension: exactly one implementation of each primitive, crypto libraries confined to the adapter layer, and signing behaviour preserved across consolidation.

## Requirements

### Requirement: Single Implementation Per Cryptographic Primitive

The codebase SHALL contain exactly one implementation of each cryptographic primitive reachable from `src/`. The primitives covered are private-key parsing, private-key generation, public-key derivation, password-based key derivation, authenticated encryption, Schnorr signing, SHA-256 hashing, bech32 encoding and decoding, and hex encoding and decoding.

#### Scenario: One private-key parser

- **GIVEN** the extension accepts a private key as 64-character hex or as `nsec` bech32
- **WHEN** a private key is parsed for the `crypto.parsePrivateKey` RPC and when it is parsed during `vault.importKey`
- **THEN** both paths SHALL reach the same parsing implementation
- **AND** no other private-key parsing implementation SHALL exist in `src/`

#### Scenario: One private-key generator

- **GIVEN** a new Nostr identity is created
- **WHEN** the extension generates the 32-byte secret
- **THEN** exactly one key-generation implementation SHALL exist in `src/`
- **AND** it SHALL draw its bytes from the platform cryptographically secure random number generator

#### Scenario: One key derivation and one authenticated encryption implementation

- **GIVEN** the vault encrypts and decrypts private keys at rest
- **WHEN** a password is turned into key material and a private key is sealed or opened
- **THEN** exactly one password-based key derivation implementation SHALL exist in `src/`
- **AND** exactly one AES-GCM implementation SHALL exist in `src/`
- **AND** both SHALL be the implementations that the background composition root injects into the key vault service

#### Scenario: Reintroduced duplicate fails verification

- **GIVEN** the single-implementation guarantee is asserted by an automated test
- **WHEN** a second implementation of any covered primitive is added anywhere under `src/`
- **THEN** that test SHALL fail
- **AND** the failure message SHALL name the primitive and every file that implements it

### Requirement: Cryptographic Libraries Confined To The Adapter Layer

Modules under `src/infrastructure/` SHALL be the only modules permitted to import `@noble/*` or `@scure/*`. Domain, application, extension entry-point and UI modules SHALL obtain cryptographic operations through the ports declared in `src/application/ports/crypto.ts`.

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

### Requirement: Hex Decoding Rejects Malformed Input

The hex decoder SHALL reject any input that is not an even-length string of hexadecimal characters by throwing an error. It SHALL NOT substitute a zero byte, a partial result, or any other value for an unparseable character pair.

#### Scenario: Even-length non-hex input is rejected

- **GIVEN** the string `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz`, which is 64 characters long and contains no hexadecimal digits
- **WHEN** it is passed to the hex decoder
- **THEN** the decoder SHALL throw an error
- **AND** the error SHALL identify the input as containing non-hexadecimal characters
- **AND** the decoder SHALL NOT return a 32-byte array of zeros

#### Scenario: Odd-length input is rejected

- **GIVEN** the string `deadbee`, which has odd length
- **WHEN** it is passed to the hex decoder
- **THEN** the decoder SHALL throw an error identifying the length as invalid

#### Scenario: Partially malformed input is rejected

- **GIVEN** a string whose leading characters are valid hexadecimal and whose trailing characters are not
- **WHEN** it is passed to the hex decoder
- **THEN** the decoder SHALL throw an error
- **AND** SHALL NOT return the bytes it managed to decode before reaching the malformed pair

#### Scenario: Valid hex round-trips in both cases

- **GIVEN** a byte array
- **WHEN** it is hex-encoded and then hex-decoded
- **THEN** the result SHALL equal the original bytes
- **AND** decoding SHALL accept both uppercase and lowercase hexadecimal digits
- **AND** encoding SHALL always emit lowercase hexadecimal digits

#### Scenario: Key list surfaces a malformed stored pubkey as an error

- **GIVEN** a stored key record whose `pubkey` field is not valid 64-character hex
- **WHEN** the key manager builds the key list for display
- **THEN** the extension SHALL NOT display a bech32 public key derived from substituted zero bytes
- **AND** the extension SHALL report the record as unreadable rather than rendering a value the user could mistake for their identity

### Requirement: NIP-01 Pre-Image Serialization Is A Pure Domain Function

The function that produces the NIP-01 event id pre-image SHALL live in the domain layer, SHALL be free of side effects, and SHALL have no dependency on any cryptographic library. It SHALL return the serialized `[0, pubkey, created_at, kind, tags, content]` string and SHALL NOT perform hashing, encoding of the digest, or signing.

#### Scenario: Serializer is dependency-free and testable in isolation

- **GIVEN** the NIP-01 pre-image serializer
- **WHEN** its module dependencies are inspected
- **THEN** it SHALL import no cryptographic library and no browser API
- **AND** it SHALL be callable in a unit test without any adapter, port or mock

#### Scenario: Hashing is supplied by an adapter behind a port

- **GIVEN** an event id must be computed
- **WHEN** the pre-image string is hashed to produce the id
- **THEN** the SHA-256 operation SHALL be reached through a port declared in `src/application/ports/crypto.ts`
- **AND** the concrete SHA-256 implementation SHALL live in `src/infrastructure/crypto/`

### Requirement: Consolidation Preserves Signing Output

Consolidating the duplicate implementations SHALL NOT change any value the extension produces or stores. For every event and every key, the surviving implementation SHALL produce a byte-identical event id and a signature that verifies against the same public key as before the consolidation.

#### Scenario: Official known-answer vectors pass

- **GIVEN** the vendored official NIP-01 event id vectors and BIP-340 Schnorr signature vectors
- **WHEN** the consolidated implementations are run against them
- **THEN** every computed event id SHALL match the expected id exactly
- **AND** every produced signature SHALL verify against the expected public key
- **AND** every vector marked invalid SHALL be rejected

#### Scenario: Stored vault records remain readable

- **GIVEN** a vault whose key records were written before this change
- **WHEN** the user unlocks after this change
- **THEN** every record SHALL decrypt successfully
- **AND** no storage migration SHALL be required by this change

#### Scenario: RPC methods keep their meaning

- **GIVEN** the `crypto.parsePrivateKey`, `nostr.getPublicKey` and `nostr.signEvent` methods
- **WHEN** a caller invokes them after this change
- **THEN** each method SHALL accept the same request shape as before this change
- **AND** every response field that existed before SHALL carry the same meaning and the same value
- **AND** the error codes returned for invalid input SHALL be unchanged
- **AND** any field added to a response SHALL be additive, so an existing caller that ignores it behaves identically

### Requirement: No Unreachable Cryptographic Code

The codebase SHALL NOT export a cryptographic function, type or interface from `src/` that has no caller or implementor in `src/`. Cryptographic code that exists only to be found by a future author is a duplication hazard and SHALL be deleted rather than retained for possible reuse.

#### Scenario: Dead cryptographic exports are detected

- **GIVEN** an unused-export analysis or an equivalent repository-wide search
- **WHEN** it is run over the cryptographic modules
- **THEN** it SHALL report no exported cryptographic symbol that lacks a caller or implementor in `src/`

#### Scenario: Unused imports of removed symbols are cleared

- **GIVEN** a module that imports a cryptographic symbol it never references
- **WHEN** this change completes
- **THEN** that import SHALL be removed
- **AND** type checking SHALL succeed with no unresolved cryptographic import

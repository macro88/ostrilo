# Crypto Interop Vectors Specification

## Purpose

Require the project's cryptographic code to be proven against official, externally published test vectors rather than self-consistency checks. Covers vendored BIP-340 and NIP-01 known-answer vectors, pinned serialization edge cases, vector provenance, and the gate these vectors place on crypto consolidation.

## Requirements

### Requirement: Official BIP-340 Vectors Are Vendored And Executed

The repository SHALL vendor the official BIP-340 Schnorr signature test vectors and SHALL execute them as known-answer tests. Self-consistency tests that sign and then verify with the same implementation SHALL NOT be accepted as proof of correctness.

#### Scenario: Verification vectors run through the project verifier

- **GIVEN** the vendored BIP-340 vector file
- **WHEN** each verification vector is fed to the project's own signature verification function
- **THEN** every vector marked valid verifies as valid
- **AND** every vector marked invalid verifies as invalid
- **AND** the recorded failure comment for each invalid vector is asserted or documented

#### Scenario: Signing vectors reproduce the published signatures

- **GIVEN** a BIP-340 signing vector with a secret key, message, and auxiliary randomness
- **WHEN** the signature is produced with that auxiliary randomness
- **THEN** the resulting signature equals the published signature byte for byte

#### Scenario: Public key derivation matches the vectors

- **GIVEN** a BIP-340 vector secret key
- **WHEN** the x-only public key is derived through the project's derivation path
- **THEN** it equals the published public key

#### Scenario: Project signer output verifies against the vector public key

- **GIVEN** the project's own signing path uses fresh auxiliary randomness and therefore cannot reproduce a fixed signature
- **WHEN** it signs a vector message with a vector secret key
- **THEN** the produced signature verifies against the published public key and message

### Requirement: NIP-01 Event Id Known-Answer Vectors

The repository SHALL vendor NIP-01 event vectors with published event ids and signatures and SHALL assert that `computeEventId` reproduces each published id exactly.

#### Scenario: Published event id is reproduced

- **GIVEN** a vendored NIP-01 event with a published `id`, `pubkey`, `created_at`, `kind`, `tags`, and `content`
- **WHEN** `computeEventId` is called with those fields
- **THEN** the returned lowercase hex id equals the published `id`

#### Scenario: Published event signature verifies

- **GIVEN** a vendored NIP-01 event with a published `id`, `sig`, and `pubkey`
- **WHEN** the signature is verified through the project's verification function
- **THEN** verification succeeds

#### Scenario: Tampered event fails

- **GIVEN** a vendored NIP-01 event
- **WHEN** any serialized field is altered
- **THEN** the recomputed id differs from the published id
- **AND** the published signature no longer verifies against the recomputed id

### Requirement: NIP-01 Serialization Edge Cases Are Pinned

The repository SHALL include a test for each NIP-01 serialization edge case where `JSON.stringify` behavior is load-bearing, and SHALL record the observed behavior together with whether it matches the specification, common practice, or neither.

#### Scenario: Control characters are escaped as \u00XX

- **GIVEN** event content containing a control character in the range `U+0001` to `U+001F`
- **WHEN** the event is serialized for id computation
- **THEN** the character is emitted as a `\u00XX` escape
- **AND** the test records that this diverges from the letter of NIP-01 while matching common implementation practice

#### Scenario: Line and paragraph separators pass through raw

- **GIVEN** event content containing `U+2028` or `U+2029`
- **WHEN** the event is serialized for id computation
- **THEN** the characters are emitted raw and unescaped
- **AND** the test records this as correct

#### Scenario: Delete character passes through raw

- **GIVEN** event content containing `U+007F`
- **WHEN** the event is serialized for id computation
- **THEN** the character is emitted raw and unescaped
- **AND** the test records this as correct

#### Scenario: Lone surrogate is emitted as an escape

- **GIVEN** event content containing a lone surrogate such as `U+D800`
- **WHEN** the event is serialized for id computation
- **THEN** the character is emitted as `\ud800`
- **AND** the test records this as a genuine interoperability divergence
- **AND** the test asserts the observed behavior so a silent change is caught

### Requirement: Vector Provenance Is Recorded

Each vendored vector file SHALL record its upstream source, the retrieval date, and a content hash, and SHALL be stored as data rather than transcribed into test source.

#### Scenario: Vector file carries provenance

- **WHEN** a vendored vector file is added or updated
- **THEN** it is accompanied by its upstream URL, retrieval date, and a checksum of the retrieved content
- **AND** the loader reads the vectors from that data file rather than from hand-copied literals

#### Scenario: Vector drift is detectable

- **GIVEN** a vendored vector file
- **WHEN** its content changes
- **THEN** the recorded checksum no longer matches
- **AND** the mismatch is surfaced rather than silently accepted

### Requirement: Interop Vectors Gate Crypto Consolidation

The known-answer vector suite SHALL be green before any change that merges, replaces, or removes one of the duplicate crypto implementations, so that consolidation is proven behavior-preserving rather than assumed.

#### Scenario: Consolidation is blocked without vectors

- **GIVEN** the `consolidate-crypto-implementations` change is ready to implement
- **WHEN** the BIP-340 and NIP-01 known-answer suites are absent or failing
- **THEN** consolidation does not proceed

#### Scenario: Exactly one implementation per primitive stays vector-proven

- **GIVEN** `tests/security/crypto-single-implementation.test.ts` enforces that every cryptographic primitive has exactly one implementing module under `src/`
- **WHEN** the vector suite and the single-implementation test both run
- **THEN** the one retained path for each primitive is exercised against the known-answer vectors
- **AND** a second implementation introduced for any primitive is caught by the single-implementation test before it could silently diverge from the vectors

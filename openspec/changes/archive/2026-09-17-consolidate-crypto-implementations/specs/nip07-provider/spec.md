## MODIFIED Requirements

### Requirement: Event ID Computation

The extension SHALL compute event IDs per NIP-01 specification. The pre-image SHALL be produced by a single serialization implementation, and events whose `content` or `tags` contain an unpaired UTF-16 surrogate code unit SHALL be rejected at the validation boundary before any event ID is computed.

#### Scenario: Correct serialization
- **GIVEN** an unsigned event with kind, content, tags, and created_at
- **WHEN** computing the event ID
- **THEN** the extension SHALL serialize as JSON array: `[0, pubkey, created_at, kind, tags, content]`
- **AND** SHALL compute SHA-256 hash of the UTF-8 encoded JSON string
- **AND** SHALL return the hash as a 64-character lowercase hex string

#### Scenario: Deterministic output
- **GIVEN** the same event fields and pubkey
- **WHEN** computing the event ID multiple times
- **THEN** the result SHALL be identical each time

#### Scenario: Mandated escapes are applied
- **GIVEN** event content containing a line break, a double quote, a backslash, a carriage return, a tab, a backspace, or a form feed
- **WHEN** computing the event ID
- **THEN** the serialization SHALL escape each of those characters as NIP-01 requires
- **AND** the resulting event ID SHALL match the official NIP-01 vector for that content

#### Scenario: Characters NIP-01 does not escape pass through
- **GIVEN** event content containing `U+2028`, `U+2029` or `U+007F`
- **WHEN** computing the event ID
- **THEN** the serialization SHALL emit those characters unescaped
- **AND** the resulting event ID SHALL match the id computed by a conforming NIP-01 implementation

#### Scenario: Unpaired surrogates are rejected before signing
- **GIVEN** a `nostr.signEvent` request whose `content` or any `tags` entry contains an unpaired surrogate code unit such as `U+D800`
- **WHEN** the request reaches the event validation boundary
- **THEN** the extension SHALL reject the request with the `invalid_event` error code
- **AND** SHALL NOT compute an event ID for that request
- **AND** SHALL NOT open an approval prompt for that request

#### Scenario: Signed event carries the id that was computed
- **GIVEN** an event the user has approved for signing
- **WHEN** the extension signs it and returns the result
- **THEN** the returned `id` SHALL be the same id the extension hashed and signed
- **AND** the returned `content`, `tags`, `kind`, `created_at` and `pubkey` SHALL be the same values that were displayed in the approval prompt
- **AND** the returned `sig` SHALL verify against the returned `id` and `pubkey`

#### Scenario: One serialization implementation
- **GIVEN** the extension computes event IDs from more than one call site
- **WHEN** the pre-image is produced for any of them
- **THEN** every call site SHALL reach the same serialization implementation
- **AND** no second event ID computation SHALL exist in `src/`

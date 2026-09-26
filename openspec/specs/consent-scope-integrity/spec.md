# Consent Scope Integrity Specification

## Purpose

Ensure an origin never holds more signing authority than the user actually granted. Covers the scope of remembered decisions, trust-level allowlists, protected event kinds, rejection of non-integer kinds, migration of unearned trust levels, and the fail-closed policy evaluation order.
## Requirements
### Requirement: Remembered Decisions Never Widen Authority

The extension SHALL NOT grant an origin more authority than the decision the user actually made. When a per-kind `allow`, `ask`, or `deny` rule is persisted for an origin that has no stored policy record, the extension MUST NOT assign that record a trust level the user never chose.

#### Scenario: Deny and remember does not create silent auto-signing

- **GIVEN** no stored policy exists for `https://example.com`
- **AND** the vault is unlocked
- **WHEN** the user chooses deny and remember for a kind `1` request from `https://example.com`
- **THEN** a `deny` rule is stored for origin `https://example.com` and kind `1`
- **AND** the stored record SHALL NOT carry a trust level that auto-allows any other kind
- **AND** a later kind `7` request from `https://example.com` evaluates to `ask`
- **AND** a later kind `6` request from `https://example.com` evaluates to `ask`
- **AND** a later kind `10002` request from `https://example.com` evaluates to `ask`

#### Scenario: Allow and remember stays scoped to the approved kind

- **GIVEN** no stored policy exists for `https://example.com`
- **WHEN** the user chooses allow and remember for a kind `10002` request from `https://example.com`
- **THEN** an `allow` rule is stored for kind `10002` only
- **AND** a later kind `7` request from `https://example.com` evaluates to `ask`

#### Scenario: A user-chosen trust level is preserved

- **GIVEN** `https://example.com` has a stored policy with trust level `high`
- **WHEN** the user persists a `deny` rule for kind `5`
- **THEN** the stored trust level remains `high`
- **AND** only the kind `5` rule is added

### Requirement: New Origin Records Default To The Untrusted Level

The extension SHALL treat an origin record created as a side effect of a per-kind decision as untrusted for every event kind that has no explicit rule.

#### Scenario: Unruled kind on an implicitly created record asks

- **GIVEN** an origin record was created only to store a per-kind rule
- **WHEN** that origin requests a kind with no explicit rule
- **THEN** the extension requires approval

#### Scenario: Medium-trust default kinds are not auto-allowed on an implicitly created record

- **GIVEN** an origin record was created only to store a per-kind rule
- **AND** `mediumAllowKinds` contains kinds `6`, `16`, `7`, and `10002`
- **WHEN** that origin requests any of kinds `6`, `16`, `7`, or `10002`
- **THEN** each request requires approval
- **AND** no request is auto-signed from a trust default

### Requirement: Trust Levels Permit Only Allowlisted Kinds

The extension SHALL derive trust-level defaults from an explicit allowlist of permitted event kinds for each trust level. Any event kind absent from the allowlist for the origin's trust level SHALL evaluate to `ask`. A trust level MUST NOT be defined as "allow everything not explicitly named".

#### Scenario: High trust allows an allowlisted kind

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has trust level `high`
- **AND** kind `7` is in the high-trust allowlist
- **WHEN** `https://example.com` requests signing for kind `7`
- **THEN** the extension auto-signs without prompting
- **AND** the policy reason is `trust`

#### Scenario: High trust asks for a kind outside the allowlist

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has trust level `high`
- **AND** kind `30023` is not in the high-trust allowlist
- **WHEN** `https://example.com` requests signing for kind `30023`
- **THEN** the extension requires approval

#### Scenario: A newly registered kind is never silently signable

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has trust level `high`
- **AND** the extension has no allowlist entry for kind `31337`
- **WHEN** `https://example.com` requests signing for kind `31337`
- **THEN** the extension requires approval
- **AND** the request is not auto-signed

#### Scenario: Medium trust cannot exceed the high-trust allowlist

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has trust level `medium`
- **AND** stored `mediumAllowKinds` contains a kind that is not in the high-trust allowlist
- **WHEN** `https://example.com` requests signing for that kind
- **THEN** the extension requires approval

#### Scenario: Low trust asks for every kind

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has trust level `low`
- **WHEN** `https://example.com` requests signing for any event kind
- **THEN** the extension requires approval

#### Scenario: An explicit user allow rule still applies to a non-allowlisted kind

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has an explicit `allow` rule for kind `30023`
- **AND** kind `30023` is not protected
- **WHEN** `https://example.com` requests signing for kind `30023`
- **THEN** the extension auto-signs without prompting
- **AND** the policy reason is `rule`

### Requirement: Protected Kinds Cover Irreversible And Credential-Equivalent Events

The extension SHALL treat kinds `1`, `5`, `9734`, `22242`, and `27235` as protected. A protected kind MUST always require approval unless it is explicitly denied, and MUST NOT be auto-signed by any trust level, allowlist entry, explicit `allow` rule, session grant, or remembered approval.

#### Scenario: Deletion requests always require approval

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has trust level `high`
- **WHEN** `https://example.com` requests signing for kind `5`
- **THEN** the extension requires approval
- **AND** the policy reason is `protected`

#### Scenario: Relay authentication always requires approval

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has an active session grant
- **WHEN** `https://example.com` requests signing for kind `22242`
- **THEN** the extension requires approval
- **AND** the policy reason is `protected`

#### Scenario: HTTP auth credentials always require approval

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has an explicit `allow` rule for kind `27235`
- **WHEN** `https://example.com` requests signing for kind `27235`
- **THEN** the extension requires approval
- **AND** the policy reason is `protected`

#### Scenario: Previously protected kinds remain protected

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has trust level `high`
- **WHEN** `https://example.com` requests signing for kind `1`
- **THEN** the extension requires approval
- **AND** the policy reason is `protected`
- **AND** the same outcome applies to kind `9734`

#### Scenario: Explicit deny still wins over protected-kind approval

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has an explicit `deny` rule for kind `5`
- **WHEN** `https://example.com` requests signing for kind `5`
- **THEN** the extension denies the request without prompting
- **AND** the policy reason is `rule`

#### Scenario: Sensitive but reversible kinds are ask-by-default rather than protected

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has trust level `high`
- **WHEN** `https://example.com` requests signing for kind `0`, kind `3`, or kind `4`
- **THEN** each request requires approval because the kind is outside the high-trust allowlist
- **AND** the user MAY still create an explicit per-kind `allow` rule for those kinds

### Requirement: Non-Integer Event Kinds Cannot Bypass Kind Policy

The extension SHALL reject non-integer event kinds at the RPC boundary, and any non-integer kind that reaches policy evaluation SHALL be treated as not allowlisted and not eligible for auto-signing.

#### Scenario: Fractional kind is rejected before policy evaluation

- **GIVEN** the vault is unlocked
- **WHEN** a page calls `signEvent` with kind `1.0000001`
- **THEN** the request is rejected with error code `invalid_event`
- **AND** the request is not signed
- **AND** the protected-kind gate for kind `1` is not bypassed

#### Scenario: Non-finite kind is rejected

- **WHEN** a page calls `signEvent` with a kind of `NaN` or `Infinity`
- **THEN** the request is rejected with error code `invalid_event`

#### Scenario: Policy helpers refuse non-integer kinds

- **GIVEN** a non-integer kind value reaches the trust-default helper
- **WHEN** the helper resolves a default for any trust level
- **THEN** the result is `ask`
- **AND** the value is never treated as an allowlisted kind

### Requirement: Unearned Trust Levels Are Migrated

The extension SHALL downgrade stored origin records whose `medium` trust level was assigned by the extension rather than chosen by the user, while preserving their explicit per-kind rules.

#### Scenario: Legacy record written by the remembered-decision path is downgraded

- **GIVEN** stored settings contain an origin record with trust level `medium` and a single `deny` rule for kind `1`
- **WHEN** the migration runs
- **THEN** the record's trust level becomes the untrusted default
- **AND** the `deny` rule for kind `1` is preserved
- **AND** a later kind `7` request from that origin evaluates to `ask`

#### Scenario: Migration is idempotent

- **GIVEN** the migration has already run
- **WHEN** the migration runs again
- **THEN** stored origin records are unchanged

### Requirement: Hardened Policy Guarantees Are Preserved

The extension SHALL preserve the existing fail-closed evaluation order: locked check, explicit deny, protected kind, session grant, explicit allow or ask, trust default, fallback ask.

#### Scenario: Locked vault denies before any rule is consulted

- **GIVEN** the vault is locked
- **AND** `https://example.com` has trust level `high`
- **WHEN** `https://example.com` requests signing for kind `7`
- **THEN** the extension denies the request
- **AND** the policy reason is `locked`

#### Scenario: Unknown origin falls back to approval

- **GIVEN** the vault is unlocked
- **AND** no policy record exists for `https://example.com`
- **WHEN** `https://example.com` requests signing for kind `7`
- **THEN** the extension requires approval
- **AND** the policy reason is `fallback`

#### Scenario: Protected-kind enforcement still precedes session grants

- **GIVEN** the vault is unlocked
- **AND** `https://example.com` has an active session grant
- **WHEN** `https://example.com` requests signing for kind `1`
- **THEN** the extension requires approval
- **AND** the policy reason is `protected`

### Requirement: The Origin Policy Patch Has One Path Per Authority

`policy.setOrigin` SHALL accept only the `name`, `trustLevel` and `identityDisclosure` fields, SHALL refuse any other field with the `invalid_params` error code without storing anything, and SHALL require password re-authentication before storing a patch that sets `trustLevel` to `high` or `identityDisclosure` to `allow`. Per-kind rules SHALL be written only through `policy.setKindRule`, and session grants only through `policy.setSession`. The set of patch fields that require re-authentication SHALL be defined in one place that tests can enumerate against the patch schema.

#### Scenario: Per-kind rules cannot be written through the origin patch

- **GIVEN** the vault is unlocked
- **WHEN** `policy.setOrigin` is sent with a patch of `{ rules: { "0": "allow" } }`
- **THEN** the response carries the `invalid_params` error code
- **AND** the stored policy for that origin is unchanged

#### Scenario: The session display flag cannot be written through the origin patch

- **WHEN** `policy.setOrigin` is sent with a patch of `{ sessionGrantAll: true }`
- **THEN** the response carries the `invalid_params` error code
- **AND** no session grant exists for that origin

#### Scenario: Granting disclosure consent requires the password

- **GIVEN** the vault is unlocked
- **WHEN** `policy.setOrigin` is sent with `{ identityDisclosure: "allow" }` and no password
- **THEN** the response carries the `invalid_password` error code
- **AND** the stored disclosure decision for that origin is unchanged

#### Scenario: Granting disclosure consent under the password succeeds

- **GIVEN** the vault is unlocked
- **WHEN** `policy.setOrigin` is sent with `{ identityDisclosure: "allow" }` and the correct password
- **THEN** the stored disclosure decision for that origin is `allow`

#### Scenario: Tightening disclosure consent does not require the password

- **GIVEN** an origin whose disclosure decision is `allow`
- **WHEN** `policy.setOrigin` is sent with `{ identityDisclosure: "ask" }` and no password
- **THEN** the stored disclosure decision for that origin is `ask`

#### Scenario: Every authority-granting field is accounted for

- **WHEN** the security suite enumerates the fields of the origin policy patch schema
- **THEN** each field is either listed as requiring re-authentication for an authority-granting value or listed as never granting authority
- **AND** a field that appears in neither list fails the suite


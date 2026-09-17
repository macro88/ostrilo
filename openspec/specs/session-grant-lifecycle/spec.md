# session-grant-lifecycle Specification

## Purpose
Defines the lifetime of session grants that let a site sign without a per-request prompt: grants are always time-bounded, stop auto-signing once expired, and remain visible and revocable to the user.

## Requirements

### Requirement: Session Grants Always Have A Bounded Lifetime

The extension SHALL give every grant-everything session an absolute expiry timestamp. A stored `sessionTTLMinutes` value of `0` MUST NOT produce an unbounded grant, and the shipped default `sessionTTLMinutes` SHALL be a non-zero number of minutes.

#### Scenario: Default TTL is non-zero

- **WHEN** default settings are created
- **THEN** `sessionTTLMinutes` is greater than `0`

#### Scenario: Legacy zero TTL does not create an unbounded grant

- **GIVEN** stored settings contain `sessionTTLMinutes` of `0`
- **WHEN** the user enables a session grant for `https://example.com`
- **THEN** the stored grant carries a future expiry timestamp
- **AND** the grant is not stored as never-expiring

#### Scenario: Settings validation rejects a zero TTL

- **WHEN** a settings update sets `sessionTTLMinutes` to `0`
- **THEN** the update is rejected with error code `invalid_params`

### Requirement: Expired Session Grants Do Not Auto-Sign

The extension SHALL ignore a session grant once its expiry has passed, and SHALL fall back to the origin's normal policy evaluation.

#### Scenario: Expired grant no longer allows

- **GIVEN** a session grant for `https://example.com` expired one minute ago
- **AND** the vault is unlocked
- **WHEN** `https://example.com` requests signing for kind `7`
- **THEN** the request is not allowed with reason `session`
- **AND** the request follows normal policy evaluation

#### Scenario: Active grant still allows an unprotected kind

- **GIVEN** an unexpired session grant exists for `https://example.com`
- **AND** the vault is unlocked
- **WHEN** `https://example.com` requests signing for kind `7`
- **THEN** the extension auto-signs without prompting
- **AND** the policy reason is `session`

#### Scenario: Lock clears session grants

- **GIVEN** an unexpired session grant exists for `https://example.com`
- **WHEN** the vault locks
- **THEN** the grant is cleared
- **AND** a later request from `https://example.com` is not allowed with reason `session`

### Requirement: Active Session Grants Are Visible In Settings

The Settings permissions surface SHALL show whether a grant-everything session is currently active for an origin, based on live grant state rather than the persisted `sessionGrantAll` field on the origin record.

#### Scenario: Active grant is shown as on

- **GIVEN** an unexpired session grant exists for `https://example.com`
- **WHEN** the user opens Settings permissions
- **THEN** the session-grant control for `https://example.com` is shown as active
- **AND** the remaining time of the grant is shown

#### Scenario: No grant is shown as off

- **GIVEN** no session grant exists for `https://example.com`
- **WHEN** the user opens Settings permissions
- **THEN** the session-grant control for `https://example.com` is shown as inactive

#### Scenario: Grant state survives reopening the surface

- **GIVEN** the user enables a session grant for `https://example.com`
- **WHEN** the user closes and reopens Settings permissions
- **THEN** the session-grant control is still shown as active

#### Scenario: Expired grant is shown as off

- **GIVEN** a session grant for `https://example.com` has expired
- **WHEN** the user opens Settings permissions
- **THEN** the session-grant control for `https://example.com` is shown as inactive

### Requirement: Users Can Revoke An Active Session Grant

The extension SHALL let the user revoke an active session grant, and revocation SHALL take effect on the next request.

#### Scenario: Revoked grant stops auto-signing

- **GIVEN** an unexpired session grant exists for `https://example.com`
- **WHEN** the user turns the session-grant control off
- **THEN** the grant is removed
- **AND** the next kind `7` request from `https://example.com` follows normal policy evaluation

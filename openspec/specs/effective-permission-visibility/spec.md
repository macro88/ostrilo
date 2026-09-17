# effective-permission-visibility Specification

## Purpose

Defines what the Settings permissions surface must show: the decision policy evaluation will actually apply for each origin and event kind, the source of that decision, and controls to review or lower an origin's trust level and revoke identity-disclosure consent.

## Requirements

### Requirement: Permissions Table Shows The Effective Decision

The Settings permissions surface SHALL show, for each listed origin and event kind, the decision that will actually be applied, including trust-level allowlist defaults, protected-kind forcing, and active session grants. It MUST NOT present a kind as `Ask` when policy evaluation would allow it.

#### Scenario: Trust-allowed kind is not displayed as Ask

- **GIVEN** `https://example.com` has trust level `medium`
- **AND** kind `7` is auto-allowed by that trust level
- **AND** no explicit rule exists for kind `7`
- **WHEN** the user views the permissions surface
- **THEN** kind `7` for `https://example.com` is shown as allowed

#### Scenario: Kind outside the allowlist is displayed as Ask

- **GIVEN** `https://example.com` has trust level `high`
- **AND** kind `30023` is outside the high-trust allowlist
- **WHEN** the user views the permissions surface
- **THEN** kind `30023` for `https://example.com` is shown as requiring approval

#### Scenario: Protected kind is displayed as always requiring approval

- **GIVEN** `https://example.com` has an explicit `allow` rule for protected kind `27235`
- **WHEN** the user views the permissions surface
- **THEN** kind `27235` is shown as always requiring approval
- **AND** the stored `allow` rule is not presented as active auto-allow

#### Scenario: Explicit deny is displayed as denied

- **GIVEN** `https://example.com` has an explicit `deny` rule for kind `7`
- **WHEN** the user views the permissions surface
- **THEN** kind `7` is shown as denied

#### Scenario: Active session grant is reflected in the effective decision

- **GIVEN** an unexpired session grant exists for `https://example.com`
- **WHEN** the user views the permissions surface
- **THEN** unprotected kinds for `https://example.com` are shown as currently allowed by the session grant

### Requirement: Effective Decision Identifies Its Source

The permissions surface SHALL identify why each effective decision applies, distinguishing an explicit rule, a trust-level default, protected-kind enforcement, an active session grant, and the untrusted fallback.

#### Scenario: Rule-sourced decision is labelled

- **GIVEN** `https://example.com` has an explicit `allow` rule for kind `10002`
- **WHEN** the user views the permissions surface
- **THEN** the kind `10002` decision is labelled as coming from an explicit rule

#### Scenario: Trust-sourced decision is labelled

- **GIVEN** `https://example.com` has trust level `medium`
- **AND** kind `7` is auto-allowed by that trust level with no explicit rule
- **WHEN** the user views the permissions surface
- **THEN** the kind `7` decision is labelled as coming from the trust level

#### Scenario: Protected decision is labelled

- **WHEN** the user views a protected kind on the permissions surface
- **THEN** the decision is labelled as protected

### Requirement: Trust Level Is Reviewable And Downgradable

The permissions surface SHALL show each origin's trust level and SHALL let the user change it, including lowering it to the untrusted level.

#### Scenario: Trust level control is available for every origin

- **GIVEN** at least one origin policy exists
- **WHEN** the user views the permissions surface
- **THEN** each origin shows its current trust level
- **AND** each origin exposes a control to change that trust level

#### Scenario: Downgrading trust removes auto-signing

- **GIVEN** `https://example.com` has trust level `high`
- **AND** kind `7` is auto-allowed by that trust level
- **WHEN** the user lowers the trust level to `low`
- **THEN** the stored trust level becomes `low`
- **AND** the next kind `7` request from `https://example.com` requires approval

#### Scenario: Downgrade preserves explicit rules

- **GIVEN** `https://example.com` has trust level `high` and an explicit `deny` rule for kind `5`
- **WHEN** the user lowers the trust level to `low`
- **THEN** the `deny` rule for kind `5` is preserved

### Requirement: Identity Disclosure Consent Is Manageable

The permissions surface SHALL show each origin's identity-disclosure consent state and SHALL let the user revoke it.

#### Scenario: Granted identity consent is visible

- **GIVEN** the user granted identity disclosure to `https://example.com`
- **WHEN** the user views the permissions surface
- **THEN** `https://example.com` is shown as allowed to read the public key

#### Scenario: Identity consent can be revoked

- **GIVEN** `https://example.com` is shown as allowed to read the public key
- **WHEN** the user revokes that consent
- **THEN** the surface shows `https://example.com` as no longer allowed to read the public key

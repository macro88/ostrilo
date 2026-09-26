## ADDED Requirements

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

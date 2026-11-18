## MODIFIED Requirements

### Requirement: Settings Are Stored Device-Locally

The extension SHALL persist the `appSettings` item in extension local storage and SHALL NOT write it to browser-synced storage. This covers origin policies, trust levels, per-kind rules, disclosure consent, security timeouts, medium-trust kinds, relays, the chosen image host, activity retention, the selected key, onboarding state and theme. After migration, a value placed in the synced `appSettings` item SHALL have no effect on policy evaluation, signing, identity disclosure, timeouts, relay connections or uploads.

#### Scenario: A grant is written to local storage only

- **GIVEN** the vault is unlocked
- **WHEN** the user raises an origin to `high` trust under their password
- **THEN** the updated origin record is present in local storage
- **AND** no write to synced storage occurs

#### Scenario: A synced grant has no effect

- **GIVEN** a migrated install
- **AND** the synced `appSettings` item is set to a copy that grants `https://evil.example` `high` trust and disclosure `allow`
- **WHEN** `https://evil.example` requests `getPublicKey` and then a kind 7 signature
- **THEN** the disclosure prompt is shown
- **AND** no signature is produced without approval

#### Scenario: A synced image host has no effect

- **GIVEN** the synced `appSettings` item names an image host
- **WHEN** the user opens the upload dialog
- **THEN** that host MUST NOT be preselected
- **AND** no request MUST be made to it

#### Scenario: Locking writes no synced state

- **WHEN** the vault locks
- **THEN** no write to synced storage occurs

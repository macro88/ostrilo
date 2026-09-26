# settings-storage-locality Specification

## Purpose

Keeps every setting that grants authority on the device where it was granted. Browser sync copies synced storage to every profile on the account, so a grant made under one browser's password must not live there. Covers where the `appSettings` item is stored, the single store that owns it, the static fence on synced storage, the one-time migration off sync (which deletes the synced copy), and which storage events background consumers act on.

## Requirements
### Requirement: Settings Are Stored Device-Locally

The extension SHALL persist the `appSettings` item in extension local storage and SHALL NOT write it to browser-synced storage. This covers origin policies, trust levels, per-kind rules, disclosure consent, security timeouts, medium-trust kinds, relays, the upload endpoint, activity retention, the selected key, onboarding state and theme. After migration, a value placed in the synced `appSettings` item SHALL have no effect on policy evaluation, signing, identity disclosure, timeouts, relay connections or uploads.

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

#### Scenario: Locking writes no synced state

- **WHEN** the vault locks
- **THEN** no write to synced storage occurs

### Requirement: Only The Docked-Panel Flag Uses Synced Storage

Source code under `src/` SHALL reference browser-synced storage only through the accessors of the docked-panel flag, and SHALL name the `appSettings` storage key only inside the single settings store. The security suite SHALL enforce both by static scan.

#### Scenario: A new synced-storage call fails the suite

- **GIVEN** a source file outside the allowlist that calls `storage.sync`
- **WHEN** the security suite runs
- **THEN** the settings-locality test fails and names the file

#### Scenario: A second owner of the settings key fails the suite

- **GIVEN** a source file other than the settings store that contains the `appSettings` key string
- **WHEN** the security suite runs
- **THEN** the settings-locality test fails and names the file

### Requirement: Existing Settings Migrate Once Without Loss

On the first settings read after upgrade, and eagerly when the background starts and at extension install or update, the extension SHALL copy an existing synced `appSettings` item into local storage when local storage holds none, preserving every field including trust levels, rules and disclosure decisions. When local storage already holds settings, the synced item SHALL be ignored. The migration SHALL be idempotent under concurrent reads. Once local storage has been read back holding settings, the eager migration SHALL remove the synced `appSettings` item. A settings read SHALL never remove it, so a synced-storage failure cannot prevent settings from loading.

#### Scenario: Upgrade carries every grant

- **GIVEN** synced storage holds settings with three origin records at `low`, `medium` and `high` trust, a per-kind rule, and a disclosure `allow`
- **AND** local storage holds no settings
- **WHEN** the extension starts after upgrade
- **THEN** local storage holds settings with the same three records, rule and disclosure decision
- **AND** a request from the `high` origin for an allowlisted kind signs without a prompt, as before the upgrade

#### Scenario: Local settings take precedence

- **GIVEN** local storage already holds settings
- **AND** synced storage holds a different settings item
- **WHEN** settings are read
- **THEN** the local settings are returned
- **AND** local storage is not overwritten

#### Scenario: Concurrent first reads

- **GIVEN** a synced settings item and no local settings
- **WHEN** two settings reads run concurrently
- **THEN** local storage ends with the synced item's content
- **AND** both reads return equivalent settings

#### Scenario: Fresh install

- **GIVEN** neither storage area holds settings
- **WHEN** settings are first read
- **THEN** default settings are written to local storage
- **AND** nothing is written to synced storage

#### Scenario: The synced copy is removed after migration

- **GIVEN** a synced settings item and no local settings
- **WHEN** the eager migration runs
- **THEN** local storage holds the synced item's content
- **AND** the synced `appSettings` item no longer exists

#### Scenario: A settings read never removes the synced copy

- **GIVEN** a synced settings item and no local settings
- **WHEN** settings are read, without the eager migration
- **THEN** local storage holds the synced item's content
- **AND** the synced `appSettings` item is still present

#### Scenario: A copy written later by an older install is swept

- **GIVEN** local storage holds settings
- **AND** synced storage holds an `appSettings` item written by an older version on another device
- **WHEN** the eager migration runs
- **THEN** the synced `appSettings` item no longer exists
- **AND** local storage is unchanged

### Requirement: Local Settings Changes Still Reach Background Consumers

A change to the local `appSettings` item SHALL re-arm the auto-lock alarm against the new deadline and SHALL rebuild the relay manager from the new relay list, as a synced change did before. A change to a synced `appSettings` item SHALL do neither.

#### Scenario: Auto-lock timeout change re-arms the alarm

- **GIVEN** the vault is unlocked
- **WHEN** `autoLockMinutes` is changed in local settings
- **THEN** the auto-lock alarm is re-armed for the new deadline

#### Scenario: Relay list change rebuilds the relay manager

- **WHEN** the relay list is changed in local settings
- **THEN** the relay manager is rebuilt with the new relays

#### Scenario: A synced settings change reaches no consumer

- **WHEN** another device writes an `appSettings` item with a different relay list to synced storage
- **THEN** the relay manager is not rebuilt
- **AND** the auto-lock alarm is not re-armed


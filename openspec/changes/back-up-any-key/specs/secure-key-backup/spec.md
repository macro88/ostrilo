## ADDED Requirements

### Requirement: Any Key Can Be Backed Up From Settings

Settings SHALL offer a Back up action for every key in the vault. It SHALL require the master password, SHALL reveal the key only through the password-verified reveal, and SHALL produce the same encrypted backup file, sealed under a passphrase the user supplies, that onboarding produces, so that the file restores through the onboarding import. The flow SHALL NOT display the key, SHALL NOT copy it to the clipboard, and SHALL NOT place it in a URL, in component state, or in a log.

#### Scenario: Every key offers Back up

- **GIVEN** the vault holds several keys
- **WHEN** the user opens Keys & Identities
- **THEN** each key SHALL offer a Back up action

#### Scenario: Back up needs the master password

- **WHEN** the user chooses Back up for a key
- **THEN** the extension SHALL ask for the master password before revealing anything
- **AND** an incorrect password SHALL reveal nothing and SHALL be counted by the unlock throttle

#### Scenario: A Settings backup restores through the onboarding import

- **GIVEN** the user backed up a key added in Settings
- **WHEN** the file is imported in a fresh profile with its passphrase
- **THEN** the restored key SHALL have the same public key as the key that was backed up

#### Scenario: The key is not shown

- **WHEN** the Settings backup flow is open
- **THEN** no control SHALL display, copy, or offer a QR code for the private key
- **AND** the file SHALL contain neither the nsec nor the hex key as readable text

#### Scenario: The revealed key is cleared on every exit

- **GIVEN** the Settings backup flow holds a revealed key
- **WHEN** the dialog closes, the backup is recorded, the vault locks, or the page unmounts
- **THEN** the flow SHALL drop its reference to the revealed key
- **AND** the key SHALL require another password-verified reveal to be used again

#### Scenario: An unreadable key cannot be backed up

- **GIVEN** a key whose stored record could not be read
- **WHEN** the keys list is shown
- **THEN** its Back up action SHALL be disabled
- **AND** SHALL state that the record could not be read

### Requirement: A Settings Backup Counts Only When The Saved File Is Verified

A key SHALL be recorded as backed up from Settings only after the saved file is selected again, decrypts under its passphrase, and holds the key that was revealed. The re-entry check offered in onboarding SHALL NOT be offered, because the flow never shows the key. A backup that is cancelled, abandoned, or interrupted SHALL record nothing.

#### Scenario: Saving the file is not yet a backup

- **GIVEN** the user saved the encrypted file
- **WHEN** the file has not been verified
- **THEN** the key SHALL NOT be recorded as backed up

#### Scenario: The file route is the only proof offered

- **WHEN** the verification step of a Settings backup is shown
- **THEN** it SHALL ask for the saved file and its passphrase
- **AND** SHALL NOT offer to re-enter characters of the nsec

#### Scenario: A file that holds a different key does not verify

- **GIVEN** the user selects a valid backup of another key
- **WHEN** the file is checked
- **THEN** verification SHALL fail
- **AND** the key SHALL NOT be recorded as backed up

#### Scenario: A wrong passphrase does not verify

- **WHEN** the file is checked with a wrong passphrase
- **THEN** verification SHALL fail with the generic decryption-failure message
- **AND** the key SHALL NOT be recorded as backed up

#### Scenario: Locking mid-backup stops the flow

- **GIVEN** a Settings backup is open
- **WHEN** the vault locks, or the background answers that it is locked
- **THEN** the flow SHALL stop and SHALL say that nothing was recorded as backed up
- **AND** the revealed key SHALL be dropped
- **AND** the key SHALL NOT be recorded as backed up

#### Scenario: A status that cannot be recorded is not reported as recorded

- **GIVEN** the file verified
- **WHEN** the status cannot be written
- **THEN** the dialog SHALL NOT report the key as backed up

### Requirement: Backup Status Is Tracked Per Key Outside The Vault

The extension SHALL keep, for each key, a backup status of `pending` or `verified` with the time it was set, in a non-secret `storage.local` record separate from the vault envelope and the key records. A key with no record SHALL be treated as unknown, which is neither `pending` nor `verified`. The record SHALL hold key identifiers, states and times only.

#### Scenario: A generated key starts pending

- **WHEN** the vault generates a key, whether from onboarding or from Settings
- **THEN** that key SHALL be recorded as `pending`
- **AND** the key SHALL NOT be stored if its status cannot be recorded

#### Scenario: An imported key has no status

- **WHEN** a key is imported
- **THEN** no status SHALL be recorded for it
- **AND** it SHALL be treated as unknown

#### Scenario: A key from before status tracking is unknown

- **GIVEN** a key that existed before backup status was tracked
- **THEN** it SHALL have no record
- **AND** no marker or banner SHALL be shown for it
- **AND** its Back up action SHALL be available

#### Scenario: Onboarding marks the key verified only after verification

- **GIVEN** the user created a key in onboarding
- **WHEN** the backup verification has not passed
- **THEN** the key SHALL remain `pending`
- **WHEN** the verification passes
- **THEN** the key SHALL be recorded as `verified`

#### Scenario: A verified Settings backup marks the key verified

- **WHEN** a Settings backup passes file verification
- **THEN** the key SHALL be recorded as `verified` with the current time

#### Scenario: Deleting a key removes its status

- **WHEN** a key is deleted
- **THEN** its status record SHALL be removed

#### Scenario: A malformed record reads as unknown

- **GIVEN** the stored record, or one entry of it, is malformed
- **THEN** the affected keys SHALL read as unknown
- **AND** no error SHALL reach the user

### Requirement: Backup Status Writes Are Narrow And UI-Only

The `backup` RPC namespace SHALL be reachable only from the extension's own pages, SHALL be refused while the vault is locked, and SHALL offer one write, `backup.markVerified`. It SHALL validate the key identifier and SHALL refuse a key the vault does not hold. No request SHALL set a key `pending` or clear a record; those happen only inside the vault when it creates or deletes a key.

#### Scenario: A web page cannot reach the status

- **WHEN** a web page sends a `backup.*` request
- **THEN** it SHALL be refused as an unknown namespace

#### Scenario: A locked vault refuses the status

- **GIVEN** the vault is locked
- **WHEN** `backup.list` or `backup.markVerified` is sent
- **THEN** the response SHALL carry the `locked` error code

#### Scenario: An invalid key identifier is refused

- **WHEN** `backup.markVerified` is sent with a value that is not a key identifier
- **THEN** the response SHALL carry the `invalid_params` error code
- **AND** nothing SHALL be stored

#### Scenario: An unknown key is refused

- **WHEN** `backup.markVerified` is sent for a key the vault does not hold
- **THEN** the response SHALL carry the `key_not_found` error code
- **AND** nothing SHALL be stored

### Requirement: Keys Without A Backup Are Marked

The keys list SHALL mark each key whose backup status is `pending` with a "No backup" marker. It SHALL NOT mark a `verified` key or an unknown key.

#### Scenario: A pending key is marked

- **GIVEN** a key whose status is `pending`
- **WHEN** the keys list is shown
- **THEN** that key SHALL carry a "No backup" marker

#### Scenario: Verified and unknown keys are not marked

- **GIVEN** a key whose status is `verified`, and a key with no record
- **WHEN** the keys list is shown
- **THEN** neither SHALL carry a "No backup" marker

#### Scenario: Verifying clears the marker

- **GIVEN** a `pending` key
- **WHEN** its Settings backup is verified
- **THEN** the marker SHALL be gone without reloading the page

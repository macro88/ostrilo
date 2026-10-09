## MODIFIED Requirements

### Requirement: Backup Is Verified Before The Flow Can Complete

The full create-key flow (Create New Key) SHALL require positive evidence that the user recorded the key before it allows completion, and SHALL NOT accept an unverified acknowledgement checkbox as that evidence. This requirement does not apply to Quick Start, which creates a key without a backup step and records the key as having no backup until one is verified.

#### Scenario: Verification is required to finish

- **GIVEN** the user is in the full create-key flow and has revealed the private key
- **WHEN** the user has not yet passed the backup verification step
- **THEN** the finish action SHALL remain disabled

#### Scenario: Correct re-entry passes verification

- **GIVEN** the backup verification step asks the user to re-enter a checkable portion of the nsec
- **WHEN** the user enters the correct value
- **THEN** verification SHALL pass
- **AND** the finish action SHALL become available

#### Scenario: Incorrect re-entry blocks completion

- **GIVEN** the backup verification step is shown
- **WHEN** the user enters an incorrect value
- **THEN** verification SHALL fail
- **AND** the UI SHALL let the user reveal the key again and retry
- **AND** the finish action SHALL remain disabled

#### Scenario: Encrypted backup file round-trip passes verification

- **GIVEN** the user saved an encrypted backup file during this flow
- **WHEN** the user re-selects that file and supplies the backup passphrase
- **THEN** the extension SHALL confirm the file decrypts to the key that was just created
- **AND** verification SHALL pass
- **AND** the decrypted material SHALL be discarded without being displayed

#### Scenario: Verification input is not retained

- **WHEN** backup verification passes or the user leaves the step
- **THEN** the extension SHALL clear the verification input value from component state

#### Scenario: Quick Start is not held to verification

- **WHEN** the user takes Quick Start
- **THEN** the flow SHALL complete without a backup step, a revealed key, a download or a quiz

### Requirement: Key Loss Consequences Are Stated Plainly

The full create-key flow SHALL tell the user, before completion, that a forgotten master password with no backup makes the identity permanently unrecoverable, and that no party can restore it. Quick Start SHALL instead give the recoverability notice defined by its own requirement before it continues.

#### Scenario: Backup step states irrecoverability

- **WHEN** the create-key backup step is rendered
- **THEN** the UI SHALL state that the private key cannot be recovered if both the password and the backup are lost
- **AND** SHALL state that no recovery service, support channel, or reset exists

#### Scenario: Encrypted export states passphrase dependence

- **WHEN** the encrypted backup export flow is shown
- **THEN** the UI SHALL state that losing the backup passphrase makes the exported file unusable

## ADDED Requirements

### Requirement: Quick Start Creates A Key Without A Backup

The welcome screen SHALL offer a Quick start choice beside Create New Key and Import Existing Key, only when no vault exists. Quick Start SHALL ask for a master password and its confirmation under the existing password policy, SHALL generate exactly one key through the vault's existing generate path, SHALL show the recoverability notice, and SHALL then continue to Home. It SHALL NOT reveal, display, copy or download the key, SHALL NOT ask the user to prove a backup, and SHALL NOT record the key as verified. The key SHALL be `pending`.

#### Scenario: Quick start is offered beside the other choices

- **GIVEN** no vault exists
- **WHEN** the welcome screen is shown
- **THEN** Quick start SHALL be offered beside Create New Key and Import Existing Key

#### Scenario: An existing vault is never offered Quick start

- **GIVEN** the vault holds a key
- **THEN** the welcome screen SHALL NOT be shown
- **AND** nothing SHALL create a key or replace the vault through Quick Start

#### Scenario: A password is all it asks for

- **WHEN** the user takes Quick start
- **THEN** the flow SHALL explain, in one short paragraph, that it creates a new identity on this browser
- **AND** SHALL ask for a master password and confirmation that satisfy the existing password policy
- **AND** a mismatched or rejected password SHALL create no key

#### Scenario: One key, then the recoverability notice

- **WHEN** a valid password is submitted
- **THEN** exactly one key SHALL be generated and the vault unlocked
- **AND** the flow SHALL state: "This creates a new identity on this browser. You can back it up later. If you lose access to this browser before making a backup, you may lose access to this identity."
- **AND** the flow SHALL then continue to Home with that key selected
- **AND** SHALL NOT claim that any server can recover the identity

#### Scenario: No secret is shown

- **WHEN** Quick start runs to completion
- **THEN** no private key SHALL be displayed, copied, downloaded or revealed
- **AND** the master password SHALL NOT remain in component state once the key exists

#### Scenario: The key starts with no backup

- **WHEN** Quick start completes
- **THEN** the key's backup status SHALL be `pending`
- **AND** Quick start SHALL NOT record it as `verified`

#### Scenario: Repeated submission makes one key

- **WHEN** the user presses Create repeatedly, or retries after a reply was lost, or a second surface submits
- **THEN** only one key SHALL be generated
- **AND** a retry SHALL find the key already in the vault and unlock it rather than generate another

#### Scenario: Closing the popup keeps a saved key

- **GIVEN** the key was saved
- **WHEN** the popup closes before the notice is dismissed
- **THEN** the next open SHALL find one usable key, not a partly made vault
- **AND** the key SHALL survive reopening, a manual lock and an auto-lock

#### Scenario: The identity is the same after a backup restores it

- **GIVEN** the user backed up a Quick start key from Settings
- **WHEN** the file is imported in a fresh profile
- **THEN** the restored key SHALL have the same public key

### Requirement: Home Reminds A Key Without A Backup

Home SHALL show a quiet banner, "This key has no backup", for the selected key whose backup status is `pending`, with an action that opens Settings on that key's backup. The banner SHALL NOT be shown for a `verified` key or an unknown one. Dismissing it SHALL hide it for the current browser session only and for that key alone. It SHALL return in a new browser session until the key is backed up, and SHALL go as soon as a backup is verified.

#### Scenario: A pending key shows the banner

- **GIVEN** the selected key's status is `pending`
- **WHEN** Home is shown
- **THEN** the banner "This key has no backup" SHALL be shown with an action to back it up

#### Scenario: Verified and unknown keys are not nagged

- **GIVEN** the selected key's status is `verified`, or it has no record
- **WHEN** Home is shown
- **THEN** no banner SHALL be shown

#### Scenario: The action opens that key's backup

- **WHEN** the user chooses the banner's action
- **THEN** Settings SHALL open on Keys & Identities and start the password-gated backup of the selected key
- **AND** the request SHALL be dropped from the address once acted on, so reloading does not start it again

#### Scenario: Dismissal lasts for the browser session

- **WHEN** the user dismisses the banner
- **THEN** it SHALL stay hidden for that key until the browser session ends
- **AND** it SHALL NOT be hidden for another key
- **AND** it SHALL NOT mark the key as backed up
- **AND** it SHALL return in a new browser session while the key is `pending`

#### Scenario: Verification removes the banner

- **GIVEN** the banner is shown
- **WHEN** a backup of that key is verified, from any surface
- **THEN** the banner SHALL disappear without a reload

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

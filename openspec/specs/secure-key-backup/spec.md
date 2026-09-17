# secure-key-backup Specification

## Purpose

Define how a private key is revealed, backed up, verified, and cleared, so the user can record a recoverable backup without the extension ever writing plaintext key material to disk or leaving it resident in the UI.

## Requirements

### Requirement: No Plaintext Private Key Export

The extension MUST NOT write unencrypted private key material to the filesystem. No onboarding, settings, or key-management surface SHALL offer a download, save, or share action that produces a file containing an nsec or a raw hex private key in the clear.

#### Scenario: Backup export produces an encrypted file only

- **GIVEN** the user has revealed a newly generated private key on the backup step
- **WHEN** the user chooses to save a backup file
- **THEN** the extension SHALL produce a file whose private key material is encrypted
- **AND** the file SHALL NOT contain the nsec or the hex private key as readable text

#### Scenario: No plaintext download path remains

- **WHEN** the create-key backup step is rendered
- **THEN** no control SHALL produce a JSON file containing `privateKey` or `privateKeyHex` in plaintext
- **AND** no control SHALL bypass the encrypted export by a single click

#### Scenario: Backup filename carries no identifying key material

- **WHEN** the extension names an exported backup file
- **THEN** the filename SHALL NOT contain the user-entered key name
- **AND** the filename SHALL NOT contain any part of the private key

### Requirement: Encrypted Backup Uses A Separate Passphrase

The extension SHALL encrypt exported backups under a passphrase the user supplies at export time, distinct from the vault master password, and SHALL label the file and the flow as encrypted.

#### Scenario: User supplies a backup passphrase

- **GIVEN** the user chooses to save a backup file
- **WHEN** the export flow starts
- **THEN** the extension SHALL prompt for a backup passphrase and a confirmation of that passphrase
- **AND** the UI SHALL state that this passphrase is separate from the master password
- **AND** the UI SHALL state that the file is encrypted and useless without the passphrase

#### Scenario: Weak or mismatched passphrase is rejected

- **GIVEN** the export passphrase prompt is shown
- **WHEN** the user enters a passphrase that fails the extension password strength floor, or a confirmation that does not match
- **THEN** the extension SHALL NOT write a file
- **AND** the UI SHALL explain what failed and what to enter instead

#### Scenario: Cancelling export writes nothing

- **GIVEN** the export passphrase prompt is shown
- **WHEN** the user cancels
- **THEN** no file SHALL be written
- **AND** the passphrase entered so far SHALL be dropped from the flow

#### Scenario: Backup passphrase is not retained after export

- **WHEN** an encrypted backup export completes or fails
- **THEN** the extension SHALL drop its references to the backup passphrase
- **AND** the backup passphrase SHALL NOT be stored, logged, or reused as the master password

### Requirement: Encrypted Backup Is Restorable

The extension SHALL be able to restore a key from a backup file it produced, given the correct backup passphrase, and SHALL fail closed on an incorrect passphrase.

#### Scenario: Correct passphrase restores the key

- **GIVEN** an encrypted backup file produced by this extension
- **WHEN** the user imports it and supplies the correct backup passphrase
- **THEN** the extension SHALL recover the same private key that was exported
- **AND** SHALL re-encrypt it under the current vault master password

#### Scenario: Incorrect passphrase reveals nothing

- **GIVEN** an encrypted backup file produced by this extension
- **WHEN** the user supplies an incorrect backup passphrase
- **THEN** the import SHALL fail
- **AND** the failure message SHALL NOT disclose any part of the key or the correct passphrase

### Requirement: Clipboard Copies Of Private Keys Expire

When the extension writes a private key to the system clipboard it SHALL clear that clipboard entry after a bounded interval no longer than 60 seconds, and SHALL tell the user before the copy that the clear will happen.

#### Scenario: Copy is announced before it happens

- **GIVEN** the user is on the create-key backup step with the key revealed
- **WHEN** the copy control is displayed
- **THEN** the UI SHALL state that the clipboard will be cleared automatically
- **AND** SHALL state the interval after which it will be cleared

#### Scenario: Clipboard is cleared after the interval

- **GIVEN** the user copied the nsec to the clipboard
- **WHEN** the announced interval elapses
- **THEN** the extension SHALL overwrite the clipboard so it no longer holds the nsec
- **AND** the UI SHALL indicate that the clipboard was cleared

#### Scenario: Clearing needs no clipboard read permission

- **GIVEN** the user copied the nsec to the clipboard
- **WHEN** the clear runs
- **THEN** the extension SHALL overwrite the clipboard without reading it
- **AND** SHALL NOT require a clipboard-read permission in the manifest
- **AND** the UI SHALL have warned that anything copied during the interval will also be replaced

#### Scenario: User can clear the clipboard immediately

- **GIVEN** the user copied the nsec to the clipboard and the interval has not elapsed
- **WHEN** the user activates the clear-now control
- **THEN** the extension SHALL overwrite the clipboard at once
- **AND** SHALL cancel the pending timed clear

#### Scenario: Leaving the flow clears the clipboard immediately

- **GIVEN** the user copied the nsec to the clipboard
- **WHEN** the user completes or leaves the create-key flow before the interval elapses
- **THEN** the extension SHALL attempt the clear immediately rather than leaving a pending timer

#### Scenario: Clipboard API rejection offers manual transcription

- **GIVEN** the user is on the create-key backup step with the key revealed
- **WHEN** the Clipboard API rejects the write, for example because the document lacks permission or focus
- **THEN** the UI SHALL say the copy did not happen
- **AND** SHALL present the key in a selectable, mono-spaced, grouped form the user can transcribe by hand
- **AND** SHALL NOT silently swallow the failure

### Requirement: Sensitive Create-Key State Is Cleared On Every Exit

The create-key flow SHALL clear the master password, the password confirmation, and the revealed key from its component state and refs on every exit path, including completion, navigating back a step, error, and unmount.

#### Scenario: Finishing onboarding clears password state

- **GIVEN** the user has entered a master password and generated a key
- **WHEN** the user completes the backup step
- **THEN** the password and password confirmation SHALL be cleared from component state
- **AND** the revealed key reference and the password backup reference SHALL be cleared

#### Scenario: Navigating back clears the revealed key

- **GIVEN** the user has revealed the private key on the backup step
- **WHEN** the user navigates back to the key input step
- **THEN** the revealed key SHALL be cleared from the flow
- **AND** the key SHALL require another password-verified reveal to be shown again

#### Scenario: Unmounting clears sensitive state

- **GIVEN** the create-key flow holds a password or a revealed key
- **WHEN** the component unmounts, for example because the popup closes
- **THEN** the flow SHALL drop its references to the password, the password confirmation, and the revealed key

#### Scenario: Reveal failure does not leave stale key material

- **GIVEN** the user requests a key reveal
- **WHEN** the reveal fails
- **THEN** the revealed key reference SHALL remain empty
- **AND** the error message SHALL NOT contain key material

### Requirement: Revealed Private Keys Never Enter React State

The UI SHALL hold a revealed private key only in a mutable reference that does not participate in rendering state, and SHALL NOT place it in `useState`, `useReducer` state, context, or any store.

#### Scenario: Reveal stores the key outside render state

- **GIVEN** the user reveals the private key on the backup step
- **WHEN** the key is returned from the extension
- **THEN** the key SHALL be assigned to a `useRef` value
- **AND** no state update SHALL carry the key value

#### Scenario: Render state carries only a revealed flag

- **WHEN** the backup step re-renders after a reveal
- **THEN** component state SHALL carry only whether a reveal has happened and whether the value is masked
- **AND** SHALL NOT carry the nsec or hex key

### Requirement: Reveal Requires Password Re-Verification

Revealing a private key SHALL require the user's master password to be re-verified against the stored key record, and SHALL NOT be satisfied by an unlocked session alone.

#### Scenario: Correct password reveals the key

- **GIVEN** the vault is unlocked
- **WHEN** a reveal is requested with the correct master password
- **THEN** the extension SHALL re-derive the key encryption key from that password and the record salt
- **AND** SHALL return the nsec and hex forms
- **AND** SHALL zeroize the derived key and the decrypted key bytes it held

#### Scenario: Incorrect password does not reveal the key

- **GIVEN** the vault is unlocked
- **WHEN** a reveal is requested with an incorrect master password
- **THEN** the extension SHALL fail with an incorrect-password error
- **AND** SHALL NOT return any key material

#### Scenario: Missing password does not reveal the key

- **GIVEN** the vault is unlocked
- **WHEN** a reveal is requested with an empty password
- **THEN** the extension SHALL fail with a password-required error
- **AND** SHALL NOT return any key material

### Requirement: Key And Password Inputs Are Excluded From Browser Autofill

Every input that accepts or displays a private key or a password SHALL set `autoComplete="off"` and `spellCheck={false}`, so key material is not offered to the browser password manager, autofill store, or spell-check service.

#### Scenario: Backup step nsec display is excluded

- **WHEN** the create-key backup step displays the revealed nsec in an input
- **THEN** that input SHALL set `autoComplete="off"`
- **AND** SHALL set `spellCheck={false}`
- **AND** SHALL remain read-only

#### Scenario: Onboarding import key input is excluded

- **WHEN** the onboarding import step displays the private key input
- **THEN** that input SHALL set `autoComplete="off"`
- **AND** SHALL set `spellCheck={false}`

#### Scenario: Password and confirmation inputs are excluded

- **WHEN** the extension displays a master password, password confirmation, or backup passphrase input
- **THEN** each input SHALL set `autoComplete="off"`
- **AND** SHALL set `spellCheck={false}`

#### Scenario: Key fields opt out of password manager capture

- **WHEN** an input displays or accepts private key material
- **THEN** the input SHALL carry the opt-out attributes recognised by common password managers
- **AND** the input SHALL NOT be presented to those managers as a credential field

### Requirement: QR Codes Never Encode Private Keys

The extension SHALL render QR codes only for public data. No surface SHALL render, offer, or generate a QR code that encodes an nsec or a hex private key.

#### Scenario: Public key QR remains available

- **GIVEN** a public key display
- **WHEN** the user opens the QR code affordance
- **THEN** the QR code SHALL encode the public key
- **AND** the modal title SHALL identify it as a public key

#### Scenario: Backup step offers no QR affordance for the private key

- **WHEN** the create-key backup step is rendered with the key revealed
- **THEN** no QR code control SHALL be offered for the private key
- **AND** no QR code encoding the private key SHALL be rendered

### Requirement: Backup Is Verified Before The Flow Can Complete

The create-key flow SHALL require positive evidence that the user recorded the key before it allows completion, and SHALL NOT accept an unverified acknowledgement checkbox as that evidence.

#### Scenario: Verification is required to finish

- **GIVEN** the user has revealed the private key
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

### Requirement: Key Loss Consequences Are Stated Plainly

The create-key flow SHALL tell the user, before completion, that a forgotten master password with no backup makes the identity permanently unrecoverable, and that no party can restore it.

#### Scenario: Backup step states irrecoverability

- **WHEN** the create-key backup step is rendered
- **THEN** the UI SHALL state that the private key cannot be recovered if both the password and the backup are lost
- **AND** SHALL state that no recovery service, support channel, or reset exists

#### Scenario: Encrypted export states passphrase dependence

- **WHEN** the encrypted backup export flow is shown
- **THEN** the UI SHALL state that losing the backup passphrase makes the exported file unusable


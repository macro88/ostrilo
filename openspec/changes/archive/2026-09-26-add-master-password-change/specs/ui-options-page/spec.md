## ADDED Requirements

### Requirement: Security Tab Offers Master Password Change

The Security tab SHALL offer a "Change master password" action that opens a dialog with current, new and confirm fields. The dialog SHALL show the existing password-strength feedback for the new password, SHALL exclude every field from autofill and spell-check, and SHALL clear all three values on success, failure and close. It SHALL present `rate_limited` as a wait with its remaining time. It SHALL present a legacy-or-damaged-record refusal with the step that resolves it. On success it SHALL state that encrypted backup files keep their own passphrase, and, when biometric unlock was enrolled, that it must be enrolled again.

#### Scenario: Successful change from the Security tab

- **GIVEN** the options page is open on the Security tab with the vault unlocked
- **WHEN** the user completes the dialog with the correct current password and a matching, policy-compliant new password
- **THEN** a success message states that backup files keep their own passphrase
- **AND** the dialog's fields are empty

#### Scenario: Wrong current password in the dialog

- **WHEN** the user submits the dialog with an incorrect current password
- **THEN** the dialog reports an incorrect password
- **AND** the password fields are cleared

#### Scenario: Throttled attempt in the dialog

- **GIVEN** an unlock-throttle backoff is active
- **WHEN** the user submits the dialog
- **THEN** the dialog shows the remaining wait rather than an incorrect-password message

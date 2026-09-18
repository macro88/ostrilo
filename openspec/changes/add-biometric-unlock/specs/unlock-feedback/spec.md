## MODIFIED Requirements

### Requirement: The User Is Told Why An Unlock Failed

The lock screen SHALL surface the reason the background gave for a failed unlock, using the structured error code and detail from the RPC response rather than a generic message. This applies to both unlock paths. Because every biometric verification failure collapses to a single code with one fixed caller-safe detail, the lock screen SHALL render its own copy for that code and SHALL NOT render that detail. Every failure message SHALL name the master password as the way to unlock now, and SHALL NOT offer a recovery path, because none exists.

#### Scenario: Incorrect password is reported as such

- **WHEN** an unlock attempt fails because the password is incorrect
- **THEN** the lock screen displays that the password was incorrect

#### Scenario: Throttled attempt reports the wait

- **GIVEN** the unlock throttle has imposed a delay
- **WHEN** the user attempts to unlock during that delay
- **THEN** the lock screen displays that attempts are paused
- **AND** it displays how long the user must wait
- **AND** it MUST NOT present this as an incorrect password

#### Scenario: Absent vault is distinguished from a wrong password

- **GIVEN** no vault has been created
- **WHEN** an unlock is attempted
- **THEN** the lock screen states that no vault exists and directs the user to create or import a key
- **AND** it MUST NOT state that the password was incorrect

#### Scenario: Damaged vault is distinguished from a wrong password

- **GIVEN** the stored vault cannot be opened because its records are damaged or its version is unsupported
- **WHEN** an unlock is attempted with the correct password
- **THEN** the lock screen states that the vault could not be opened
- **AND** it MUST NOT state that the password was incorrect

#### Scenario: The displayed reason comes from the structured error

- **WHEN** the lock screen renders an unlock failure
- **THEN** the message MUST be derived from the RPC error code and its detail field
- **AND** it MUST NOT be derived from the exception's `message` property, which carries only a machine identifier

#### Scenario: No failure reason discloses key material

- **WHEN** any unlock failure is displayed
- **THEN** the message MUST NOT contain the entered password, any private key, or any value derived from either

#### Scenario: A refused biometric unlock says the attempt failed and names the password

- **GIVEN** a biometric unlock the background refused
- **WHEN** the lock screen renders the failure
- **THEN** it states that the device did not unlock the vault and that the master password will unlock it
- **AND** the password field is focused and ready for input
- **AND** the message MUST NOT name which verification step failed
- **AND** the fixed detail string the background returned MUST NOT be rendered

#### Scenario: A throttled biometric attempt reuses the countdown copy

- **GIVEN** the unlock throttle has imposed a delay
- **WHEN** a biometric unlock is attempted during that delay
- **THEN** the lock screen displays the same paused-attempts copy and the same countdown a throttled password attempt displays
- **AND** it MUST NOT present this as a failed biometric attempt
- **AND** it states that the password is subject to the same delay

#### Scenario: No biometric failure discloses the credential

- **WHEN** any biometric failure is displayed
- **THEN** the message MUST NOT contain the credential identifier, the factor label, or any pseudo-random-function output

## ADDED Requirements

### Requirement: Every Biometric Unlock Outcome Has A Designed Lock-Screen State

The lock screen SHALL render a distinct designed state for each biometric outcome: no usable factor, a cancelled ceremony, a refused unlock, a throttled attempt, a due password rehearsal, a first unlock after a browser restart or extension update, and a permanently unusable factor. Every one of these states SHALL name the master password as the way to unlock now. States that are not failures SHALL be presented as an explanation, not as an error: they SHALL NOT use error styling, SHALL NOT be announced as an alert, and SHALL NOT reuse the failure line.

#### Scenario: No usable factor shows no affordance at all

- **GIVEN** a vault with no enrolled factor, or a build where the feature is not present, or a capability check that did not succeed
- **WHEN** the lock screen renders
- **THEN** it shows the mascot, the title, the password field and Unlock, and nothing else
- **AND** it MUST NOT render a disabled biometric control
- **AND** it MUST NOT render an explanation of a feature the user has not enrolled

#### Scenario: A cancelled ceremony leaves no trace

- **GIVEN** a biometric ceremony the user dismissed
- **WHEN** the ceremony window closes
- **THEN** the lock screen displays no error text
- **AND** focus returns to the password field
- **AND** the biometric affordance is still offered
- **AND** no failure is recorded against the unlock throttle

#### Scenario: A due rehearsal is explained, not reported as an error

- **GIVEN** no password unlock has occurred within the rehearsal interval
- **WHEN** the lock screen renders
- **THEN** no biometric affordance is shown
- **AND** one line states that the password is needed this time to keep it rehearsed
- **AND** that line is not styled or announced as an error

#### Scenario: The first unlock after a restart is explained the same way

- **GIVEN** the browser has restarted or the extension has updated since the last unlock
- **WHEN** the lock screen renders
- **THEN** no biometric affordance is shown
- **AND** one line states that the first unlock after a restart uses the password
- **AND** that line is not styled or announced as an error
- **AND** a later unlock in the same browser session offers the affordance again

#### Scenario: A permanently unusable factor offers to forget it

- **GIVEN** an enrolled factor the background reports as permanently unusable
- **WHEN** the lock screen renders
- **THEN** it states that the enrolled device can no longer unlock this vault
- **AND** it offers an action that forgets the factor
- **AND** that action requires no credential and succeeds while the vault is locked
- **AND** after it succeeds the lock screen renders the no-usable-factor state

#### Scenario: Every state names the password

- **WHEN** any of the seven biometric states is rendered
- **THEN** the master password is named as the way to unlock now
- **AND** no state offers a recovery, reset or account-recovery path

#### Scenario: One primary action remains

- **WHEN** any biometric state is rendered
- **THEN** Unlock remains the single primary action
- **AND** the biometric affordance, where shown, is secondary to it

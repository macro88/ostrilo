# session-countdown-display Specification

## Purpose
TBD - created by archiving change add-auto-lock-countdown. Update Purpose after archive.
## Requirements
### Requirement: Time Remaining Before Auto-Lock Is Displayed

The extension SHALL display the time remaining before the vault auto-locks, as a radial countdown, on the Options Security tab, in the popup and sidepanel header, and in the popup Settings panel. The countdown SHALL be displayed only while the vault is unlocked and SHALL NOT be displayed on the approval window or on the lock screen.

#### Scenario: Countdown is shown beside the auto-lock slider

- **GIVEN** the vault is unlocked
- **AND** `autoLockMinutes` is `15`
- **WHEN** the user opens the Options Security tab
- **THEN** a radial countdown is displayed alongside the auto-lock slider
- **AND** it reports the time remaining before the vault auto-locks

#### Scenario: Countdown is shown in the popup header

- **GIVEN** the vault is unlocked
- **WHEN** the user opens the popup
- **THEN** a radial countdown is displayed in the header
- **AND** the existing lock button remains present and operable

#### Scenario: Countdown is shown in the popup Settings panel

- **GIVEN** the vault is unlocked
- **WHEN** the user opens the Settings panel in the popup
- **THEN** a radial countdown is displayed alongside the popup auto-lock slider

#### Scenario: Countdown is absent while locked

- **GIVEN** the vault is locked
- **WHEN** any extension surface is opened
- **THEN** no countdown is displayed
- **AND** no remaining time is reported

#### Scenario: Approval window carries no countdown

- **GIVEN** the vault is unlocked and an approval request is pending
- **WHEN** the approval window is shown
- **THEN** no countdown is displayed on it

### Requirement: The Countdown Derives From The Enforced Deadline

The countdown SHALL derive its value from the inactivity deadline reported by the background, and SHALL NOT compute a deadline from any other source. The displayed value SHALL be computed from an absolute deadline timestamp against the current time, so that a surface which was hidden, throttled, or suspended reports the correct remaining time on its next update.

#### Scenario: Countdown reflects the configured timeout

- **GIVEN** the vault is unlocked
- **AND** `autoLockMinutes` is `15`
- **WHEN** the countdown is first displayed immediately after unlock
- **THEN** it reports approximately fifteen minutes remaining

#### Scenario: Countdown follows a timeout change

- **GIVEN** the vault is unlocked with `autoLockMinutes` of `30`
- **WHEN** the user changes `autoLockMinutes` to `5` and the change is stored
- **THEN** the countdown reports the remaining time computed from the new timeout
- **AND** it does not continue to report remaining time computed from the previous timeout

#### Scenario: Countdown follows recorded activity

- **GIVEN** the vault is unlocked with `autoLockMinutes` of `15`
- **AND** the countdown reports five minutes remaining
- **WHEN** the user performs an action that records activity
- **THEN** the countdown reports approximately fifteen minutes remaining

#### Scenario: Hidden surface reports correctly on return

- **GIVEN** the vault is unlocked and a surface displaying the countdown is hidden
- **WHEN** the surface becomes visible again after several minutes
- **THEN** the countdown reports the remaining time computed from the current time
- **AND** it does not report the value it held when the surface was hidden

#### Scenario: No deadline is available

- **GIVEN** the background reports no inactivity deadline
- **WHEN** a surface that carries the countdown is displayed
- **THEN** no countdown is rendered
- **AND** the surface does not render a countdown reading zero

### Requirement: The Countdown Never Postpones The Lock

Displaying, updating, or polling the countdown SHALL NOT record activity, SHALL NOT postpone the inactivity deadline, and SHALL NOT keep the background worker alive. The countdown SHALL update without issuing a background request per update.

#### Scenario: An open surface displaying the countdown still locks

- **GIVEN** the vault is unlocked with `autoLockMinutes` of `5`
- **AND** a surface displaying the countdown is left open with no user interaction
- **WHEN** five minutes pass
- **THEN** the vault is locked
- **AND** the surface shows the lock screen

#### Scenario: Countdown updates issue no background request

- **GIVEN** the vault is unlocked and the countdown is displayed
- **WHEN** the countdown updates between lock-state polls
- **THEN** no RPC request is sent for the update
- **AND** the last-activity timestamp is unchanged

### Requirement: The Countdown Is A Readout, Not A Control

The countdown SHALL NOT be interactive. It SHALL NOT offer an action that extends the session, ends the session, or changes the auto-lock timeout, and SHALL NOT replace or absorb the existing header lock control.

#### Scenario: Activating the countdown does nothing

- **GIVEN** the vault is unlocked and the countdown is displayed in the header
- **WHEN** the user clicks the countdown
- **THEN** the vault is not locked
- **AND** the inactivity deadline is unchanged
- **AND** no settings change is initiated

#### Scenario: The lock control remains separate

- **GIVEN** the vault is unlocked and the countdown is displayed in the header
- **WHEN** the header is rendered
- **THEN** the existing lock button is present as a distinct control
- **AND** activating it locks the vault

### Requirement: The Countdown Degrades Legibly Near Zero

The countdown SHALL report whole minutes, rounded up, while more than sixty seconds remain. At or below sixty seconds it SHALL report seconds and SHALL take the destructive role color for both the arc and the label. At or below zero it SHALL report a locked state and stop counting.

#### Scenario: Minutes are rounded up

- **GIVEN** the vault is unlocked
- **AND** ninety seconds remain before the deadline
- **WHEN** the countdown is displayed
- **THEN** it reports two minutes

#### Scenario: Sub-minute switches to seconds and the destructive role

- **GIVEN** the vault is unlocked
- **AND** forty-five seconds remain before the deadline
- **WHEN** the countdown is displayed
- **THEN** it reports forty-five seconds
- **AND** the arc and label use the destructive role color

#### Scenario: Deadline reached

- **GIVEN** the vault is unlocked and the countdown is displayed
- **WHEN** the deadline passes
- **THEN** the countdown reports a locked state
- **AND** it does not report a negative remaining time

### Requirement: The Countdown Is Not An Authority On Lock State

The countdown SHALL NOT lock the vault, SHALL NOT gate any privileged operation, and SHALL NOT be treated as the source of truth for whether the vault is locked. A disagreement between the countdown and the background SHALL be resolved in favour of the background on the next lock-state read.

#### Scenario: Countdown reads time remaining but the vault is already locked

- **GIVEN** a surface displays a countdown reporting time remaining
- **AND** the background has already locked the vault
- **WHEN** a privileged operation is attempted from that surface
- **THEN** the operation is refused with the `locked` error code
- **AND** the surface shows the lock screen on the next lock-state read

#### Scenario: Countdown reaches zero before the background locks

- **GIVEN** a surface displays a countdown that has reached zero
- **AND** the background still reports the vault as unlocked
- **WHEN** the next lock-state read completes
- **THEN** the surface renders whichever state the background reports
- **AND** the countdown does not itself initiate a lock

### Requirement: The Countdown Is Accessible

The countdown SHALL expose its remaining time to assistive technology as text, SHALL NOT announce each update, and SHALL NOT convey the sub-minute state through color alone. Arc motion SHALL respect `prefers-reduced-motion`.

#### Scenario: Remaining time is available as text

- **GIVEN** the vault is unlocked and the countdown is displayed
- **WHEN** the countdown is reached by assistive technology
- **THEN** its accessible name states the time remaining before the vault locks
- **AND** the decorative arc is not exposed as a separate element

#### Scenario: Updates are not announced continuously

- **GIVEN** the vault is unlocked and the countdown is displayed
- **WHEN** the countdown updates each second
- **THEN** each update is not announced by assistive technology

#### Scenario: Sub-minute state is conveyed without relying on color

- **GIVEN** the vault is unlocked
- **AND** thirty seconds remain before the deadline
- **WHEN** the countdown is reached by assistive technology
- **THEN** the remaining seconds are stated in its accessible name

#### Scenario: Reduced motion is respected

- **GIVEN** the user has requested reduced motion
- **WHEN** the countdown updates
- **THEN** the arc steps to its new value without an animated transition


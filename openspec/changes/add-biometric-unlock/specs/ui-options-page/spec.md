## MODIFIED Requirements

### Requirement: Security Settings Tab

The Options Page SHALL provide a Security tab for authentication and session management. The auto-lock timeout offered by this tab SHALL be an enforced inactivity timeout within the accepted range, SHALL NOT offer a never-lock option, and SHALL require password re-authentication before a change is stored. The tab SHALL display the time remaining before the vault auto-locks as a radial countdown alongside the auto-lock slider. The tab SHALL render a biometric unlock section only after a live capability round trip resolves, SHALL render an explanatory non-interactive row rather than a disabled control when that round trip reports the feature unusable, and SHALL render no biometric section, heading, or placeholder at all on a build where the feature is not compiled in. Enrolling a biometric factor SHALL require password re-authentication through the tab's existing re-authentication dialog, and the enrolment ceremony SHALL run in the options page itself, so the password and the authenticator's output never leave the document that collected them; forgetting an enrolled factor SHALL NOT require any credential. The section SHALL list an enrolled factor with the date it was added.

**Acceptance Criteria:**

- Tab includes Auto-lock Slider and Session TTL Slider
- Sliders show current value with units
- Security actions expose clear labels and preserve existing settings behavior
- Auto-lock slider offers whole minutes from `1` to `60` and no never-lock option
- Session TTL slider offers `0` to `60`, where `0` is labeled as lasting until the vault locks
- Changing the auto-lock or session grant timeout requires password re-authentication
- Tab explains that the auto-lock timeout is measured from the last recorded activity
- A radial countdown displays the time remaining before auto-lock, beside the auto-lock slider
- The countdown is a readout only and offers no action
- No biometric section is rendered from compiled-in assumptions, cached state, or an in-flight capability query
- An unusable biometric capability is reported as a non-interactive explanatory row, never as a disabled checkbox, switch, or button
- A build without the feature compiled in renders no biometric section, heading, placeholder, or explanatory row
- Enrolment is initiated only through the tab's existing password re-authentication dialog
- The enrolment ceremony runs in the options page, not in a second window
- An authenticator that completes the ceremony but returns no usable output is reported as a designed state that names what to try instead, and enrols nothing
- An enrolment ceremony that ends without a credential, including one a passkey provider refused, leaves the section ready to retry and names the providers known to work
- Forgetting an enrolled factor is available without re-authentication
- An enrolled factor is listed with the date it was added

#### Scenario: User configures auto-lock timeout

- **GIVEN** Options Page Security tab is active
- **AND** the vault is unlocked
- **WHEN** user changes auto-lock timeout and re-enters the correct password
- **THEN** slider value updates
- **AND** setting is saved to extension storage
- **AND** the inactivity deadline is recomputed from the new timeout
- **AND** the countdown reports the remaining time computed from the new timeout

#### Scenario: Auto-lock slider offers no never-lock option

- **GIVEN** Options Page Security tab is active
- **WHEN** the user drags the auto-lock slider to its minimum
- **THEN** the minimum selectable value is `1` minute
- **AND** no "Never" label is shown

#### Scenario: Security setting change is refused without the password

- **GIVEN** Options Page Security tab is active
- **WHEN** the user changes the auto-lock timeout and supplies an incorrect password
- **THEN** the change is refused
- **AND** the stored timeout is unchanged

#### Scenario: Countdown accompanies the auto-lock slider

- **GIVEN** the vault is unlocked
- **WHEN** Options Page Security tab is active
- **THEN** a radial countdown reporting the time remaining before auto-lock is displayed beside the auto-lock slider
- **AND** the countdown does not offer a control that changes or extends the session

#### Scenario: Biometric section appears only after the capability round trip resolves

- **GIVEN** Options Page Security tab is active on a build with the feature compiled in
- **WHEN** the tab renders and the capability query has not yet resolved
- **THEN** no biometric control, row, or heading is rendered
- **AND** when the query resolves reporting the feature usable, the biometric section is rendered

#### Scenario: An unusable capability renders an explanation, not a disabled control

- **GIVEN** Options Page Security tab is active on a build with the feature compiled in
- **WHEN** the capability round trip reports that no usable authenticator is available
- **THEN** the tab renders a non-interactive row explaining why biometric unlock is unavailable
- **AND** the row names the password as the working alternative
- **AND** no checkbox, switch, or button is rendered in any state, disabled included

#### Scenario: A build without the feature renders nothing

- **GIVEN** a build where biometric unlock is not compiled in
- **WHEN** the Security tab renders
- **THEN** no biometric section, heading, explanatory row, or placeholder is present
- **AND** no capability round trip is attempted

#### Scenario: Enrolment is gated by password re-authentication

- **GIVEN** Options Page Security tab is active with the biometric section rendered and no factor enrolled
- **WHEN** the user starts enrolment
- **THEN** the tab's existing password re-authentication dialog is presented
- **AND** enrolment proceeds only after the correct password is supplied
- **AND** supplying an incorrect password leaves no factor enrolled

#### Scenario: The ceremony runs in the tab that holds the password

- **GIVEN** the user has supplied the correct password in the re-authentication dialog
- **WHEN** the enrolment ceremony starts
- **THEN** it runs in the options page
- **AND** no second window is opened for it
- **AND** the password and the authenticator's output are sent to the background in one request

#### Scenario: An authenticator that returns no output enrols nothing and says so

- **GIVEN** an enrolment ceremony the user completed
- **WHEN** the authenticator returns no usable pseudo-random-function output
- **THEN** no factor is enrolled
- **AND** the section states that this authenticator cannot be used for unlock and names the kinds that can
- **AND** the section states that a passkey entry may have been left behind in the platform's credential manager and can be deleted there

#### Scenario: A provider that refuses the extension leaves enrolment retryable

- **GIVEN** an enrolment ceremony in which the user chose a passkey provider that would not save a passkey for the extension
- **WHEN** the ceremony ends without a credential
- **THEN** no factor is enrolled
- **AND** the section names the passkey providers known to work
- **AND** starting enrolment again asks for the password again

#### Scenario: Forgetting a factor requires no credential

- **GIVEN** Options Page Security tab is active with a factor enrolled
- **WHEN** the user chooses to forget the factor
- **THEN** no password re-authentication dialog is presented
- **AND** the factor is removed
- **AND** the section returns to its not-enrolled state

#### Scenario: An enrolled factor is listed with its enrolment date

- **GIVEN** a biometric factor was enrolled on a known date
- **WHEN** Options Page Security tab renders the biometric section
- **THEN** the factor is listed
- **AND** the date it was added is shown alongside it

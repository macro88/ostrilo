## MODIFIED Requirements

### Requirement: Security Settings Tab

The Options Page SHALL provide a Security tab for authentication and session management. The auto-lock timeout offered by this tab SHALL be an enforced inactivity timeout within the accepted range, SHALL NOT offer a never-lock option, and SHALL require password re-authentication before a change is stored. The tab SHALL display the time remaining before the vault auto-locks as a radial countdown alongside the auto-lock slider.

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

### Requirement: Basic Settings in Popup

The extension SHALL provide a minimal BasicSettings component in the popup containing frequently accessed settings and a link to the Options Page. The component SHALL display the time remaining before the vault auto-locks as a radial countdown alongside its auto-lock slider.

**Acceptance Criteria:**

- BasicSettings includes active key selection, theme selection, and auto-lock configuration
- "Advanced Settings" button opens Options Page
- BasicSettings fits within popup dimensions
- All settings mutations use shared settings/key hooks
- Legacy SettingsView is not mounted by popup navigation
- A radial countdown displays the time remaining before auto-lock, beside the auto-lock slider
- The countdown fits within popup dimensions without displacing the existing controls

#### Scenario: User accesses basic settings in popup

**Given** extension popup is open  
**When** user navigates to Settings view  
**Then** BasicSettings component is displayed  
**And** the active key selector, theme selector, auto-lock slider, and "Advanced Settings" button are visible

#### Scenario: User changes theme in popup

**Given** BasicSettings is displayed in popup  
**When** user selects "Dark" theme from dropdown  
**Then** theme immediately changes to dark mode  
**And** setting is persisted to extension storage  
**And** if Options Page is open, it updates to dark theme

#### Scenario: Countdown accompanies the popup auto-lock slider

- **GIVEN** the vault is unlocked
- **AND** BasicSettings is displayed in the popup
- **WHEN** the Settings view is rendered
- **THEN** a radial countdown reporting the time remaining before auto-lock is displayed beside the auto-lock slider
- **AND** the existing controls remain visible within popup dimensions

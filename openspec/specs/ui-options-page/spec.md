# UI Options Page Specification

## Purpose

Define the browser extension options page, its popup split, local settings synchronization behavior, and validation expectations.
## Requirements
### Requirement: Options Page Entrypoint

The extension SHALL provide a dedicated Options Page accessible via `browser.runtime.openOptionsPage()` that opens in a new browser tab for advanced settings configuration. The Options Page SHALL render the lock screen instead of any tab content while the vault is locked.

**Acceptance Criteria:**

- Options page entrypoint exists at `src/extension/options/`
- Options page declared in manifest with `open_in_tab: true`
- Page loads within 500ms on first open
- Page uses the project design system
- Page is responsive for desktop resolutions from 1280x720 to 4K
- Page checks lock state before rendering tab navigation or tab content
- While locked, the page renders the lock screen and no key label, public key, origin policy, relay entry, or activity entry
- While locked, the page offers no settings, policy, key, or relay mutation
- The page transitions to the lock screen without a reload when the vault locks while the page is open

#### Scenario: User opens options page from popup

- **GIVEN** user has the extension installed
- **AND** the vault is unlocked
- **WHEN** user clicks "Advanced Settings" button in popup Settings view
- **THEN** a new browser tab opens displaying the Options Page
- **AND** the tab URL is `chrome-extension://<id>/options.html`
- **AND** the page loads within 500ms

#### Scenario: User opens options page with hash fragment

- **GIVEN** the vault is unlocked
- **AND** user navigates to `options.html#permissions`
- **WHEN** page loads
- **THEN** the "Permissions" tab is active by default
- **AND** Permissions tab content is displayed

#### Scenario: User opens options page while the vault is locked

- **GIVEN** the vault is locked
- **AND** key records, origin policies, relays, and activity entries are stored
- **WHEN** the user opens `options.html`
- **THEN** the lock screen is displayed
- **AND** no key label, public key, origin policy, relay entry, or activity entry is rendered
- **AND** no settings, policy, key, or relay control is available

#### Scenario: Options page is open when the vault locks

- **GIVEN** the Options Page is open with the Permissions tab active
- **WHEN** the vault locks after the inactivity window elapses
- **THEN** the page replaces tab content with the lock screen
- **AND** no manual reload is required

#### Scenario: User unlocks from the options page

- **GIVEN** the Options Page is showing the lock screen
- **WHEN** the user enters the correct password
- **THEN** the vault unlocks
- **AND** the previously requested tab is displayed

#### Scenario: Locked hash fragment does not bypass the lock screen

- **GIVEN** the vault is locked
- **WHEN** the user navigates directly to `options.html#permissions`
- **THEN** the lock screen is displayed
- **AND** Permissions tab content is not rendered

---

### Requirement: Multi-Tab Navigation

The extension's Options Page SHALL organize settings into logical tabs with clear navigation and content hierarchy.

**Acceptance Criteria:**

- Seven tabs: General, Keys & Identities, Security, Permissions, Activity Log, Relays, Advanced
- Active tab is visually distinct
- Keyboard arrow keys navigate between tabs
- URL hash reflects active tab, such as `#security`
- Browser back/forward navigation updates the active tab

#### Scenario: User navigates between tabs

**Given** Options Page is open on "General" tab  
**When** user clicks "Security" tab  
**Then** the Security tab content is displayed  
**And** URL updates to `options.html#security`

#### Scenario: Keyboard tab navigation

**Given** Options Page is open with "General" tab active  
**When** user presses Right Arrow key  
**Then** "Keys & Identities" tab becomes active  
**And** tab content switches accordingly

---

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

### Requirement: Shared Component Extraction

The extension SHALL provide reusable settings components for both BasicSettings and Options Page tabs.

**Acceptance Criteria:**

- Components include KeySelectorCard, ThemeSelector, AutoLockSlider, SessionTTLSlider, RelayList, ActivityLogConfig, OriginPolicyTable, and MediumKindToggles
- Components are located in `src/ui/features/settings/components/shared/`
- Components accept props for customization
- Components avoid duplicating settings UI behavior between popup and options page

#### Scenario: ThemeSelector component used in both contexts

**Given** ThemeSelector component is extracted  
**When** component is imported in BasicSettings and GeneralSettingsTab  
**Then** both usages render consistently  
**And** theme changes work in both contexts

---

### Requirement: Cross-Context Settings Sync

The extension SHALL synchronize local settings changes between popup and Options Page in real time using the shared storage-backed settings model.

**Acceptance Criteria:**

- Settings mutations propagate through extension storage events or shared storage hooks
- Both popup and options page update after local storage changes
- UI updates within 100ms of storage change under normal local conditions
- No page reload is required for local synchronization
- Concurrent local updates use the storage model's last-write-wins behavior

#### Scenario: Settings sync from options to popup

**Given** both popup and Options Page are open  
**And** Options Page shows Security tab  
**When** user changes auto-lock in Options Page  
**Then** extension storage is updated  
**And** popup BasicSettings auto-lock slider updates to the new value

#### Scenario: Settings sync from popup to options

**Given** both popup and Options Page are open  
**And** Options Page shows General tab  
**When** user changes theme in popup BasicSettings  
**Then** Options Page theme updates  
**And** General tab shows the selected theme

---

### Requirement: General Settings Tab

The Options Page SHALL provide a General tab containing display and interface preferences.

**Acceptance Criteria:**

- Tab includes theme selection and open-in behavior
- Tab layout uses a readable full-page options layout
- Settings auto-save on change
- Settings are grouped by category with clear headings

#### Scenario: User configures display settings

**Given** Options Page General tab is active  
**When** user changes theme or open-in behavior  
**Then** the setting updates immediately  
**And** the change is saved to extension storage

---

### Requirement: Keys & Identities Tab

The Options Page SHALL provide a Keys & Identities tab for comprehensive multi-key management.

**Acceptance Criteria:**

- Tab displays all keys with identifying labels and public keys
- Active key is visually indicated
- User can set active, rename, delete, create, and import keys where supported
- Cannot delete last remaining key
- Profile metadata can be displayed for keys when available

#### Scenario: User attempts to delete last key

**Given** Options Page Keys tab shows one key  
**When** user views the delete action  
**Then** delete is disabled  
**And** the UI indicates the last key cannot be deleted

---

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

### Requirement: Permissions Tab

The Options Page SHALL provide a Permissions tab for managing per-origin policies and trust levels.

**Acceptance Criteria:**

- Tab displays configured origins
- Per-origin policy actions update stored settings
- Empty state is shown when no origins are configured

#### Scenario: User removes origin policy

**Given** Options Page Permissions tab shows an origin  
**When** user removes the origin policy  
**Then** the origin is removed from stored policy configuration

---

### Requirement: Activity Log Tab

The Options Page SHALL provide an Activity Log tab for log configuration and management.

**Acceptance Criteria:**

- Tab includes max entries control, clear log action, and export log action
- Export generates a local JSON file download
- Clear action uses existing activity log clearing behavior

#### Scenario: User exports activity log

**Given** Options Page Activity Log tab is active  
**When** user clicks export  
**Then** recent activity is fetched  
**And** a JSON file download is generated locally

---

### Requirement: Relays Tab

The Options Page SHALL provide a Relays tab for Nostr relay management.

**Acceptance Criteria:**

- Tab displays configured relays
- User can add and remove relays
- Add relay input validates secure WebSocket URLs beginning with `wss://`
- Invalid relay input shows an inline error and does not add the relay

#### Scenario: User adds invalid relay URL

**Given** Options Page Relays tab is active  
**When** user enters `http://relay.example.com`  
**And** clicks Add Relay  
**Then** error message displays that relay URLs must start with `wss://`  
**And** relay is not added to the list

---

### Requirement: Advanced Tab

The Options Page SHALL provide an Advanced tab for power-user settings and debug information.

**Acceptance Criteria:**

- Tab includes Medium Trust Kind Toggles
- Medium kinds toggle list matches existing functionality
- Debug information is development-only where applicable

#### Scenario: User toggles medium trust kind

**Given** Options Page Advanced tab is active  
**And** Kind 7 is enabled for medium trust  
**When** user toggles Kind 7 switch off  
**Then** Kind 7 is removed from `mediumAllowKinds`  
**And** medium trust origins will prompt for Kind 7 events

---

### Requirement: Auto-Save Feedback

The Options Page SHALL provide clear feedback that settings changes are automatically saved without requiring manual save action.

**Acceptance Criteria:**

- Footer displays "Changes are saved automatically"
- No Save or Apply button is required
- Reset All requires confirmation

#### Scenario: User sees auto-save confirmation

**Given** Options Page is open  
**When** user changes any setting  
**Then** footer shows "Changes are saved automatically"  
**And** no manual save action is required  
**And** change persists immediately to storage

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


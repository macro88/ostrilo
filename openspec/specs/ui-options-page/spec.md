# UI Options Page Specification

## Purpose

Define the browser extension options page, its popup split, local settings synchronization behavior, and validation expectations.

## Requirements

### Requirement: Options Page Entrypoint

The extension SHALL provide a dedicated Options Page accessible via `browser.runtime.openOptionsPage()` that opens in a new browser tab for advanced settings configuration.

**Acceptance Criteria:**

- Options page entrypoint exists at `src/extension/options/`
- Options page declared in manifest with `open_in_tab: true`
- Page loads within 500ms on first open
- Page uses the project design system
- Page is responsive for desktop resolutions from 1280x720 to 4K

#### Scenario: User opens options page from popup

**Given** user has the extension installed  
**When** user clicks "Advanced Settings" button in popup Settings view  
**Then** a new browser tab opens displaying the Options Page  
**And** the tab URL is `chrome-extension://<id>/options.html`  
**And** the page loads within 500ms

#### Scenario: User opens options page with hash fragment

**Given** user navigates to `options.html#permissions`  
**When** page loads  
**Then** the "Permissions" tab is active by default  
**And** Permissions tab content is displayed

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

The extension SHALL provide a minimal BasicSettings component in the popup containing frequently accessed settings and a link to the Options Page.

**Acceptance Criteria:**

- BasicSettings includes active key selection, theme selection, and auto-lock configuration
- "Advanced Settings" button opens Options Page
- BasicSettings fits within popup dimensions
- All settings mutations use shared settings/key hooks
- Legacy SettingsView is not mounted by popup navigation

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

---

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

The Options Page SHALL provide a Security tab for authentication and session management.

**Acceptance Criteria:**

- Tab includes Auto-lock Slider and Session TTL Slider
- Sliders show current value with units
- Security actions expose clear labels and preserve existing settings behavior

#### Scenario: User configures auto-lock timeout

**Given** Options Page Security tab is active  
**When** user changes auto-lock timeout  
**Then** slider value updates  
**And** setting is saved to extension storage

---

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

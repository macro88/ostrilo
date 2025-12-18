# UI Options Page Specification

## ADDED Requirements

### Requirement: Options Page Entrypoint

The extension SHALL provide a dedicated Options Page accessible via `browser.runtime.openOptionsPage()` that opens in a new browser tab for advanced settings configuration.

**Acceptance Criteria:**

- Options page entrypoint exists at `src/extension/options/`
- Options page declared in manifest with `open_in_tab: true`
- Page loads within 500ms on first open
- Page uses same design system as popup (Tailwind + shadcn/ui)
- Page is responsive for desktop resolutions (1280x720 to 4K)

#### Scenario: User opens options page from popup

**Given** user has the extension installed  
**When** user clicks "Advanced Settings" button in popup Settings view  
**Then** a new browser tab opens displaying the Options Page  
**And** the tab URL is `chrome-extension://<id>/options.html`  
**And** the page loads within 500ms

#### Scenario: User opens options page from browser menu

**Given** user right-clicks the extension icon  
**When** user selects "Options" from context menu  
**Then** a new browser tab opens displaying the Options Page  
**And** if an options page tab already exists, that tab is focused instead

---

### Requirement: Multi-Tab Navigation

The extension's Options Page SHALL organize settings into logical tabs with clear navigation and content hierarchy.

**Acceptance Criteria:**

- Seven tabs: General, Keys & Identities, Security, Permissions, Activity Log, Relays, Advanced
- Tab navigation uses shadcn/ui Tabs component
- Active tab is visually distinct
- Tab changes preserve scroll position per tab
- Keyboard arrow keys navigate between tabs
- URL hash reflects active tab (e.g., `#security`)

#### Scenario: User navigates between tabs

**Given** Options Page is open on "General" tab  
**When** user clicks "Security" tab  
**Then** the Security tab content is displayed  
**And** URL updates to `options.html#security`  
**And** scroll position resets to top of content

#### Scenario: User opens options page with hash fragment

**Given** user navigates to `options.html#permissions`  
**When** page loads  
**Then** the "Permissions" tab is active by default  
**And** Permissions tab content is displayed

#### Scenario: Keyboard tab navigation

**Given** Options Page is open with "General" tab active  
**When** user presses Right Arrow key  
**Then** "Keys & Identities" tab becomes active  
**And** tab content switches accordingly

---

### Requirement: Basic Settings in Popup

The extension SHALL provide a minimal BasicSettings component in the popup containing only frequently accessed settings and a link to the Options Page.

**Acceptance Criteria:**

- BasicSettings includes: Active Key Selector, Theme Selector, Auto-lock Slider
- "Advanced Settings" button opens Options Page
- BasicSettings fits within popup dimensions without scrolling (max 600px height)
- All settings mutations use shared hooks (useAppSettings, useKeyManager)
- Existing SettingsView is replaced by BasicSettings in popup

#### Scenario: User accesses basic settings in popup

**Given** extension popup is open  
**When** user navigates to Settings view  
**Then** BasicSettings component is displayed  
**And** Active Key Selector shows current key  
**And** Theme Selector shows current theme  
**And** Auto-lock Slider shows current timeout  
**And** "Advanced Settings" button is visible at bottom

#### Scenario: User changes theme in popup

**Given** BasicSettings is displayed in popup  
**When** user selects "Dark" theme from dropdown  
**Then** theme immediately changes to dark mode  
**And** setting is persisted to chrome.storage.sync  
**And** if Options Page is open, it updates to dark theme

---

### Requirement: Shared Component Extraction

The extension SHALL extract reusable settings components from the existing SettingsView for use in both BasicSettings and Options Page tabs.

**Acceptance Criteria:**

- Components created: KeySelectorCard, ThemeSelector, AutoLockSlider, SessionTTLSlider, RelayList, ActivityLogConfig, OriginPolicyTable, MediumKindToggles
- Components located in `src/ui/features/settings/components/shared/`
- Each component accepts props for customization
- Components use shared hooks (useAppSettings, useKeyManager)
- No code duplication between popup and options page

#### Scenario: ThemeSelector component used in both contexts

**Given** ThemeSelector component is extracted  
**When** component is imported in BasicSettings  
**And** component is imported in GeneralSettingsTab  
**Then** both usages render identically  
**And** theme changes work in both contexts

---

### Requirement: Cross-Context Settings Sync

The extension SHALL synchronize settings changes between popup and Options Page in real-time using chrome.storage.onChanged events.

**Acceptance Criteria:**

- Settings mutations trigger chrome.storage.onChanged events
- Both popup and options page listen for storage changes
- UI updates within 100ms of storage change
- No race conditions or stale state issues
- Changes in one context immediately reflect in other context

#### Scenario: Settings sync from options to popup

**Given** both popup and Options Page are open  
**And** Options Page shows Security tab  
**When** user changes auto-lock from 5 to 10 minutes in Options Page  
**Then** chrome.storage.sync is updated  
**And** popup BasicSettings auto-lock slider updates to 10 minutes  
**And** update occurs within 100ms

#### Scenario: Settings sync from popup to options

**Given** both popup and Options Page are open  
**And** Options Page shows General tab  
**When** user changes theme to "Light" in popup BasicSettings  
**Then** Options Page theme switches to light mode  
**And** General tab shows "Light" selected in theme dropdown  
**And** update occurs within 100ms

---

### Requirement: General Settings Tab

The Options Page SHALL provide a General tab containing display and interface preferences.

**Acceptance Criteria:**

- Tab includes: Theme Selector, Side Panel Toggle
- Tab layout uses full-width container (max 800px)
- All settings auto-save on change
- Settings grouped by category with clear headings

#### Scenario: User configures display settings

**Given** Options Page General tab is active  
**When** user changes theme to "System"  
**And** toggles side panel ON  
**Then** theme updates to follow system preference  
**And** side panel is enabled in manifest  
**And** changes are saved to chrome.storage.sync

---

### Requirement: Keys & Identities Tab

The Options Page SHALL provide a Keys & Identities tab for comprehensive multi-key management.

**Acceptance Criteria:**

- Tab displays all keys with avatars, names, and public keys
- Active key is visually indicated
- User can rename, delete, set active, import, export keys
- Cannot delete last remaining key
- Profile metadata fetched and displayed for each key
- Import/export actions require password confirmation

#### Scenario: User renames a key

**Given** Options Page Keys tab shows 3 keys  
**When** user clicks "Rename" on a key labeled "Main"  
**And** enters "Personal" as new label  
**And** clicks "Save"  
**Then** key label updates to "Personal"  
**And** change persists to storage  
**And** popup key selector shows updated label

#### Scenario: User attempts to delete last key

**Given** Options Page Keys tab shows 1 key  
**When** user clicks "Delete" button on that key  
**Then** delete button is disabled  
**And** tooltip explains "Cannot delete last key"

---

### Requirement: Security Settings Tab

The Options Page SHALL provide a Security tab for authentication and session management.

**Acceptance Criteria:**

- Tab includes: Auto-lock Slider, Session TTL Slider, Biometric Toggle (if available)
- Tab includes action buttons: Change Password, Export Private Key, Clear Sessions
- All sliders show current value with units
- Export actions show security warnings

#### Scenario: User configures auto-lock timeout

**Given** Options Page Security tab is active  
**When** user drags auto-lock slider to 15 minutes  
**Then** slider value updates to "15 min"  
**And** setting is saved to chrome.storage.sync  
**And** extension will auto-lock after 15 minutes of inactivity

---

### Requirement: Permissions Tab

The Options Page SHALL provide a Permissions tab for managing per-origin policies and trust levels.

**Acceptance Criteria:**

- Tab displays table of all connected origins
- Table columns: Origin, Name, Trust Level, Source, Actions
- Trust level editable via dropdown per origin
- Session grant toggle per origin
- Remove origin action with confirmation
- Table sortable and filterable (if > 10 origins)

#### Scenario: User changes trust level for an origin

**Given** Options Page Permissions tab shows "primal.net" with "medium" trust  
**When** user selects "high" from trust level dropdown  
**Then** trust level updates to "high"  
**And** source badge changes to "User"  
**And** change persists to chrome.storage.sync

#### Scenario: User removes origin policy

**Given** Options Page Permissions tab shows "old-app.com"  
**When** user clicks "Remove" action  
**And** confirms deletion in dialog  
**Then** "old-app.com" is removed from table  
**And** origin policy is deleted from storage

---

### Requirement: Activity Log Tab

The Options Page SHALL provide an Activity Log tab for log configuration and management.

**Acceptance Criteria:**

- Tab includes: Max Entries Slider, Clear Log Button, Export Log Button
- Tab shows preview of last 10 log entries
- Clear action requires confirmation
- Export generates JSON file download

#### Scenario: User adjusts activity log retention

**Given** Options Page Activity Log tab is active  
**When** user sets max entries slider to 100  
**Then** setting updates to 100 entries  
**And** future log entries respect 100-entry limit  
**And** oldest entries are pruned when limit exceeded

---

### Requirement: Relays Tab

The Options Page SHALL provide a Relays tab for Nostr relay connection management.

**Acceptance Criteria:**

- Tab displays list of configured relays
- User can add, remove, and test relays
- Add relay input validates WebSocket URL format (wss://)
- Remove action available for each relay
- Test connection button shows status indicator

#### Scenario: User adds a new relay

**Given** Options Page Relays tab is active  
**When** user enters "wss://relay.example.com" in input field  
**And** clicks "Add Relay" button  
**Then** relay is added to list  
**And** relay persists to chrome.storage.sync  
**And** input field is cleared

#### Scenario: User adds invalid relay URL

**Given** Options Page Relays tab is active  
**When** user enters "http://relay.example.com" (not wss://)  
**And** clicks "Add Relay" button  
**Then** error message displays "Relay URL must start with wss://"  
**And** relay is not added to list

---

### Requirement: Advanced Tab

The Options Page SHALL provide an Advanced tab for power-user settings and debug information.

**Acceptance Criteria:**

- Tab includes: Medium Trust Kind Toggles, Debug Info Panel
- Medium kinds toggle list matches existing functionality
- Debug panel shows in development mode only
- Raw settings JSON viewer available in debug panel

#### Scenario: User toggles medium trust kind

**Given** Options Page Advanced tab is active  
**And** Kind 7 (Reaction) is enabled for medium trust  
**When** user toggles Kind 7 switch to OFF  
**Then** Kind 7 is removed from mediumAllowKinds array  
**And** medium trust origins will prompt for Kind 7 events

---

### Requirement: Auto-Save Feedback

The Options Page SHALL provide clear feedback that settings changes are automatically saved without requiring manual save action.

**Acceptance Criteria:**

- Footer displays "Changes are saved automatically" message
- Settings mutations show brief success indicator (optional)
- No "Save" or "Apply" button required
- Reset All button requires confirmation

#### Scenario: User sees auto-save confirmation

**Given** Options Page is open  
**When** user changes any setting  
**Then** footer shows "Changes are saved automatically"  
**And** no manual save action is required  
**And** change persists immediately to storage

---

### Requirement: Settings Sync via Nostr

The extension SHALL provide opt-in settings synchronization across devices using NIP-78 (Arbitrary Custom App Data) events published to Nostr relays.

**Acceptance Criteria:**

- Sync is opt-in via toggle in General tab
- Only non-sensitive settings are syncable (theme, auto-lock, relays, etc.)
- Sensitive fields NEVER synced (keys, passwords, origins, selectedKeyId)
- Settings published as kind 30078 events with `d` tag "ostrilo-settings-v1"
- Fetch and publish operations timeout after 5 seconds
- Last-write-wins conflict resolution with timestamp
- Sync status displayed in UI (last synced, errors)

#### Scenario: User enables settings sync

**Given** Options Page General tab is active  
**And** user has extension installed on Device A  
**When** user toggles "Sync settings across devices" to ON  
**Then** current non-sensitive settings are published to Nostr relays  
**And** kind 30078 event is created with user's pubkey  
**And** sync status shows "Last synced: [timestamp]"  
**And** info alert explains what is synced

#### Scenario: Settings sync across devices

**Given** user enabled sync on Device A  
**And** user changed theme to "dark" on Device A  
**When** user opens extension on Device B  
**And** Device B fetches settings from relays  
**Then** theme is set to "dark" on Device B  
**And** other syncable settings match Device A  
**And** selectedKeyId remains device-specific  
**And** origins policies remain device-specific

#### Scenario: Sync excludes sensitive data

**Given** user has origins configured with policies  
**And** user has multiple keys with one selected  
**When** user publishes settings to Nostr  
**Then** NIP-78 event content does NOT include `selectedKeyId`  
**And** event content does NOT include `origins` array  
**And** event content ONLY includes safe fields  
**And** published content can be publicly read without privacy risk

#### Scenario: Sync fetch timeout

**Given** settings sync is enabled  
**And** configured relays are unreachable  
**When** user clicks "Sync Now" button  
**And** relay query takes longer than 5 seconds  
**Then** fetch operation times out  
**And** error message displays "Sync timeout - check relay connection"  
**And** local settings remain unchanged  
**And** user can retry sync manually

#### Scenario: Manual sync trigger

**Given** settings sync is enabled  
**When** user clicks "Sync Now" button in General tab  
**Then** "Syncing..." status is displayed  
**And** current settings are published to relays  
**And** remote settings are fetched and merged  
**And** UI updates to show "Last synced: just now"  
**And** sync button re-enables after completion

---

### Requirement: Settings Sync Service Architecture

The extension SHALL implement settings synchronization following hexagonal architecture with SettingsSyncService in the application layer.

**Acceptance Criteria:**

- SettingsSyncService created in `src/application/services/`
- Service accepts StorageSuite, IRelayAdapter, ICryptoAdapter via constructor
- filterSyncableSettings() method returns only safe fields
- publishSettings() creates and publishes NIP-78 event
- fetchSettings() queries relays for user's settings event
- mergeRemoteSettings() applies fetched settings with conflict resolution
- All relay operations use IRelayAdapter port interface

#### Scenario: Service publishes syncable settings only

**Given** user has full AppSettingsV1 in storage  
**And** settings include selectedKeyId and origins  
**When** SettingsSyncService.publishSettings() is called  
**Then** filterSyncableSettings() extracts only safe fields  
**And** returned SyncableSettings excludes selectedKeyId  
**And** returned SyncableSettings excludes origins  
**And** returned SyncableSettings includes theme, autoLockMinutes, relays  
**And** NIP-78 event content is JSON.stringify(syncableSettings)

#### Scenario: Service uses dependency injection

**Given** SettingsSyncService is instantiated  
**When** background script creates the service  
**Then** StorageSuite is injected (chrome.storage adapter)  
**And** IRelayAdapter is injected (SimpleRelayAdapter)  
**And** ICryptoAdapter is injected (NobleCryptoAdapter)  
**And** no concrete dependencies hardcoded in service

---

## MODIFIED Requirements

### Requirement: Settings View Component

**Modified Behavior:** The SettingsView component SHALL be replaced by BasicSettings for popup usage while its sections are extracted into reusable components for the Options Page.

**Acceptance Criteria:**

- SettingsView.tsx is deprecated or removed
- BasicSettings.tsx created for popup with minimal settings
- Tab components created for Options Page using extracted shared components
- All existing settings functionality preserved
- Existing E2E tests updated to use new components

#### Scenario: Popup uses BasicSettings instead of SettingsView

**Given** extension popup is open  
**When** user navigates to Settings view  
**Then** BasicSettings component is rendered (not SettingsView)  
**And** only basic settings are shown  
**And** "Advanced Settings" button is available

### Requirement: General Settings Tab (Modified)

**Modified Behavior:** The General Settings Tab SHALL include sync controls in addition to display preferences.

**Acceptance Criteria:**

- Tab includes: Theme Selector, Side Panel Toggle, Settings Sync Section
- Sync section has: Enable toggle, Sync Now button, Last synced timestamp
- Sync section shows info alert explaining what is synced
- All settings auto-save on change

#### Scenario: General tab shows sync status

**Given** Options Page General tab is active  
**And** settings sync is enabled  
**When** tab renders  
**Then** sync toggle is ON  
**And** "Last synced" timestamp is displayed  
**And** "Sync Now" button is visible  
**And** info alert explains sync scope

---

## REMOVED Requirements

None. This change is additive and refactors existing code without removing functionality.

# Implementation Tasks: Add Options Page UI

## 2026-06-11 Review Status

The core UI work in Phases 1-7 is implemented on `main`. Remaining development for this change should be limited to hardening, tests, documentation, cleanup, and validation in Phases 8-10.

Phase 11 is explicitly deferred. Cross-device settings sync via NIP-78 needs a separate OpenSpec proposal because it introduces relay/network behavior, public Nostr events, signing semantics, and privacy/security review beyond the options page UI.

## Phase 1: Extract Shared Components ✅

- [x] **1.1** Create shared components directory structure

  - Create `src/ui/features/settings/components/shared/` directory
  - Move component extraction target files to this location
  - **Validation:** Directory exists, ready for component extraction

- [x] **1.2** Extract KeySelectorCard component

  - Extract active key display from SettingsView
  - Accept props: `keys`, `selectedKey`, `onSelectKey`
  - Include avatar, name, pubkey display
  - **Validation:** Component renders correctly in isolation, accepts props

- [x] **1.3** Extract ThemeSelector component

  - Extract theme dropdown logic from SettingsView
  - Accept props: `value`, `onChange`
  - Use shadcn/ui Select component
  - **Validation:** Component changes theme when value changes

- [x] **1.4** Extract AutoLockSlider component

  - Extract auto-lock slider from SettingsView Security section
  - Accept props: `value`, `onChange`, `min`, `max`, `step`
  - Display current value with units ("5 min", "Never")
  - **Validation:** Slider updates on drag, calls onChange

- [x] **1.5** Extract SessionTTLSlider component

  - Extract session TTL slider from SettingsView Security section
  - Accept props: `value`, `onChange`
  - Display "Until lock" for 0 value
  - **Validation:** Component renders and updates correctly

- [x] **1.6** Extract RelayList component

  - Extract relay management UI from SettingsView
  - Accept props: `relays`, `onAdd`, `onRemove`
  - Include add relay input with validation
  - **Validation:** Can add/remove relays, validates wss:// URLs

- [x] **1.7** Extract ActivityLogConfig component

  - Extract activity log settings section
  - Accept props: `maxEntries`, `onChange`, `onClear`, `onExport`
  - Include slider and action buttons
  - **Validation:** All actions work correctly

- [x] **1.8** Extract OriginPolicyTable component

  - Extract per-origin policy table from SettingsView
  - Accept props: `origins`, `onUpdateTrust`, `onRemove`, `onToggleSession`
  - Build table with sortable columns
  - **Validation:** Table displays, actions work correctly

- [x] **1.9** Extract MediumKindToggles component
  - Extract medium trust kind toggles section
  - Accept props: `mediumAllowKinds`, `onToggle`
  - Map over COMMON_EVENT_KINDS
  - **Validation:** Toggles update mediumAllowKinds array

## Phase 2: Create Options Page Entrypoint ✅

- [x] **2.1** Create options page directory structure

  - Create `src/extension/options/` directory
  - Add `index.html`, `main.tsx`, `OptionsApp.tsx`, `style.css`
  - **Validation:** Files created, WXT detects options entrypoint

- [x] **2.2** Configure WXT manifest for options page

  - Update `wxt.config.ts` manifest
  - Add `options_ui: { page: "options.html", open_in_tab: true }`
  - **Validation:** `npm run build` includes options.html in output

- [x] **2.3** Create options page HTML entrypoint

  - Create `src/extension/options/index.html`
  - Include React root div, script tag for main.tsx
  - Match popup HTML structure
  - **Validation:** HTML validates, loads correctly

- [x] **2.4** Create options page React root

  - Create `src/extension/options/main.tsx`
  - Set up React rendering to #root
  - Import OptionsApp component
  - Include ThemeProvider wrapper
  - **Validation:** Options page renders React app

- [x] **2.5** Create OptionsApp skeleton component
  - Create `src/extension/options/OptionsApp.tsx`
  - Add header with logo and version
  - Add empty tab navigation (Tabs component)
  - Add footer with auto-save message
  - **Validation:** Options page loads, shows header/footer

## Phase 3: Build Tab Components ✅

- [x] **3.1** Create GeneralSettingsTab component

  - Create `src/ui/features/settings/components/GeneralSettingsTab.tsx`
  - Use ThemeSelector and SidePanelToggle components
  - Group settings by category with headings
  - **Validation:** Tab renders, theme and side panel settings work

- [x] **3.2** Create KeysIdentitiesTab component

  - Create `src/ui/features/settings/components/KeysIdentitiesTab.tsx`
  - Use KeySelectorCard in list layout
  - Add rename, delete, set active actions
  - Include import/export buttons (disabled for now)
  - **Validation:** Multi-key management works, active key updates

- [x] **3.3** Create SecuritySettingsTab component

  - Create `src/ui/features/settings/components/SecuritySettingsTab.tsx`
  - Use AutoLockSlider and SessionTTLSlider
  - Add biometric toggle (conditional rendering)
  - Add action buttons: Change Password, Export Key, Clear Sessions
  - **Validation:** Security settings update correctly

- [x] **3.4** Create PermissionsTab component

  - Create `src/ui/features/settings/components/PermissionsTab.tsx`
  - Use OriginPolicyTable component
  - Add trust level dropdowns per origin
  - Add remove origin confirmation dialogs
  - **Validation:** Origin policies update, removals work

- [x] **3.5** Create ActivityLogTab component

  - Create `src/ui/features/settings/components/ActivityLogTab.tsx`
  - Use ActivityLogConfig component
  - Add activity log preview (last 10 entries)
  - **Validation:** Log config updates, clear/export work

- [x] **3.6** Create RelaysTab component

  - Create `src/ui/features/settings/components/RelaysTab.tsx`
  - Use RelayList component
  - Add relay status indicators (future)
  - **Validation:** Relay management works correctly

- [x] **3.7** Create AdvancedTab component
  - Create `src/ui/features/settings/components/AdvancedTab.tsx`
  - Use MediumKindToggles component
  - Add debug info panel (dev mode only)
  - Add raw settings JSON viewer
  - **Validation:** Advanced settings accessible, debug info displays

## Phase 4: Integrate Tabs into OptionsApp ✅

- [x] **4.1** Add tab navigation to OptionsApp

  - Import all tab components
  - Add Tabs, TabsList, TabsTrigger components
  - Define tabs: General, Keys, Security, Permissions, Activity, Relays, Advanced
  - **Validation:** All tabs render, navigation works

- [x] **4.2** Implement tab content rendering

  - Add TabsContent for each tab
  - Lazy render inactive tabs for performance
  - **Validation:** Only active tab content is rendered

- [x] **4.3** Add URL hash navigation

  - Read window.location.hash on mount
  - Set active tab based on hash
  - Update hash when tab changes
  - **Validation:** URL hash reflects active tab, deep links work

- [x] **4.4** Add keyboard tab navigation

  - Handle arrow key events for tab navigation
  - Focus management when switching tabs
  - **Validation:** Left/Right arrow keys navigate tabs

- [x] **4.5** Add footer with reset and export actions
  - Add "Reset All Settings" button with confirmation
  - Add "Export Settings" button (download JSON)
  - Show "Changes are saved automatically" message
  - **Validation:** Footer actions work correctly

## Phase 5: Create BasicSettings for Popup ✅

- [x] **5.1** Create BasicSettings component

  - Create `src/ui/features/settings/components/BasicSettings.tsx`
  - Use KeySelectorCard, ThemeSelector, AutoLockSlider
  - Add "Advanced Settings" button
  - **Validation:** Component renders in popup, fits within dimensions

- [x] **5.2** Implement openOptionsPage action

  - Import `browser` from wxt/browser
  - Add click handler: `browser.runtime.openOptionsPage()`
  - **Validation:** Button opens options page in new tab

- [x] **5.3** Replace SettingsView with BasicSettings in popup

  - Update `src/ui/components/layout/MainApp.tsx`
  - Replace `<SettingsView />` with `<BasicSettings />`
  - **Validation:** Popup shows BasicSettings, no errors

- [x] **5.4** Update popup navigation to use BasicSettings
  - Verify popup routing still works
  - Test navigation between Home, Profile, Activity, Settings
  - **Validation:** All popup views accessible, settings show BasicSettings

## Phase 6: Cross-Context Settings Sync ✅

- [x] **6.1** Add storage.onChanged listener to OptionsApp

  - Listen for chrome.storage.sync changes
  - Update local state when appSettings changes
  - **Validation:** Options page updates when popup changes settings
  - **Implementation:** Added useEffect with chrome.storage.onChanged in OptionsApp.tsx

- [x] **6.2** Add storage.onChanged listener to BasicSettings

  - Same listener logic as OptionsApp
  - Ensure useAppSettings hook handles updates
  - **Validation:** Popup updates when options page changes settings
  - **Implementation:** Added useEffect with chrome.storage.onChanged and forceUpdate in BasicSettings.tsx

- [ ] **6.3** Test bi-directional sync

  - Open both popup and options page
  - Change theme in popup, verify options page updates
  - Change auto-lock in options, verify popup updates
  - **Validation:** Both contexts sync within 100ms
  - **Status:** Manual testing required

- [ ] **6.4** Test concurrent mutation handling
  - Rapidly change settings in both contexts
  - Verify no race conditions or stale state
  - **Validation:** Last write wins, no data corruption
  - **Status:** Manual testing required

**Additional Enhancement:**

- [x] **6.5** Replace SidePanelToggle with OpenInSelector dropdown

  - Created new `OpenInSelector` component with Select dropdown
  - Options: "Popup" | "Side Panel"
  - Maintains backward compatibility with isDocked boolean storage
  - Updated GeneralSettingsTab and SettingsView to use new component
  - **Validation:** Dropdown renders, changes persist, side panel behavior works

- [x] **6.6** Add "Add Key" functionality to Keys & Identities tab

  - Added "Add Key" button to KeysIdentitiesTab header
  - Implemented Dialog with three modes: choice, create, import
  - Integrated CreateKeyForm and ImportKeyForm components
  - Added state management for dialog flow
  - **Validation:** Users can create new keys or import existing keys from options page

- [x] **6.7** Fix key list refresh after adding keys

  - Updated CreateKeyForm to use KeyManagerContext.generateKey instead of RPC direct call
  - Updated ImportKeyForm to use KeyManagerContext.importKey instead of RPC direct call
  - KeyManagerContext methods automatically call refreshKeys() after success
  - **Validation:** New keys appear immediately in list after creation/import

- [x] **6.8** Fix page flicker on settings changes
  - Removed window.location.reload() from OptionsApp storage listener
  - Removed manual storage listeners from BasicSettings
  - useWxtStorage hook already handles cross-context sync via global storage listener
  - Components re-render automatically when storage values change
  - **Validation:** Settings changes (especially sliders) work smoothly without page reload

## Phase 7: Styling and Responsive Design ✅

- [x] **7.1** Add options page specific styles

  - Create `src/extension/options/style.css`
  - Add container max-width constraints
  - Add tab content padding and spacing
  - **Validation:** Options page looks polished

- [x] **7.2** Implement responsive breakpoints

  - Test at 1280x720, 1920x1080, 2560x1440
  - Ensure tabs don't overflow horizontally
  - Ensure content is readable at all sizes
  - **Validation:** No layout breaks at common resolutions

- [x] **7.3** Add loading states

  - Show spinner while settings load
  - Disable inputs while mutations in progress
  - **Validation:** Loading states display correctly

- [x] **7.4** Add empty states
  - Show message when no origins configured
  - Show message when no relays added
  - **Validation:** Empty states are helpful and clear

## Phase 8: Testing

- [ ] **8.1** Write unit tests for shared components

  - Test KeySelectorCard renders with props
  - Test ThemeSelector calls onChange
  - Test AutoLockSlider value formatting
  - **Validation:** All component tests pass

- [ ] **8.2** Write unit tests for tab components

  - Test each tab renders without errors
  - Test tab uses shared components correctly
  - **Validation:** Tab component tests pass

- [ ] **8.3** Write integration test for options page

  - Test OptionsApp renders all tabs
  - Test tab navigation works
  - Test settings mutations persist
  - **Validation:** Integration tests pass

- [ ] **8.4** Write E2E test for options page workflow

  - Test: Open options page from popup
  - Test: Navigate through all tabs
  - Test: Change settings in each tab
  - Test: Verify settings persist across reload
  - **Validation:** E2E test passes in Playwright

- [ ] **8.5** Write E2E test for cross-context sync
  - Test: Open both popup and options
  - Test: Change setting in popup
  - Test: Verify options page updates
  - Test: Change setting in options
  - Test: Verify popup updates
  - **Validation:** Sync E2E test passes

## Phase 9: Documentation and Polish

- [ ] **9.1** Update user-facing documentation

  - Document options page in README
  - Add screenshots of options page tabs
  - Explain basic vs advanced settings split
  - **Validation:** Docs are clear and accurate

- [ ] **9.2** Add inline help text to options page

  - Add tooltips for complex settings
  - Add help icons with explanations
  - **Validation:** Users understand each setting's purpose

- [ ] **9.3** Update CHANGELOG

  - Document new options page feature
  - Document BasicSettings refactor
  - Note migration from SettingsView
  - **Validation:** CHANGELOG entry is complete

- [ ] **9.4** Final accessibility audit
  - Test keyboard navigation through all tabs
  - Test screen reader announces tab changes
  - Test focus management
  - Verify ARIA labels on all controls
  - **Validation:** WCAG AA compliance

## Phase 10: Cleanup and Deployment

- [ ] **10.1** Remove or deprecate SettingsView.tsx

  - If fully replaced, delete SettingsView.tsx
  - If kept for backward compat, add deprecation notice
  - **Validation:** No references to old SettingsView remain

- [ ] **10.2** Run full test suite

  - Unit: `pnpm run test:unit`
  - Integration: `pnpm run test:integration`
  - E2E: `pnpm run test:e2e`
  - **Validation:** All tests pass, no regressions

- [ ] **10.3** Build for all browsers

  - Chrome: `pnpm run build`
  - Firefox: `pnpm run build:firefox`
  - Load extensions and manually test
  - **Validation:** Options page works in both browsers

- [ ] **10.4** Performance validation

  - Measure options page load time (< 500ms target)
  - Measure tab switch time (< 100ms target)
  - Measure sync latency (< 100ms target)
  - **Validation:** Performance targets met

- [ ] **10.5** Code review and cleanup
  - Remove console.log statements
  - Remove TODO comments
  - Run linter: `npx eslint .`
  - Run formatter: `npx prettier --write .`
  - **Validation:** Code is clean, production-ready

## Phase 11: Deferred Future Proposal - Settings Sync Implementation

Do not implement Phase 11 under `add-options-page-ui`. These tasks are retained as seed material for a separate change proposal.

- **11.1 (future)** Define SyncableSettings domain type

  - Create `SyncableSettings` interface in `src/domain/types.ts`
  - Include only non-sensitive fields (theme, autoLock, relays, etc.)
  - Add JSDoc explaining sync safety
  - **Validation:** Type compiles, clearly documents included fields

- **11.2 (future)** Define IRelayAdapter port interface

  - Create `src/application/ports/relay.ts`
  - Define `IRelayAdapter` interface with publish/query methods
  - Define `RelayOptions` type for timeout configuration
  - **Validation:** Interface follows hexagonal port conventions

- **11.3 (future)** Create SimpleRelayAdapter infrastructure

  - Create `src/infrastructure/relay/simple-relay-adapter.ts`
  - Implement IRelayAdapter using nostr-tools SimplePool
  - Add publish() with timeout handling
  - Add query() with timeout and event collection
  - **Validation:** Adapter implements interface, handles timeouts

- **11.4 (future)** Create SettingsSyncService

  - Create `src/application/services/settings-sync.service.ts`
  - Accept StorageSuite, IRelayAdapter, ICryptoAdapter in constructor
  - Implement filterSyncableSettings() with strict allowlist
  - **Validation:** Service follows hexagonal architecture

- **11.5 (future)** Implement publishSettings method

  - Create NIP-78 event (kind 30078) in publishSettings()
  - Set tags: `["d", "ostrilo-settings-v1"]`, `["t", "ostrilo"]`
  - Stringify syncable settings as content
  - Sign event using ICryptoAdapter
  - Publish to relays with 5-second timeout
  - **Validation:** Event published successfully, has correct format

- **11.6 (future)** Implement fetchSettings method

  - Query relays for kind 30078 with user's pubkey
  - Filter by `#d` tag "ostrilo-settings-v1"
  - Return latest event by created_at timestamp
  - Parse content JSON into SyncableSettings
  - **Validation:** Fetches latest settings, handles no results

- **11.7 (future)** Implement mergeRemoteSettings method

  - Load local AppSettingsV1 from storage
  - Spread remote syncable settings over local
  - Preserve local-only fields (selectedKeyId, origins)
  - Save merged settings to storage
  - **Validation:** Merge preserves local-only data

- **11.8 (future)** Add SettingsSyncState to domain types

  - Create `SettingsSyncState` interface
  - Include: enabled, lastSyncedAt, syncInProgress, syncError
  - Store in chrome.storage.local
  - **Validation:** Type compiles, used in service and UI

- **11.9 (future)** Wire SettingsSyncService into background

  - Import and instantiate SettingsSyncService in background.ts
  - Pass existing storage, new relay adapter, crypto adapter
  - Add RPC handlers for: sync.enable, sync.disable, sync.now
  - **Validation:** Service available in background context

- **11.10 (future)** Create useSettingsSync hook

  - Create `src/ui/hooks/useSettingsSync.ts`
  - Load sync state from storage
  - Implement enableSync, disableSync, syncNow methods
  - Send RPC messages to background service
  - **Validation:** Hook updates state, calls background

- **11.11 (future)** Add sync UI to GeneralSettingsTab

  - Add "Settings Sync" section to General tab
  - Add enable/disable toggle with description
  - Add "Sync Now" button (disabled when syncing)
  - Show last synced timestamp
  - Show sync error if present
  - Add info alert explaining what is synced
  - **Validation:** Sync UI renders, controls work

- **11.12 (future)** Implement automatic sync on enable

  - When user enables sync, trigger immediate publish
  - Fetch remote settings and merge if found
  - Update lastSyncedAt timestamp
  - Handle errors gracefully
  - **Validation:** Enabling sync publishes and fetches

- **11.13 (future)** Add sync exclusion validation

  - Unit test: filterSyncableSettings excludes selectedKeyId
  - Unit test: filterSyncableSettings excludes origins
  - Unit test: NIP-78 content never contains sensitive data
  - Security test: published event can be publicly read safely
  - **Validation:** All exclusion tests pass

- **11.14 (future)** Write E2E test for cross-device sync

  - Test: Enable sync on Device A (simulated)
  - Test: Change theme on Device A
  - Test: Publish settings to mock relay
  - Test: Fetch settings on Device B (simulated)
  - Test: Verify theme synced, selectedKeyId not synced
  - **Validation:** Cross-device sync E2E test passes

- **11.15 (future)** Add sync error handling

  - Handle relay timeout gracefully
  - Handle invalid event format
  - Handle network errors
  - Display user-friendly error messages
  - Allow retry after error
  - **Validation:** All error scenarios handled

- **11.16 (future)** Document sync security boundaries
  - Update README with sync feature explanation
  - Document which fields are synced vs local-only
  - Explain NIP-78 event format
  - Add privacy considerations
  - **Validation:** Docs clearly explain sync scope

---

## Estimated Effort

- **Phase 1:** Component Extraction (6-8 hours)
- **Phase 2:** Options Entrypoint (2-3 hours)
- **Phase 3:** Tab Components (8-10 hours)
- **Phase 4:** Integration (3-4 hours)
- **Phase 5:** BasicSettings (2-3 hours)
- **Phase 6:** Cross-Context Sync (3-4 hours)
- **Phase 7:** Styling (3-4 hours)
- **Phase 8:** Testing (6-8 hours)
- **Phase 9:** Documentation (2-3 hours)
- **Phase 10:** Cleanup (2-3 hours)
- **Phase 11:** Deferred to a future proposal

**Active remaining scope:** Phase 8-10 hardening, documentation, cleanup, and validation.

## Dependencies

- WXT entrypoint system understanding
- Shadcn/ui Tabs component
- chrome.runtime.openOptionsPage() API
- chrome.storage.onChanged event API
- Hexagonal architecture port/adapter pattern

## Rollout Strategy

1. **Internal Testing:** Deploy to dev environment, test all tabs and local cross-context settings updates
2. **Beta Release:** Publish to small user group, gather feedback on UX
3. **Monitor Feedback:** Track issues with navigation, sync, performance
4. **Gradual Rollout:** Increase user base over 1 week
5. **Full Release:** Publish to all users after stability confirmed

## Success Criteria

- ✅ All tests pass (unit, integration, E2E)
- ✅ Options page loads within 500ms
- ✅ Local settings updates propagate within 100ms between popup and options contexts
- ✅ No layout breaks at desktop resolutions
- ✅ All existing settings functionality preserved
- ✅ BasicSettings fits in popup without scrolling
- ✅ Extension builds for Chrome and Firefox
- ✅ Zero regressions in existing workflows
- ✅ Extension functions fully without sync enabled

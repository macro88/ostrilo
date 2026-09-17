## MODIFIED Requirements

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

### Requirement: Security Settings Tab

The Options Page SHALL provide a Security tab for authentication and session management. The auto-lock timeout offered by this tab SHALL be an enforced inactivity timeout within the accepted range, SHALL NOT offer a never-lock option, and SHALL require password re-authentication before a change is stored.

**Acceptance Criteria:**

- Tab includes Auto-lock Slider and Session TTL Slider
- Sliders show current value with units
- Security actions expose clear labels and preserve existing settings behavior
- Auto-lock slider offers whole minutes from `1` to `60` and no never-lock option
- Session TTL slider offers `0` to `60`, where `0` is labeled as lasting until the vault locks
- Changing the auto-lock or session grant timeout requires password re-authentication
- Tab explains that the auto-lock timeout is measured from the last recorded activity

#### Scenario: User configures auto-lock timeout

- **GIVEN** Options Page Security tab is active
- **AND** the vault is unlocked
- **WHEN** user changes auto-lock timeout and re-enters the correct password
- **THEN** slider value updates
- **AND** setting is saved to extension storage
- **AND** the inactivity deadline is recomputed from the new timeout

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

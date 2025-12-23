# ui-theme Specification

## Purpose
TBD - created by archiving change add-theme-auto-switching. Update Purpose after archive.
## Requirements
### Requirement: Effective Theme Resolution

The extension SHALL resolve an effective theme (`light` or `dark`) from the stored theme setting.

#### Scenario: Explicit light theme
- **GIVEN** the user setting `theme` is `light`
- **WHEN** the UI determines the effective theme
- **THEN** the effective theme SHALL be `light`

#### Scenario: Explicit dark theme
- **GIVEN** the user setting `theme` is `dark`
- **WHEN** the UI determines the effective theme
- **THEN** the effective theme SHALL be `dark`

#### Scenario: System theme prefers dark
- **GIVEN** the user setting `theme` is `system`
- **AND** the system/browser preference indicates `prefers-color-scheme: dark`
- **WHEN** the UI determines the effective theme
- **THEN** the effective theme SHALL be `dark`

#### Scenario: System theme prefers light
- **GIVEN** the user setting `theme` is `system`
- **AND** the system/browser preference indicates NOT `prefers-color-scheme: dark`
- **WHEN** the UI determines the effective theme
- **THEN** the effective theme SHALL be `light`

---

### Requirement: Theme Application via DOM Class

The extension SHALL apply the effective theme to the UI by toggling the `dark` class on the page root element.

#### Scenario: Dark theme applied
- **GIVEN** the effective theme is `dark`
- **WHEN** the theme is applied
- **THEN** the page root element (`document.documentElement`) SHALL contain the `dark` class

#### Scenario: Light theme applied
- **GIVEN** the effective theme is `light`
- **WHEN** the theme is applied
- **THEN** the page root element (`document.documentElement`) SHALL NOT contain the `dark` class

#### Scenario: Idempotent application
- **GIVEN** the theme is already correctly applied
- **WHEN** the theme application runs again
- **THEN** no duplicate classes SHALL be introduced
- **AND** the resulting applied theme SHALL remain correct

---

### Requirement: Live Updates in System Mode

When `theme` is `system`, the extension SHALL update the applied theme when the system/browser color-scheme preference changes.

#### Scenario: System switches from light to dark
- **GIVEN** the user setting `theme` is `system`
- **AND** the UI is currently applying `light`
- **WHEN** the system/browser preference changes to `prefers-color-scheme: dark`
- **THEN** the UI SHALL update to apply `dark` without requiring a reload

#### Scenario: System switches from dark to light
- **GIVEN** the user setting `theme` is `system`
- **AND** the UI is currently applying `dark`
- **WHEN** the system/browser preference changes to NOT `prefers-color-scheme: dark`
- **THEN** the UI SHALL update to apply `light` without requiring a reload

---

### Requirement: User Override via Settings

The extension SHALL allow users to override system theme behavior via the Settings page.

#### Scenario: User selects explicit theme
- **GIVEN** the Settings page theme selector is visible
- **WHEN** the user selects `Light` or `Dark`
- **THEN** the selection SHALL be persisted to settings
- **AND** the UI SHALL update to the selected theme immediately

#### Scenario: User selects System
- **GIVEN** the Settings page theme selector is visible
- **WHEN** the user selects `System`
- **THEN** the selection SHALL be persisted to settings
- **AND** the UI SHALL follow system/browser color-scheme preference

---

### Requirement: Consistent Behavior Across Extension UIs

The extension SHALL apply the same effective theme behavior across all extension UI surfaces.

#### Scenario: Popup uses the same theme behavior
- **GIVEN** the user has selected a theme setting
- **WHEN** the popup UI renders
- **THEN** it SHALL apply the effective theme using the same rules

#### Scenario: Side panel uses the same theme behavior
- **GIVEN** the user has selected a theme setting
- **WHEN** the side panel UI renders
- **THEN** it SHALL apply the effective theme using the same rules

#### Scenario: Approval window uses the same theme behavior
- **GIVEN** the user has selected a theme setting
- **WHEN** the approval window UI renders
- **THEN** it SHALL apply the effective theme using the same rules


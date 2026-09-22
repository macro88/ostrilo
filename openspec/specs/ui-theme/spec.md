# ui-theme Specification

## Purpose

Defines how Ostrilo resolves an effective theme from the user's `theme` setting
and the system colour-scheme preference, and how that theme is applied to each
extension UI surface.

This spec covers theme *resolution mechanics* only: which of `light` or `dark`
applies, and how it reaches the DOM. What those two themes look like — the token
values, and the fact that the dark variant is the "Deep Ink" role reassignment
rather than an inversion of the light one — is `docs/design/DESIGN_RULES.md` §3.
The two do not overlap: nothing here names a colour.

Implemented by `src/ui/lib/theme.ts` (`resolveEffectiveTheme`,
`getSystemPrefersDark`, `applyThemeToDOM`) and `src/ui/hooks/useTheme.ts`, which
each surface mounts once. The `dark` class is what
`src/assets/tailwind.css` keys its dark variant on
(`@custom-variant dark (&:is(.dark *))`).

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

The extension SHALL allow users to override system theme behavior via a theme
selector. The selector appears both in the popup's Settings tab and on the
options page's General tab; either one writes the same setting.

#### Scenario: User selects explicit theme
- **GIVEN** a theme selector is visible
- **WHEN** the user selects `Light` or `Dark`
- **THEN** the selection SHALL be persisted to settings
- **AND** every open extension surface SHALL update to the selected theme, not only the one the change was made on

#### Scenario: User selects System
- **GIVEN** a theme selector is visible
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

#### Scenario: Options page uses the same theme behavior
- **GIVEN** the user has selected a theme setting
- **WHEN** the options (settings) page UI renders
- **THEN** it SHALL apply the effective theme using the same rules


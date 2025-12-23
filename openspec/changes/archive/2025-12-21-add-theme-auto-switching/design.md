# Design: Automatic Theme Switching

## Goals
- Keep implementation minimal and centralized.
- Make theme behavior consistent across all extension UI contexts (popup/sidepanel/approval).
- Use existing Tailwind/shadcn theming primitives (no new tokens).

## Current State
- Tailwind dark mode is enabled via a `dark` class (`@custom-variant dark (&:is(.dark *));`).
- Settings includes `AppSettingsV1.theme: 'light' | 'dark' | 'system'` and the Settings page already exposes a selector.
- No code currently applies the chosen theme to the DOM (no `.dark` class toggling; no `prefers-color-scheme` wiring).

## Proposed Architecture
### Effective Theme Resolution
Define a pure function:
- Input: `settingsTheme: Theme`, `systemPrefersDark: boolean`
- Output: `effectiveTheme: 'light' | 'dark'`

Rules:
- If `settingsTheme` is `light` or `dark`, return it.
- If `settingsTheme` is `system`, return `systemPrefersDark ? 'dark' : 'light'`.
- If settings are missing/invalid, default to `system` behavior.

### DOM Application
Define an imperative utility:
- Apply `dark` class to `document.documentElement` when `effectiveTheme === 'dark'`.
- Remove `dark` class otherwise.

This matches the existing Tailwind setup and requires no CSS changes.

### Runtime Updates
Introduce a small UI-layer component/hook (e.g., `ThemeApplier`) mounted once per extension page:
- Subscribes to settings via existing `useAppSettings()`.
- Resolves effective theme and applies it.
- If `settings.theme === 'system'`, subscribes to `matchMedia('(prefers-color-scheme: dark)')` changes and reapplies.
- Cleans up the media query listener on unmount and when leaving `system` mode.

### Where It Runs
Each extension UI surface has its own document, so theme must be applied per-surface:
- Popup root
- Side panel root
- Approval window root

Mount `ThemeApplier` at the top of each root React tree (near `KeyManagerProvider` / `MainApp`, and near `ApprovalApp`).

## Non-Goals / Explicit Exclusions
- No new settings fields.
- No extra pages or UI affordances beyond using the existing theme selector.
- No attempt to synchronize theme into content scripts or web pages.

## Testing Strategy
- Unit test the pure resolution function.
- Unit/integration test that applying a theme toggles the `dark` class on `document.documentElement`.
- Optional: Playwright E2E that switches theme in Settings and asserts the DOM has `.dark`.

## Open Questions (need confirmation)
1. Should `System` update live when the OS theme changes while the popup is open? (This proposal assumes **yes**.) YES
2. Should the `dark` class be applied to `<html>` (`document.documentElement`) or `<body>`? (This proposal assumes `<html>` for maximum consistency.) HTML

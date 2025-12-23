# Proposal: Add Automatic Theme Switching

## Change ID
`add-theme-auto-switching`

## Status
🔄 **Proposal** - Awaiting approval

## Overview
Add automatic theme application for the extension UI based on the user’s `theme` setting (`light` | `dark` | `system`). When `system` is selected, the UI follows the OS/browser color-scheme preference and updates live if the system preference changes. Users can override system behavior from the existing Settings page theme selector.

## Problem Statement
Ostrilo already stores a theme preference (`AppSettingsV1.theme`) and the Settings page exposes a Theme selector, but there is currently no implementation that applies an effective theme to the UI (e.g., toggling the `.dark` class that Tailwind’s dark variant relies on). As a result:
- Selecting `Light`/`Dark` does not reliably change the UI theme.
- `System` does not actually track `prefers-color-scheme`.
- UI requirements that assume a “dark theme enabled” state are difficult to validate consistently.

## Proposed Solution
Implement a small, centralized “theme controller” for the extension UI that:

1. **Resolves the effective theme**
   - If `settings.theme` is `light` or `dark`, that value is the effective theme.
   - If `settings.theme` is `system`, effective theme is derived from `matchMedia('(prefers-color-scheme: dark)')`.

2. **Applies the effective theme to the DOM**
   - Add/remove the `dark` class on the page root (`document.documentElement`) so Tailwind’s `@custom-variant dark (&:is(.dark *));` activates.

3. **Updates automatically**
   - React to changes in Settings (theme selector updates).
   - When `settings.theme === 'system'`, listen for system color-scheme changes and update live.

4. **Works in all extension UI surfaces**
   - Popup
   - Side panel
   - Approval window

## Scope
**In Scope**
- Theme resolution for `light | dark | system`
- DOM class toggling (`.dark`) to drive Tailwind theme tokens
- Live updates on system preference changes when in `system` mode
- Wiring the behavior into popup/sidepanel/approval UI roots

**Out of Scope**
- Adding new theme palettes, custom colors, or new design tokens
- Adding new UI controls (the Settings theme selector already exists)
- Per-origin/per-site theming
- Animations/transitions beyond what already exists

## Dependencies / Assumptions
- `AppSettingsV1.theme` remains the single source of truth.
- Tailwind dark mode is driven by a `dark` class on an ancestor element.
- Extension pages can access `matchMedia` and `prefers-color-scheme`.

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Flash of incorrect theme during initial load | Low | Apply default (`system`) immediately; update once settings load |
| Multiple extension surfaces diverge | Medium | Centralize logic and mount it in each page root |
| System preference change listeners leak | Low | Ensure listeners are registered only in `system` mode and cleaned up on unmount |

## Success Criteria
- [ ] Switching theme in Settings immediately changes the UI appearance.
- [ ] When theme is set to `System`, the UI follows OS/browser color-scheme preference.
- [ ] Changing OS theme while Ostrilo is open updates the UI without reload (in `System` mode).
- [ ] Behavior is consistent in popup, side panel, and approval window.

## Related Work
- Existing settings and UI: `AppSettingsV1.theme` and Settings Theme selector.
- Existing theming assumptions in specs (e.g., “Given the user has dark theme enabled”).

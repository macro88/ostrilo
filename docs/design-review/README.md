# Ostrilo Inkline Completion Report

Date: 2026-06-11

## Scope

Implemented the Inkline redesign from `docs/design-handoff/` across the extension UI:

- Onboarding: welcome, create choice, create key, backup
- Popup and side panel: home, profile, profile edit, activity, quick settings
- Dialogs: add key, create key, import key, QR modal
- Options page: general, keys, security, permissions, activity log, relays, advanced
- Approval window: empty state, grouped queue, event detail
- Lock screen

`src/ui/features/settings/components/SettingsView.tsx` remains an unmounted legacy component. The active popup settings surface is `BasicSettings`; the active full settings surface is `src/extension/options/OptionsApp.tsx`.

## What Changed

- Replaced the Arcade Plush token layer with Inkline tokens in `src/assets/tailwind.css`.
- Added `docs/design/DESIGN_RULES.md` as the canonical design-system source.
- Added repo guidance in `AGENTS.md` and `.github/copilot-instructions.md` to prevent old gradients, accent rails, dot grids, Plush classes, and candy palette choices from returning.
- Marked `docs/ostrilo_arcade_plush_brand_kit_v_1.md` as superseded.
- Updated shared primitives: button, badge, input, select, slider, tabs, dialog, dropdown, avatar, public-key display, QR modal, empty state, and a new `SealMark`.
- Split logo behavior so popup/header chrome uses the static mascot image, while the 3D model is opt-in for hero moments with a static poster fallback.
- Migrated rendered surfaces from Plush cards/chips/bubbles to Inkline cards, hairline rows, seal chips, notched primary actions, and terse security copy.
- Reworked approval detail around the handoff structure: origin summary, signing facts, content payload, raw JSON toggle, trust line, pinned Deny and Approve & sign actions.
- Updated the screenshot runner selectors for the new home and approval headings.

## Verification

- `pnpm run compile` passed.
- `pnpm run build` passed.
- `node docs/design-review/capture-screenshots.mjs` passed with Chromium launch escalation, capturing all 22 screenshots.
- The screenshot runner created a real key through onboarding and generated a real pending approval from a local test dapp, so approval queue/detail screenshots are runtime captures rather than static mock screenshots.

Build notes: WXT/Vite still emit existing deprecation, dynamic-import, and chunk-size warnings. They did not fail the build.

Font note: `@fontsource-variable/archivo` and `@fontsource/jetbrains-mono` were not installed locally, and network/package fetches were not available in the sandbox. The CSS now prefers Archivo and JetBrains Mono with system fallbacks; the dependency install remains the only deferred handoff item.

## Screenshots

### Onboarding

![Onboarding welcome](screenshots/01-onboarding-welcome.png)

![Onboarding create choice](screenshots/02-onboarding-create-choice.png)

![Onboarding create key](screenshots/03-onboarding-create-key.png)

![Onboarding backup](screenshots/04-onboarding-backup.png)

### Popup And Side Panel

![Popup home](screenshots/05-popup-home.png)

![Side panel home](screenshots/06-sidepanel-home.png)

![Popup profile](screenshots/07-popup-profile.png)

![Popup profile edit](screenshots/08-popup-profile-edit.png)

![Popup activity](screenshots/09-popup-activity.png)

![Popup quick settings](screenshots/10-popup-quick-settings.png)

![Add key dialog](screenshots/11-add-key-dialog.png)

### Options

![Options general](screenshots/12-options-general.png)

![Options keys](screenshots/13-options-keys.png)

![Options security](screenshots/14-options-security.png)

![Options permissions](screenshots/15-options-permissions.png)

![Options activity log](screenshots/16-options-activity-log.png)

![Options relays](screenshots/17-options-relays.png)

![Options advanced](screenshots/18-options-advanced.png)

### Approval

![Approval empty](screenshots/19-approval-empty.png)

![Approval queue](screenshots/20-approval-queue.png)

![Approval detail](screenshots/21-approval-detail.png)

### Locked

![Lock screen](screenshots/22-lock-screen.png)

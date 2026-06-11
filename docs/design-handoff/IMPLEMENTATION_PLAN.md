# Inkline Implementation Plan

Migration of the Ostrilo extension UI from "Arcade Plush" to **Inkline**.
Reference mocks: `Ostrilo Inkline.html` (design project). Rules: `DESIGN_RULES.md`. Tokens: `inkline.css`.

The codebase is already well-factored for this: shared tokens live in `src/assets/tailwind.css`, primitives in `src/ui/components/ui/*`, and every surface imports both. Most of the migration is **tokens + primitives**, then a sweep of feature components.

---

## Phase 0 — Assets & fonts (½ day)

1. `pnpm add @fontsource-variable/archivo @fontsource/jetbrains-mono`
2. Import them in each entrypoint's CSS chain (popup, sidepanel, options, approval, onboarding) — wherever `tailwind.css` is imported today. Remove Baloo 2 / Inter imports.
3. The 3D logo (`src/ui/components/logo/ModelViewer.tsx`) **stays** — it's a distinctive product touch — but is scoped to hero moments only (see `DESIGN_RULES.md` §9): onboarding welcome, lock screen, options/about. Header chrome and all popup critical-path renders use the static low-poly image. Wrap ModelViewer so it (a) renders the static PNG as an instant poster while the model lazy-loads — no "Loading…" overlay possible, (b) only animates on hover/drag or a slow idle drift, (c) freezes under `prefers-reduced-motion`.
4. Re-export extension icons 16/32/48/128 from the existing mascot (unchanged).

## Phase 1 — Tokens (½ day, mostly copy-paste)

Replace the token + component layers of `src/assets/tailwind.css` with `inkline.css` (it preserves all shadcn variable names — `--background`, `--primary`, `--border` etc. — so Tailwind utilities like `bg-card text-muted-foreground` keep working with new values).

Key semantic changes to be aware of:
- `--radius` 1rem → 0.5rem (everything sharpens automatically)
- `--primary` becomes ink (light) / violet (dark) — any component assuming pink primary needs review
- `--plush-*` variables are gone → grep for `plush` and replace with `--ink-*` equivalents
- New utilities: `.notch`, `.notch-sm`, `.seal`, `.btn-ink`, `.btn-ghost`, `.btn-danger`, `.ink-card`, `.ink-row`, `.seal-chip*`
- Kept (redefined): `.app-canvas` (now flat), `.screen-shell`, `.screen-header/title/description` (now plain type, no card/rail), `.code-panel`
- **Deleted**: `.btn-plush`, `.icon-bubble`, `.stamp-chip`, `.metric-card`, `.plush-card`, `.plush-card-compact`, `.status-success/warning/danger` (→ `.seal-chip-*`)

Compile will surface every usage of a deleted class — that's the worklist for Phases 2–3.

## Phase 2 — Primitives (`src/ui/components/ui/*`, 1–2 days)

| File | Change |
|---|---|
| `button.tsx` | `default` variant → `.btn-ink` styling (solid ink + notch); `outline/secondary` → `.btn-ghost`; `destructive` → `.btn-danger` (ghost, red text — never solid red) |
| `badge.tsx` | variants → `.seal-chip-*`; mono uppercase 10px |
| `input.tsx`, `password-input.tsx` | radius 8, `--input` border; focus = violet border + 3px soft ring |
| `select.tsx` | radius 8; in-row variant renders value + chevron only |
| `slider.tsx` | thumb → 16px `.seal` hexagon, violet fill track |
| `switch.tsx` | checked = violet (stays rounded) |
| `tabs.tsx` | active tab = violet-soft plate with notch-sm |
| `dialog.tsx` | radius 12, `--elev-overlay`, backdrop `rgb(42 34 56 / .35)` |
| `dropdown-menu.tsx` | radius 10, hairline, overlay shadow |
| `avatar.tsx` | add `shape="seal"` (hexagon) — identity avatars use it |
| `separator.tsx` | hairline `--border` |
| `common/pubkey.tsx` | mono, middle-truncate, copy affordance (mostly exists) |
| `common/EmptyState.tsx` | quiet: small mascot or seal mark, 13px text, no tinted bubble |

Add one new primitive: `SealMark` (hexagon + icon, sizes 11–24) used by activity rows, chips, step dots — see `directions/inkline.jsx → LSeal` in the design project for the exact geometry.

## Phase 3 — Surfaces (2–4 days, in this order)

1. **Popup home + layout chrome** (`layout/Header.tsx`, `navigation/BottomTabs.tsx`, `features/home/*`) — header w/ unlocked seal-chip, identity block, 3-up stat strip, activity rows. Highest visibility, exercises every primitive.
2. **Approval window** (`features/approval/*`) — queue grouped by origin, kind chips, countdowns, detail layout, pinned Deny/Approve. The signature moment; match the mock closely (§8 of rules).
3. **Onboarding + lock** (`features/onboarding/*`, `features/authentication/*`) — 3 steps + faceted step dots, blurred-nsec backup panel, lock screen with seal lock-badge.
4. **Quick settings + profile + dialogs** (`features/settings/BasicSettings`, `features/profile/*`, `dialogs/*`).
5. **Options page** (`src/extension/options/OptionsApp.tsx`) — move 7 top tabs → left sidebar nav (mock: `inkline-options.jsx`). Keep tab state/routing; it's a layout change.
6. Delete `features/settings/components/SettingsView.tsx` (confirmed unmounted legacy) rather than restyling it.

## Phase 4 — Dark mode (1 day)

`inkline.css` ships the Deep Ink `.dark` block. Verify per surface with the theme toggle: primary buttons flip to violet w/ dark text, code panels go near-black (`#120E1B`), seal-chip soft fills use the dark variants. The mascot PNG's dark facets sit on `#171320` fine, but check the lock screen treatment.

## Phase 5 — Copy sweep (½ day)

Grep for retired voice: "stamp", "plush", "Press Sign to play", "Let's make your first", emoji in string literals under `src/ui` + `src/extension`. Replace per §10 of `DESIGN_RULES.md`. Update `docs/ostrilo-onboarding-requirements.md` examples if they pin old copy.

## Phase 6 — Verify & lock in (½ day)

1. `pnpm compile && pnpm build`
2. Re-run `docs/design-review/capture-screenshots.mjs`; replace screenshots in `docs/design-review/`; note the redesign in its README.
3. PR checklist from `DESIGN_RULES.md` §12.
4. Docs:
   - Commit `DESIGN_RULES.md` → `docs/design/DESIGN_RULES.md`
   - Mark `docs/ostrilo_arcade_plush_brand_kit_v_1.md` as superseded (header note linking to the new rules)
   - Add to `AGENTS.md` / `.github/copilot-instructions.md`: *"All UI work must follow `docs/design/DESIGN_RULES.md`. Do not reintroduce gradients, accent rails, or dot-grid backgrounds."*

---

## Estimated total: ~6–9 dev days

| Phase | Effort |
|---|---|
| 0 Assets & fonts | 0.5d |
| 1 Tokens | 0.5d |
| 2 Primitives | 1–2d |
| 3 Surfaces | 2–4d |
| 4 Dark mode | 1d |
| 5 Copy | 0.5d |
| 6 Verify | 0.5d |

Phases 0–2 land as one PR (app looks ~80% migrated already since utilities re-resolve);
each surface in Phase 3 is its own reviewable PR with before/after screenshots.

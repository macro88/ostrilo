# Ostrilo — Inkline Design Rules

> **Audience: any agent or human touching Ostrilo UI.** These rules are binding.
> Canonical mocks: design project "Ostrilo UI Redesign" → `Ostrilo Inkline.html`.
> Canonical tokens: `src/assets/tailwind.css` (source: `inkline.css` from the same project).
> If a rule here conflicts with older notes or archived design artifacts, **this file wins**. The Arcade Plush kit is retired.

---

## 1. Identity in one paragraph

Ostrilo is a **local Nostr signer**. The mascot is a **low-poly, geometric purple ostrich** — sharp, calm, a little wry. The UI takes its cues from the mascot, not from candy: ink-purple text on quiet near-white surfaces, hairline borders, a single violet accent, and **one angular signature** (the notched corner and faceted hexagon) used sparingly. It should read like a serious security tool that happens to have a personality — never like a toy, and never like AI-generated dashboard filler.

## 2. Principles

1. **Calm by default, sharp where it counts.** 95% of any screen is quiet: white cards, hairline borders, ink text. The angular DNA (notch, seal) appears only at decision points and identity moments.
2. **The payload is the product.** Signing requests must show exactly what is being signed. Mono type for anything cryptographic (npub, nsec, kinds, timestamps, JSON). Never hide data behind decoration.
3. **One accent budget.** Violet is the only accent. If violet appears more than ~3 times on a screen, remove some.
4. **Mint means go — and nothing else means go.** Success/active/approve states use mint. No other green, and mint is never decorative.
5. **Hairlines over shadows.** Borders define structure. Drop shadows are reserved for true overlays (dialogs, dropdowns).

## 3. Tokens

Defined in `src/assets/tailwind.css`. Never hard-code hex values in components; use the CSS variables / Tailwind utilities.

| Role | Light | Dark ("Deep Ink") |
|---|---|---|
| Background | `#F7F6FA` | `#171320` |
| Card / surface | `#FFFFFF` | `#201A2E` |
| Text primary (`--ink`) | `#2A2238` | `#EDEAF6` |
| Text secondary (`--ink-2`) | `#6C6483` | `#9C92B8` |
| Text tertiary (`--ink-3`) | `#867E9E` | `#857BA6` |
| Border hairline | `#E7E4EE` | `#332B49` |
| Border strong / inputs | `#D9D5E3` | `#3D3456` |
| Accent (`--ink-violet`) | `#5F50A0` | `#A78FFF` |
| Accent soft | `#EFECF7` | `#3A2F5E` |
| Success (`--ink-mint`) | `#1E7A63` | `#6FD9BC` |
| Warning (`--ink-amber`) | `#7A5320` | `#E8B36A` |
| Danger (`--ink-red`) | `#B3434E` | `#F2728C` |
| Dialog backdrop (`--overlay`) | `rgb(42 34 56 / 0.55)` | `rgb(0 0 0 / 0.72)` |

**Dark mode is not an inversion** — it is the "Deep Ink" variant: primary buttons become violet (`--primary` flips from ink to violet), surfaces come from the mascot's darkest facets, and mono carries even more of the hierarchy.

## 4. Type

- **Archivo** (variable) for everything: display and body. Weights: 500 body, 600 emphasis, 700 headings/buttons. Headings get `letter-spacing: -0.01em`.
- **JetBrains Mono** for all data: npub/nsec, event kinds, timestamps in lists, countdowns, JSON, version numbers.
- Baloo 2 and Inter are **removed**. Do not reintroduce them.
- Scale (popup surfaces): title 17–20 / section label 11 uppercase +0.08em / body 13 / secondary 11.5–12.5 / mono data 10.5–12. Options page may run one step larger.
- Section labels use `.section-label` (11px, bold, uppercase, +0.08em, `--ink-2`). Use the class; do not hand-roll the utilities. They **replace** card headers — a section label sitting *under* a card header is the bug, not the fix.
- Fonts are **bundled** (`@fontsource-variable/archivo`, `@fontsource/jetbrains-mono`). Never load fonts from a CDN — MV3 CSP.

## 5. Shape language

The angular signature comes in exactly two shapes:

- **Notch** (`.notch`, 9px cut corner): the **primary CTA only** — at most one notched button per screen ("Approve & sign", "Continue", "Add key"). Also `notch-sm` (5px) on status chips and tiny tag plates. Never on cards, inputs, dialogs, or secondary buttons.
- **Seal** (`.seal`, faceted hexagon): avatars, status marks in activity lists, slider thumbs, step indicators, the lock badge. The seal *is* the "stamp" metaphor now — a hexagonal mark, not a left border.

Everything else: `--radius` 8px (inputs, buttons, chips' container cards), `--radius-row` 10px (grouped list cards), 12px (dialogs). No pills except genuinely round things (dots, toggle tracks, avatars that aren't seals).

⚠️ `clip-path` swallows focus outlines — notched/sealed interactive elements must draw focus **inside** (`outline-offset: -3px`; already handled by `.notch`/`.btn-ink`).

⚠️ `.notch`, `.notch-sm`, `.seal` and `.ink-card` are declared with `@utility` in `tailwind.css`, **not** `@layer components`. Tailwind's variant engine cannot see a component-layer class, so a variant form compiles to nothing — silently, with no build error. Both variant uses in the tree depend on this: `data-[state=active]:notch-sm` (`src/ui/components/ui/tabs.tsx`) and `@min-[420px]:ink-card` (`src/ui/features/home/components/HomeView.tsx`). That is how the options nav's active notch shipped unrendered. Declare every new shape or surface class with `@utility`, and confirm a variant form actually paints before you rely on it.

## 6. Banned patterns (the de-slop list)

These were removed in the redesign. **Do not reintroduce any of them:**

1. ❌ Gradient fills on buttons or any control (`linear-gradient` candy-pink → lavender is gone; `btn-plush` is deleted).
2. ❌ Left/inline-start border accent rails on cards (`border-inline-start: 0.45rem solid …`).
3. ❌ Dot-grid / polka-dot / diagonal-wash backgrounds (`app-canvas` is now a flat color).
4. ❌ Icon-in-tinted-rounded-square decorations on every card title (`icon-bubble`). Icons appear inline at text size, in `--ink-2` or violet, only when they add meaning.
5. ❌ Four-up "metric card" grids of trivia. Stats are quiet list rows or a single 3-up strip.
6. ❌ Pill (999px) buttons.
7. ❌ Emoji in UI copy (user content may contain them; chrome may not).
8. ❌ Pink. The candy palette is retired everywhere, including illustrations.
9. ❌ Solid-red danger buttons. Danger = red text on hairline ghost (`.btn-danger`) + a confirm step.

## 7. Components (canonical specs)

- **Primary button** `.btn-ink` — solid ink (violet in dark), white text, 700, notched. Hover brightens, active nudges 1px. When paired with a ghost: ghost `flex:1`, primary `flex:2`. Disabled is a solid `--input` plate with `--ink-2` text — no translucency, no hover brightening, `cursor: not-allowed`. Disabled reads as *not yet*, never as broken.
- **Secondary** `.btn-ghost` — white, hairline `--input` border, radius 8.
- **Cards** `.ink-card` — white, 1px `--border`, radius 10, **no shadow**. Settings/data use grouped rows (`.ink-row`) divided by hairlines inside one card, not separate cards per field.
- **Status chips** `.seal-chip` + variant — soft fill, no border, 10px bold uppercase, notch-sm. (ACTIVE, TRUSTED, FIRST VISIT, DENIED…)
- **Activity rows** — seal mark (mint check / red ×) + what happened (bold 13) + origin below (11.5 `--ink-2`) + mono timestamp right.
- **npub display** — always mono, always middle-truncated (`npub18fs7wwr…le5z`), always with a copy affordance.
- **Inputs** — white, 1px `--input` border, radius 8, 13px. Focus: violet border + 3px `--ink-violet-soft` ring (`box-shadow`), not a default outline.
- **Selects** — borderless value + chevron right-aligned inside a row, or input-style when standalone.
- **Slider** — 4px track, violet fill, **seal-shaped thumb** (16px hexagon).
- **Switch** — standard track/thumb; checked = violet. Radius is fine here (it's a round thing).
- **Bottom nav** — 4 items; active = `--ink-violet-soft` plate (notch-sm) + violet icon/label; inactive `--ink-2` (labels are information, so never `--ink-3`; see §11).
- **Dialogs** — radius 12, `--elev-overlay` shadow, backdrop `--overlay` (ink wash at 0.55 light / 0.72 Deep Ink). The backdrop must suppress the page behind it: nothing underneath may out-contrast the dialog. The only place shadows are allowed (plus dropdowns/toasts).
- **Warnings** — soft amber panel (`--ink-amber-soft` bg, amber text, radius 10) with a seal icon. No border, no rail.
- **Code/JSON panels** `.code-panel` — mono 11–12, hairline border. In approval contexts label the panel (EVENT · size) and offer "View raw JSON".
- **Step indicators** `OnboardingStepDots` — faceted dots; the active step stretches to an 18px bar. Steps already passed keep the accent, so the row reads as progress rather than as scattered marks.
- **Settings tabs** `SettingsLayout` — `SettingsTabHeader` (title, at most one sentence, the tab's single primary action), then `SettingsSection` labels over grouped `.ink-card`s of `SettingsRow`s. Build a new tab from these, not from fresh markup.
- **Empty states** — two idioms, not interchangeable. A whole surface empties to a centred `SealMark` (`tone="muted"`, `size="lg"`) or `MascotSeal`, a bold title, and one 13px line. A list inside a card empties to a single quiet line in the card, no mark. Either way: say what will fill the surface, never restate the heading, and give the surface one message — an empty activity card is not the place to advertise an unrelated action.

## 8. The approval surface (signature moment)

- Queue groups requests **by origin**; each row: `kind:N` mono chip (violet-soft, notch-sm) + human label + 1-line preview + mono countdown (amber).
- Unknown origins get a red `FIRST VISIT` chip. Known-trusted get mint `TRUSTED`.
- Detail screen: origin block → facts rows (signing as / kind / created) → content panel → "View raw JSON" → actions pinned at bottom.
- Actions: ghost **Deny** (1fr) + notched ink **Approve & sign** (2fr). Optional "Don't ask again…" checkbox below.
- Always include the trust line: *"Keys never leave your browser."*
- Countdowns are always mono, always amber.

## 9. Mascot rules

- Asset: the low-poly ostrich head (`public/icon.png` / SVG). Never redraw, recolor, skew, or "cutify" it.
- **Hero** (≥72px): onboarding welcome, lock screen, success/empty states — at most one hero per flow. Always the static image: there is no 3D or animated mascot, and a WebGL library may not be loaded into any extension page (`openspec/specs/key-material-isolation/`).
- **Mark** (24–28px): header chrome, next to the wordmark — always the static image.
- The lock screen may compose a small ink seal-badge (with lock glyph) over the mascot's corner.
- Minimum size 16px; don't place it on dark backgrounds without checking contrast of the dark facets.

## 10. Voice

Friendly but adult. Short declaratives. Honest about security; never cute about it.

- ✅ "Your keys stay in this browser." / "Keep it offline. Anyone with this key controls your identity." / "Requests expire automatically after 60 seconds."
- ❌ "Press Sign to play!", "No stamps yet!", "Let's make your first!", emoji, exclamation marks in security contexts.
- Buttons are verbs: "Approve & sign", "Deny", "Create key", "Reveal key", "Fetch latest".
- Errors say what happened and what to do next — no blame, no jokes.

## 11. Motion & a11y

- Durations 120–160ms, `--ease-out` (`cubic-bezier(.2,.8,.2,1)`). Fade+4px-rise on dialog entry; 1px press on primary. **No bounce, no shimmer, no confetti, no infinite loops.**
- Respect `prefers-reduced-motion` (already wired in the stylesheet).
- Text contrast ≥ 4.5:1 for anything the user must read. Every §3 text token passes on its intended surface (card, soft fill, or background) except `--ink-3`, which is held to ≥ 3:1 and is for placeholders and decorative marks only — never for information. Verify if you mix pairs. `tests/e2e/accessibility.spec.ts` runs axe over every surface in both themes and fails on a serious violation; it is what caught `--ink-2` on `--muted` and `--ink-red` on its own soft fill, and the light values above were darkened to pass.
- Hit targets ≥ 44px on popup surfaces (rows already are).
- Visible focus everywhere; remember the clip-path rule (§5).

## 12. PR checklist

- [ ] No banned pattern (§6) introduced
- [ ] Exactly one notched primary CTA per screen, max
- [ ] All cryptographic data in JetBrains Mono with copy affordance
- [ ] Colors via tokens only; no new hex values
- [ ] Works in light AND dark (Deep Ink)
- [ ] Focus visible on every interactive element, incl. notched ones
- [ ] Copy follows §10 voice; no emoji in chrome
- [ ] Screenshot runner re-run if surfaces changed (`docs/design-review/capture-screenshots.mjs`)
- [ ] Both themes captured — the dark pass is a second invocation (`OSTRILO_DESIGN_REVIEW_THEME=dark`); Deep Ink cannot be inferred from the light shot (§3)
- [ ] Judged on a **populated** vault, not a fresh one — the runner's second phase seeds keys, activity, relays and a queue. A home-card clipping bug survived a full review because an empty vault never showed three activity rows.

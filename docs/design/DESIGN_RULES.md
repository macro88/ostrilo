# Ostrilo — Inkline Design Rules

> **Audience: any agent or human touching Ostrilo UI.** These rules are binding.
> Canonical mocks: design project "Ostrilo UI Redesign" → `Ostrilo Inkline.html`.
> Canonical tokens: `src/assets/tailwind.css` (source: `inkline.css` from the same project).
> If a rule here conflicts with older docs (`ostrilo_arcade_plush_brand_kit_v_1.md`, `UI_REVIEW.md`), **this file wins**. The Arcade Plush kit is retired.

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
| Text secondary (`--ink-2`) | `#736B89` | `#9C92B8` |
| Text tertiary (`--ink-3`) | `#A39CB6` | `#6E6589` |
| Border hairline | `#E7E4EE` | `#332B49` |
| Border strong / inputs | `#D9D5E3` | `#3D3456` |
| Accent (`--ink-violet`) | `#5F50A0` | `#A78FFF` |
| Accent soft | `#EFECF7` | `#3A2F5E` |
| Success (`--ink-mint`) | `#2E9B7F` | `#6FD9BC` |
| Warning (`--ink-amber`) | `#94682E` | `#E8B36A` |
| Danger (`--ink-red`) | `#BD4A55` | `#F2728C` |

**Dark mode is not an inversion** — it is the "Deep Ink" variant: primary buttons become violet (`--primary` flips from ink to violet), surfaces come from the mascot's darkest facets, and mono carries even more of the hierarchy.

## 4. Type

- **Archivo** (variable) for everything: display and body. Weights: 500 body, 600 emphasis, 700 headings/buttons. Headings get `letter-spacing: -0.01em`.
- **JetBrains Mono** for all data: npub/nsec, event kinds, timestamps in lists, countdowns, JSON, version numbers.
- Baloo 2 and Inter are **removed**. Do not reintroduce them.
- Scale (popup surfaces): title 17–20 / section label 11 uppercase +0.08em / body 13 / secondary 11.5–12.5 / mono data 10.5–12. Options page may run one step larger.
- Section labels are 11px, bold, uppercase, tracked, `--ink-2`. They replace card headers in most cases.
- Fonts are **bundled** (`@fontsource-variable/archivo`, `@fontsource/jetbrains-mono`). Never load fonts from a CDN — MV3 CSP.

## 5. Shape language

The angular signature comes in exactly two shapes:

- **Notch** (`.notch`, 9px cut corner): the **primary CTA only** — at most one notched button per screen ("Approve & sign", "Continue", "Add key"). Also `notch-sm` (5px) on status chips and tiny tag plates. Never on cards, inputs, dialogs, or secondary buttons.
- **Seal** (`.seal`, faceted hexagon): avatars, status marks in activity lists, slider thumbs, step indicators, the lock badge. The seal *is* the "stamp" metaphor now — a hexagonal mark, not a left border.

Everything else: `--radius` 8px (inputs, buttons, chips' container cards), `--radius-row` 10px (grouped list cards), 12px (dialogs). No pills except genuinely round things (dots, toggle tracks, avatars that aren't seals).

⚠️ `clip-path` swallows focus outlines — notched/sealed interactive elements must draw focus **inside** (`outline-offset: -3px`; already handled by `.notch`/`.btn-ink`).

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

- **Primary button** `.btn-ink` — solid ink (violet in dark), white text, 700, notched. Hover brightens, active nudges 1px. When paired with a ghost: ghost `flex:1`, primary `flex:2`.
- **Secondary** `.btn-ghost` — white, hairline `--input` border, radius 8.
- **Cards** `.ink-card` — white, 1px `--border`, radius 10, **no shadow**. Settings/data use grouped rows (`.ink-row`) divided by hairlines inside one card, not separate cards per field.
- **Status chips** `.seal-chip` + variant — soft fill, no border, 10px bold uppercase, notch-sm. (ACTIVE, TRUSTED, FIRST VISIT, DENIED…)
- **Activity rows** — seal mark (mint check / red ×) + what happened (bold 13) + origin below (11.5 `--ink-2`) + mono timestamp right.
- **npub display** — always mono, always middle-truncated (`npub18fs7wwr…le5z`), always with a copy affordance.
- **Inputs** — white, 1px `--input` border, radius 8, 13px. Focus: violet border + 3px `--ink-violet-soft` ring (`box-shadow`), not a default outline.
- **Selects** — borderless value + chevron right-aligned inside a row, or input-style when standalone.
- **Slider** — 4px track, violet fill, **seal-shaped thumb** (16px hexagon).
- **Switch** — standard track/thumb; checked = violet. Radius is fine here (it's a round thing).
- **Bottom nav** — 4 items; active = `--ink-violet-soft` plate (notch-sm) + violet icon/label; inactive `--ink-3`.
- **Dialogs** — radius 12, `--elev-overlay` shadow, backdrop `rgb(42 34 56 / 0.35)`. The only place shadows are allowed (plus dropdowns/toasts).
- **Warnings** — soft amber panel (`--ink-amber-soft` bg, amber text, radius 10) with a seal icon. No border, no rail.
- **Code/JSON panels** `.code-panel` — mono 11–12, hairline border. In approval contexts label the panel (EVENT · size) and offer "View raw JSON".
- **Step indicators** — faceted dots; the active step stretches to an 18px bar.

## 8. The approval surface (signature moment)

- Queue groups requests **by origin**; each row: `kind:N` mono chip (violet-soft, notch-sm) + human label + 1-line preview + mono countdown (amber).
- Unknown origins get a red `FIRST VISIT` chip. Known-trusted get mint `TRUSTED`.
- Detail screen: origin block → facts rows (signing as / kind / created) → content panel → "View raw JSON" → actions pinned at bottom.
- Actions: ghost **Deny** (1fr) + notched ink **Approve & sign** (2fr). Optional "Don't ask again…" checkbox below.
- Always include the trust line: *"Keys never leave your browser."*
- Countdowns are always mono, always amber.

## 9. Mascot rules

- Asset: the low-poly ostrich head (`public/icon.png` / SVG). Never redraw, recolor, skew, or "cutify" it.
- **Hero** (≥72px): onboarding welcome, lock screen, success/empty states — at most one hero per flow. Hero moments may use the **3D model** (ModelViewer): static image as instant poster while it loads, motion only on interaction or slow idle drift, frozen under `prefers-reduced-motion`. The 3D model never appears in header chrome or popup critical paths — a 3D render at 28px costs WebGL startup for shading nobody can see.
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
- Text contrast ≥ 4.5:1 (every token pair above passes on its intended surface; verify if you mix).
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

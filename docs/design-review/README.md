# Ostrilo Inkline Design Review

Date: 2026-09-16 (review), 2026-09-17 (polish round)
Rubric: [`docs/design/DESIGN_RULES.md`](../design/DESIGN_RULES.md) §6 (banned patterns) and §12 (PR checklist)
Build reviewed: production (`.output/chrome-mv3`), per the AGENTS.md rule that UI is judged on the production build, never the agent build.

The screenshots behind this review (and the auto-lock review below) were reviewed visually at the time of capture. They are not vendored in this repository — reproduce them locally with the commands below.

## Scope

All 23 fresh-vault surfaces plus 13 populated-state surfaces were captured in **both themes** — 36 screenshots per theme, 72 total.

The previous review (2026-06-11) covered light only. DESIGN_RULES §12 requires every
surface to hold up in light *and* dark, and §3 is explicit that Deep Ink is not an
inversion but a role reassignment, so it cannot be inferred from the light capture.
This is the first review where the dark half of the rubric is backed by evidence.

## How to reproduce

```bash
pnpm run build
node docs/design-review/capture-screenshots.mjs
OSTRILO_DESIGN_REVIEW_THEME=dark node docs/design-review/capture-screenshots.mjs
```

Two invocations rather than one two-pass run: the runner drives onboarding from an
empty vault, and that only happens once per browser profile.

## Runner defects found and fixed

The runner had rotted since June and was reporting a misleading picture. Three fixes
landed in `capture-screenshots.mjs` as part of this review:

1. **The run died at the backup step.** Finish is now gated on backup verification
   rather than the acknowledgement checkbox (`OnboardingCreateKeyBackupStep`), so the
   old `check(); click Finish` sequence timed out on a permanently disabled button.
   The runner now answers the suffix challenge the way
   `tests/e2e/onboarding-create.spec.ts` does, reading the length off the input's
   `maxlength` rather than restating `VERIFICATION_SUFFIX_LENGTH`.

2. **The approval captures were silently absent.** `aa5c706` tightened the content
   script to `https://*/*`; the runner served the test dapp over plain HTTP, so
   `window.nostr` was never injected and no approval was ever enqueued. The runner now
   serves TLS using the same throwaway certificate helper as the e2e fixtures
   (`tests/e2e/fixtures/make-dev-cert.ts`).

3. **The signature moment was photographed in a state no user acts on.** Approve is
   deliberately disabled for `APPROVE_COOLDOWN_MS` (500ms) while the pane binds to a
   request; the runner screenshotted at 250ms, so every archived review showed the
   product's most important button greyed out. It now waits past the cooldown.

A fourth capture gap is worth naming because it is not fully fixable: the approval
detail pane scrolls internally, and a `fullPage` screenshot stops at the viewport. At
the real 400x600 popup size the content panel, the raw-JSON toggle and the trust line
all sit below the fold. A second shot (`21b-approval-payload`) now opens "View raw JSON" and scrolls the
envelope into view (the content panel itself sits above the fold since the polish round), and
a new `04b-onboarding-backup-revealed` covers the revealed backup card and verification
challenge — a surface added since June that had never been reviewed. **No capture
contains an nsec**; the key is re-masked before every screenshot.

## Populated state

Everything above photographs a brand-new vault. A second phase in the runner
unlocks that vault and seeds what real use looks like: the key renamed to a
long name, a second key, a cached profile (published against a dead relay so
nothing leaves the machine), three relays, three sites at low, medium and high
trust, signed and denied activity from `nostrich.org` and `snort.social`
(both resolved to the fixture server with `--host-resolver-rules`), and a
two-site approval queue. These captures exist because a layout bug (home cards
shrinking and clipping their rows once three activity entries existed) was
invisible in the empty-vault set.

## Status: the findings below were fixed

Every finding in this review was closed by the polish round of 2026-09-17, which
also rebuilt each surface against Phantom 26.30.1 as an external bar. The
findings are kept as written so the record shows what was wrong and why; the
short notes under each say how it was closed. The captures behind this review
were the post-polish ones.

### How the polish round worked

Five pieces (popup shell and home, lock and onboarding, approval, profile and
activity and quick settings, options) were rebuilt in isolated worktrees. After
each round every surface was photographed in both themes and put beside the same
moment in Phantom, labels stripped and sides randomised, for a reviewer who was
told nothing about which product was which. A piece was finished when the blind
comparison chose Ostrilo on every pair.

Result: lock and onboarding 10/10, options 22/22, approval 14/14, profile and
activity and settings 16/16. The popup shell finished at 6/10, holding the
populated home, the populated side panel and the key switcher in both themes;
its two fresh-vault home screens are the one place the loop was stopped on
judgment rather than a win, because the comparison asked repeatedly for a
prominent first-run action and a signer that already holds a key has no honest
one to offer.

## Findings

### 1. Three token pairs fail WCAG AA, and §11 asserts that none do — §11

**Closed.** Light amber 4.26:1 → 5.90:1, light mint 3.44:1 → 5.22:1. `--ink-3` was raised in both themes and §11 was rewritten to state what the tokens actually guarantee: `--ink-3` is held to ≥3:1 and is for placeholders and decorative marks only, never information.

§11 states "every token pair above passes on its intended surface". Computed from the
§3 table:

| Pair | Ratio | AA (4.5:1) |
|---|---|---|
| Light: `--ink-amber` on `--ink-amber-soft` | 4.26:1 | **fail** |
| Light: `--ink-mint` on card | 3.44:1 | **fail** |
| Light: `--ink-3` on card | 2.63:1 | **fail** |
| Dark: `--ink-3` on card | 3.11:1 | **fail** |
| All other pairs in §3 | 4.91-9.87:1 | pass |

The amber failure is the one that matters. It is the body copy of *"There is no
recovery"* on the backup step (`04b-onboarding-backup-revealed`) — the most
safety-critical warning in the product, and the place a user is least able to afford
missing a word. The mint failure undercuts §4 ("mint means go"): the go signal is the
weakest text on light surfaces. Either darken the light amber and mint ramps, or amend
§11 to stop claiming a guarantee the tokens do not provide.

### 2. A decorative icon plate on every section title — §6 #4, §5

**Closed.** The plates are gone from every settings tab and from the profile, activity and quick-settings surfaces; sections are introduced by `.section-label` instead.

`<div className="seal inline-flex ... bg-secondary h-8 w-8">` wrapping a purely
decorative icon appears **14 times across 14 files**, on essentially every settings
tab, activity and profile section.

§6 #4 retired exactly this: "Icon-in-tinted-rounded-square decorations on every card
title. Icons appear inline at text size, in `--ink-2` or violet, only when they add
meaning." The shape moved from a rounded square to a seal, but the pattern is the
decoration, not the corner radius. §5 also scopes the seal to avatars, status marks,
slider thumbs, step indicators and the lock badge — a section-header plate is not in
that list, and spending the shape language on chrome is what §2 warns against.

Visible in `12-options-general` ("Display"), `13-options-keys` ("Your Keys"), and every
other options tab.

### 3. Section labels are not section labels — §4

**Closed.** `.section-label` (11px bold uppercase tracked) was added to the stylesheet and now carries every section heading, replacing card headers rather than sitting beneath them.

§4: "Section labels are 11px, bold, uppercase, tracked, `--ink-2`. They replace card
headers in most cases." Nine occurrences of `<h3 className="font-medium">` render as
default-size, medium-weight sentence case instead — and they sit *below* a card header
rather than replacing one, so `12-options-general` carries "General Settings" + a
description + "Display" for two controls.

### 4. Mint used decoratively on an unfinished step — §4

**Closed.** The mint seal is gone from the backup step; mint now appears there only once the backup is verified.

`04b-onboarding-backup-revealed` opens with a mint `CheckCircle` seal above "Backup
Your Key". §4 is explicit that mint means go "and nothing else", and is "never
decorative". Here it reads as done at the moment nothing has been done yet, on the one
screen where a premature sense of completion is most costly.

## What holds up

Worth recording, because most of the redesign is intact:

- **§6 banned patterns are otherwise clean.** No `linear-gradient`, no
  `border-inline-start` rails, no dot-grid or `radial-gradient`, no `icon-bubble`, no
  `btn-plush`, no Baloo/Inter, no pink. Every `rounded-full` is a genuinely round thing
  (switch track, slider track, progress bar, non-seal avatar) — no pill buttons.
- **§3 tokens only.** Zero hard-coded hex values in any component under `src/ui` or
  `src/extension`.
- **§8 is fully satisfied** once the fold is accounted for: origin block, facts rows,
  content panel with byte count, "View raw JSON", the "Keys never leave your browser."
  trust line, and ghost Deny (1fr) + notched ink "Approve & sign" (2fr). The notch
  renders correctly and focus stays inside the clip-path.
- **Deep Ink is a genuine variant, not an inversion.** Primary correctly flips from ink
  to violet, and the dark primary's foreground is dark ink on violet at 6.3:1.
- **npub display** is mono and middle-truncated with a copy affordance everywhere it
  appears.

## Verification

- `pnpm run build` — passed.
- `pnpm run compile` — passed.
- `pnpm run test` — passed, 1346 tests across 83 files (unit, integration, security).
- Light capture — passed, 24 screenshots, with a real pending approval generated from a
  local TLS test dapp (runtime capture, not a mock).
- Dark capture — passed, 24 screenshots, confirmed byte-different from light.
- Changes in this review are confined to `docs/design-review/`. No application source
  was modified, so `pnpm run lint`, `pnpm run doctor` and the Firefox build were not
  re-run; the findings above are reported, not fixed.

---

# Review: auto-lock countdown

Date: 2026-09-18
Change: `openspec/changes/add-auto-lock-countdown`
Rubric: [`docs/design/DESIGN_RULES.md`](../design/DESIGN_RULES.md) §3 (accent budget), §4 (mono for countdowns), §6 (banned patterns), §11 (motion and a11y), §12 (PR checklist)
Build reviewed: production (`.output/chrome-mv3`), both themes, populated vault.

## What was judged

The new `AutoLockCountdown` ring on its three surfaces: the popup and side panel
header, the popup Settings panel, and the Options Security tab. Captured with the
full runner, both invocations, so every surface named below was captured from a
populated vault — the condition the June review missed a clipping bug under.

The change's design note left one question open for this review, quoted from
`design.md`: *"Does the `sm` header variant survive a populated vault at popup width
alongside the key selector, or does the header keep only the existing tooltip?"*

## Result: the header placement stays

The ring is drawn around the lock button's own 44px footprint rather than in a slot
beside it, so it costs the header no horizontal space at all. At popup width, with
the longest seeded key name and the key selector open over it
(`27-key-selector-open`), nothing is crowded and nothing is pushed. The button keeps
its 44px hit target (§11) and remains a distinct control — the ring renders no
interactive element of its own.

Had the ring taken a slot, the design note said to drop the header placement. It did
not need to.

## Findings

### 1. The slider value and the ring read the same at session start — not a defect

On both settings surfaces, immediately after unlock, the row shows "5 min" (the
configured timeout) beside a ring reading "5m" (the time remaining). They are two
different facts that happen to coincide for the first minute of a session, and they
diverge for the rest of it. Left as is: making the ring read something other than the
truth to avoid a transient coincidence would be the worse trade.

Worth re-checking if the ring is ever given a second settings placement where the
slider is not adjacent.

### 2. The header tooltip was saying the ring's line

`Header.tsx` carried `title="Lock now. Locks by itself after N min idle."`. With the
ring rendering the remaining time a few pixels away, the second sentence was the same
fact stated worse — a configured timeout where the ring shows an actual deadline. The
title is now `"Lock now"`: the button says what the button does, and the ring says how
long is left.

### 3. Accent budget untouched — §3

The ring spends no violet. The track is `--muted` and the arc is `--muted-foreground`,
switching to `--destructive` under sixty seconds. §3 budgets violet at roughly three
appearances per screen, and both settings surfaces already spend theirs on the slider
fill; a violet ring directly beside a violet slider track would have doubled up on the
one row where the two are adjacent.

### 4. Deep Ink checked as a role reassignment, not inferred — §3

The arc is legible against the track in both themes. In Deep Ink the `--muted` track
sits above the card rather than below it as in light, so the ring reads as a raised
hairline rather than a groove; both are correct for their theme and neither was
guessed from the other capture.

### 5. States not reachable by the screenshot runner

The runner photographs a session at full window, so every ring above is near
full-circumference. The sub-minute state (seconds, destructive role), the arc at
partial drain, and the expired reading are covered by
`tests/unit/ui/components/auto-lock-countdown.test.tsx` and by the drain assertion in
`tests/e2e/vault-lock.spec.ts`, which rewinds the recorded activity to inside the last
minute and asserts the reading falls. Not a gap in the feature; a gap in what a still
capture can show.

### 6. Banned patterns — §6

No gradient (the arc is a flat stroke), no accent rail, no icon bubble, no pill, no
emoji. The label is JetBrains Mono, per §4's rule that countdowns are mono. Motion is
a single `stroke-dashoffset` transition at 150ms on `--ease-out`, inside §11's
120–160ms band, and it is written `motion-safe:` so the arc steps rather than eases
under `prefers-reduced-motion` — the reduced-motion path is the default and the
animation is the exception, rather than the other way round.

## Surfaces

The ring was captured across seven surfaces, both themes: the popup header, the side panel header, the popup Settings panel (ring beside the slider), the Options Security tab (`lg` ring), the key selector open over the header, the lock screen, and the approval queue.

The lock screen and approval queue are the negative cases the spec requires: a locked vault reports no deadline at all, so there is nothing to render, and the signing moment deliberately carries no session clock. The request-expiry timer on the approval surface is a different thing and stays.

## Verification

- `pnpm run compile` — passed.
- `pnpm run test` — passed, 1396 tests across 85 files.
- `pnpm run build` and `pnpm run build:firefox` — passed.
- `pnpm run doctor` — 84/100, 0 errors. The 5 remaining warnings are in files this
  change does not touch.
- `pnpm run slop:changes` — 98/100, 0 errors, and no finding on a changed line.
- `tests/e2e/vault-lock.spec.ts` — 13 passed, including 5 new countdown tests.
- Light capture — 37 screenshots. Dark capture — 37 screenshots.

# Review: separate Display Name and Username fields

Date: 2026-09-25
Rubric: [`docs/design/DESIGN_RULES.md`](../design/DESIGN_RULES.md) §6 (banned patterns), §12 (PR checklist)
Build reviewed: production (`.output/chrome-mv3`), both themes, populated vault.

## What changed

Kind 0 carries two names: NIP-01's `name` and NIP-24's `display_name`. The editor had
one field, labelled "Display Name", that wrote `name`, while the summary showed
`display_name` first. A user with both set saw no change after saving. The editor now
has a Display Name field (`display_name`) and a Username field (`name`). The summary
adds a Username row only when it differs from the name the Display Name row shows.

## Findings

- `08-popup-profile-edit.png`, both themes: the two fields read as a pair, with the
  same header, counter and input treatment as About. No new component or colour.
- `25-popup-profile-populated.png`, both themes: the seeded profile has both names, so
  the Username row appears. It pushes Picture URL below the fold at 400×600. The row
  scrolls under the sticky action row, which is how the layout handles long profiles
  already (NIP-05 and Lightning rows do the same). Not a defect.
- A profile with only `name` shows no Username row. Covered by
  `tests/unit/ui/features/profile/profile-view.test.tsx`, not by the runner, which
  seeds both.

## Verification

- `pnpm run compile` and `pnpm run lint` — passed.
- `pnpm run doctor` — 100/100.
- Profile and onboarding E2E specs — 18 passed.
- Light capture — 37 screenshots. Dark capture — 37 screenshots.

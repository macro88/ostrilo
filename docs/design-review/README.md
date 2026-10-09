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

# Review: change master password dialog

Date: 2026-09-26
Rubric: [`docs/design/DESIGN_RULES.md`](../design/DESIGN_RULES.md) §6 (banned patterns), §7 (components), §12 (PR checklist)
Build reviewed: production (`.output/chrome-mv3`), both themes, populated vault.

## What changed

The Security tab gains a "Master password" section with one ghost "Change password"
row, which opens a dialog with current, new and confirm fields. The runner gains a
populated-phase step that photographs the dialog in four states:
`35-change-password-empty`, `35b-change-password-error`,
`35c-change-password-success` and `35d-change-password-throttled`. The throttled
capture comes last and the step resets the shared throttle afterwards, so
`34-lock-screen-error` still photographs a wrong password rather than a backoff.

## Findings

1. **A throttle wait rendered as a red error — §7 Warnings.** The first capture showed
   "Too many failed attempts. Try again in 5 seconds." in the red failure panel.
   A wait is not a failure, and §7 gives warnings the soft amber panel with a seal
   mark. Fixed: `rate_limited` now renders amber with a warning `SealMark`. A
   component test asserts the amber panel.
2. **The wrong-password line was generic.** The error read "Incorrect password", the
   throttle helper's default, which says nothing about *which* of the three fields
   was wrong. Fixed at the source: the handler passes "That is not your current
   password." to the throttle, so the wording survives the pause suffix a backoff
   appends.
3. **One notched primary per screen — §5.** The dialog's primary is the only notched
   control while it is open. The tab behind it uses ghost and danger-ghost buttons.
4. **Deep Ink checked, not inferred — §3.** The dark capture flips the primary to
   violet, the success panel to mint-on-deep, and the amber wait keeps its contrast
   on the dialog surface. The backdrop suppresses the tab behind it in both themes.
5. **No banned pattern — §6.** No gradient, rail, icon plate, pill or emoji. The
   success mark is a small seal, not a hero.

## Verification

- `tests/unit/ui/components/dialogs/ChangePasswordDialog.test.tsx` — 11 passed.
- `tests/e2e/security-settings.spec.ts` — 11 passed, including the end-to-end change.
- Light capture — 41 screenshots. Dark capture — 41 screenshots.

# Review: automatic-signing limit notice

Date: 2026-10-09
Rubric: [`docs/design/DESIGN_RULES.md`](../design/DESIGN_RULES.md) §6 (banned patterns), §7 (Warnings), §8 (approval surface), §12 (PR checklist)
Build reviewed: production (`pnpm run agent:loop:prod`), both themes, populated state: a trusted (high trust) site with a remembered allow rule that had just used its 60 automatic signatures.

## What changed

A request over a site's automatic-signing budget goes to the approval window like an
unremembered one. The signing prompt gains one amber line under the origin block:
"This site went over its automatic-signing limit for the past minute. Requests beyond
it need your approval." Without it a site still carrying the mint TRUSTED chip that
suddenly needs approval reads as a fault.

## Findings

- The line reuses the §7 warning panel already used for hidden characters on the same
  screen (`--ink-amber-soft` fill, amber text, radius 10, no border, no rail). No new
  component, colour or icon.
- Both themes: the panel keeps its contrast on Deep Ink and the amber role reads as a
  note, not an error. The TRUSTED chip is unchanged on purpose: the site is still trusted
  and the line explains why it is being asked.
- The line is absent for an ordinary prompt (unit test), and approving still resolves as
  `allow_once` (unit test).
- Not covered: the full screenshot runner was not extended or re-run for this change. The
  capture came from a scratch spec at the default 960x640 approval size; the narrow,
  single-pane approval layout was not photographed.

## Verification

- `tests/unit/ui/features/approval/event-detail-view.test.tsx` passed.
- `tests/e2e/auto-sign-budget.spec.ts`: 60 silent signatures, then the 61st opens the
  approval window with the notice and signs on approval.

# Review: per-key public-key grants in Permissions

Date: 2026-10-09
Rubric: [`docs/design/DESIGN_RULES.md`](../design/DESIGN_RULES.md) §6 (banned patterns), §7 (npub display, grouped rows), §12 (PR checklist)
Build reviewed: production (`pnpm run build`), both themes, populated vault from `capture-screenshots.mjs`: a high-trust site granted under two keys, a medium-trust site with no decision and a refused site.

## What changed

A public-key `allow` now belongs to one key, so Settings → Permissions names each grant's identity. The collapsed row counts them ("Can read 2 public keys"). Under "Your public key" the open row lists one entry per grant: key name, short middle-truncated npub with a copy button, and its own Revoke. The consent prompt's remember note says the site will not ask again for this identity. The runner now makes the Nostrich grant under both seeded keys, so the capture shows a two-grant row and not the one-grant case.

## Findings

- The list is a hairline-divided block inside the existing row panel, the same treatment as "Rules by kind". No new card, chip, colour or icon; Revoke is the existing outline button.
- npubs are mono and middle-truncated with a copy affordance (§7). A key that is gone is named "Removed key" and stays revocable; an unreadable key is named as unreadable and shows no npub (unit tests; not reachable from the runner).
- Both themes: the entry block keeps its hairline and text contrast on Deep Ink, and the copy icon reads as secondary in both.
- Each Revoke carries an `aria-label` naming the key, so the two buttons are not announced identically.
- The captured consent prompt (33) is unchanged apart from the note under "Remember this site", which shows only once the box is ticked and was not photographed.
- Not covered: the narrow popup width for this tab (the Permissions tab is an options-page surface), and a grant list longer than a few keys.

## Verification

- `tests/unit/ui/features/settings/OriginPolicyTable.test.tsx`, `PermissionsTab.test.tsx`, `tests/unit/ui/hooks/use-app-settings.test.tsx` passed.
- `tests/e2e/identity-disclosure.spec.ts` (key switch through a real page and approval window) and `tests/e2e/settings-origin-policy.spec.ts` passed.
- Light capture and dark capture both completed.

# Review: Quick start and the Home backup banner

Date: 2026-10-10
Rubric: [`docs/design/DESIGN_RULES.md`](../design/DESIGN_RULES.md) §5 (one notch per screen), §6 (banned patterns), §7 (cards, warnings, step dots), §10 (voice), §11 (hit targets), §12 (PR checklist)
Build reviewed: production (`pnpm run build`), both themes. The banner was judged on the runner's populated vault (new captures `23b` and `28b`, taken with the pending "Work" key selected and the named key selected again afterwards). The Quick start password and notice screens are not in the runner, which drives onboarding through Create New Key; they were photographed once per theme on a fresh profile.

## What changed

The welcome screen gains a third row, "Quick start". Its flow is a password step and one notice step, then Home. Home gains a hairline banner, "This key has no backup", with a "Back up" action and a dismiss, for a selected key whose backup is pending.

## Findings

- Welcome: Create New Key keeps the screen's single notch; Quick start and Import are hairline rows. Three rows still fit the 400x600 popup with the hero.
- Quick start password step: the same `PasswordInput`, step dots and 1fr/2fr button pair as the other flows. The notice step uses the soft amber warning panel with a seal icon and no border or rail (§7 Warnings), and one notched Continue. No new colour, icon plate or gradient.
- Banner: an `ink-card` row in Home's own grammar, deliberately not an amber warning. "Back up" is violet text and the dismiss is a 44px square, so both meet §11. One violet use on the screen.
- Both themes: the banner keeps its hairline and text contrast on Deep Ink; "Back up" reads as the accent in both.
- The banner adds about 68px, so in the 400x600 popup the second activity row now sits behind the tab bar until the shell scrolls. The first row stays whole and nothing is sliced through its text. The side panel shows the same rows as before.
- Not covered: the banner at a very long key name (it does not render the name), and Quick start in the side panel layout.

## Verification

- `tests/unit/ui/features/home/home-view.test.tsx`, `tests/unit/ui/features/backup/backup-banner.test.tsx`, `tests/unit/ui/features/onboarding/quick-start-flow.test.tsx` passed.
- `tests/e2e/quick-start.spec.ts`: Quick start, lock and unlock, popup closed on the notice, dismissal, backup from the banner, restore in a fresh profile with the same public key.
- Light capture and dark capture both completed.


# Review: automated accessibility pass (axe)

Date: 2026-10-10
Rubric: [`docs/design/DESIGN_RULES.md`](../design/DESIGN_RULES.md) §3 (colour tokens), §11 (contrast, hit targets), §12 (PR checklist)
Build reviewed: production (`pnpm run build`), both themes, populated vault. Judged from the runner's captures and from `tests/e2e/accessibility.spec.ts`, which scans 36 surfaces per theme.

## What changed

Two colour tokens were darkened in light, one text opacity was raised in dark, and the header key selector became a menu.

## Findings

- `--ink-red` (`#BD4A55`) measured 4.1:1 on its own soft fill, so every red chip (Denied, First visit, Refused) failed 4.5:1. It is now `#B3434E`: 4.6:1 on the soft fill, 5.5:1 on a card. Deep Ink's red was already above the line.
- `--ink-2` (`#736B89`) measured 4.4:1 on `--muted`, the highlighted row of the key selector. It is now `#6C6483`: 4.9:1 on `--muted`, 4.8:1 on the accent soft fill. Both changes are a few percent of lightness; the hierarchy between `--ink` and `--ink-2` reads the same in the captures.
- The welcome screen's "A new key, generated on this device" sat at 4.49:1 in Deep Ink (violet plate, 75% ink text). It is 85% now.
- The key selector was a `listbox` holding an action. It is a `menu` of `menuitemradio` rows and a `menuitem`; the look is unchanged (captures `27`).
- Not seen in captures but found by axe: password errors in Quick start, Create, Import and the unlock dialogs were not announced. They now are (see the unit test).
- Not covered: the side panel layout, and Radix Select popovers other than the activity kind filter.

## Verification

- `tests/e2e/accessibility.spec.ts` passed in both themes with no serious or critical violation. Two findings are ignored on the open activity filter and one on the open key menu, each named with its reason in the spec: they are Radix's own `aria-hidden` of the page behind a modal popover and its scrolling viewport.
- Light capture and dark capture both completed.

# Review: phase 0.10, every surface the phase touched

Date: 2026-10-10
Rubric: [`docs/design/DESIGN_RULES.md`](../design/DESIGN_RULES.md) §3 (tokens, Deep Ink), §5 (one notch per screen), §6 (banned patterns), §7 (components, Warnings), §10 (voice), §11 (contrast, hit targets), §12 (PR checklist)
Build reviewed: production (`pnpm run build`), both themes, populated vault. Each capture was opened and looked at, light and dark; 64 per theme.

The earlier entries above cover the auto-sign notice, per-key grants, Quick start and the Home banner, and the axe pass as each landed. This one is the pass over the finished phase, and it covers what those did not reach.

## What the runner gained

The runner's populated phase now seeds and photographs:

- a picture address long enough to widen anything that does not wrap, and a transparent-background PNG as the second key's picture (`25b`, `23b`);
- the Back up flow on a key with no backup: the password prompt and the passphrase dialog (`29b`, `29c`);
- the lock screen with each of the seven lock reasons and the "Can't reach Ostrilo" screen (`36-*`). The vault is locked for real; a page-level override of the background's answer swaps only the reason, so the copy is judged in the real screen at the popup's width;
- a key whose stored record is damaged, selected: Home, Profile and Settings → Keys (`37`, `37b`, `37c`);
- refusals with reasons in Activity: your own denial, a saved deny rule and a site refused for asking too often (`38`, `38b`, the second at 400x1400 so the whole run of reasons fits);
- the approval prompt after a site spends its 60 automatic signatures, at the approval window's 400x600 width (`39`);
- Quick start on a second, empty browser profile: password, notice and Home with the banner (`40`, `40b`, `40c`);
- Home with the banner scrolled to its end (`23c`), and the Profile picture row scrolled into view (`25b`).

## Findings

### Fixed

1. **Home's backup banner sent a key that cannot be read to a button that is disabled for it** (`37-popup-home-unreadable-key`, both themes). The banner read "This key has no backup" under the red "could not be read" message, and its Back up action opened Settings on a Back up button that does nothing for that key. The banner now stays away from an unreadable key (`4e6d19f`, with a unit test).
2. **"CONTENT · 1 BYTES"** on the over-budget prompt (`39`), because the label always pluralised. It now says "1 byte" (`82550a1`, with a unit test).
3. **A refusal because the key could not be read read as the person's choice.** The activity row carries a red DENIED chip, and the reason line said only "The signing key could not be read". That entry is written when a key fails after the request was accepted, which can be after the person pressed Approve. The line now says "Not signed: the signing key could not be read" (`4e79d5e`). The runner cannot photograph it: a key that is already unreadable when the request arrives is refused before any prompt and is not logged at all, so only a failure mid-sign writes it. The copy is covered by `tests/unit/ui/features/activity/activity-view.test.tsx`.

### Judged, not changed

- **The banner's height at 400x600.** It adds about 68px, so on Home the second activity row sits under the tab bar until the shell scrolls (`23b`). Scrolled to its end (`23c`), both rows are whole and clear of the tab bar, and nothing is sliced through its text at rest: the first row is whole and the second shows only its top hairline. Quick start's first Home (`40c`) has the same shape with the empty-state card, whose last line is behind the tab bar until scrolled; that one was not scrolled in a capture. No card shrinks, clips its own rows or overlaps, which is the failure the populated vault exists to catch. The side panel shows three rows plus the banner (`28b`).
- **Lock reasons.** Six of the seven lines are no longer than the 56-character one that fits a single line at 400px; "Locked because the browser restarted Ostrilo's background." (57) wraps to two with a single word on the second line, and the Unlock button moves down by one line. Centred, unclipped, and the longest line the screen will ever carry, so left as is.
- **"Can't reach Ostrilo"** is one amber seal, a title, two lines and one notched Try again, in both themes. The amber seal is a warning, not decoration.
- **The unreadable-key states** keep the red message in the card Home already uses for it, name the key in the header ("Unreadable key") and in Settings (a red line under the key, Back up disabled), and tell the person to choose another key. Profile says the same in plain text with no card. Three different shapes for one fact, each at home on its screen.
- **A transparent-background picture** in the header reads as a figure on the seal in light. In Deep Ink the violet figure sits on the dark seal at lower contrast, but it is legible, it is the user's own image, and the review does not recolour user content.
- **The long picture address** truncates inside its Profile row with its copy and open actions intact, and "Refresh picture" sits beside the note that says what it loads. The popup does not widen.
- **Per-key grants in Permissions** (`30b`): two entries for one site, each with its key name, a shortened mono `npub`, a copy button and its own Revoke. The collapsed row says "Can read 2 public keys".
- **The over-budget prompt** (`39`) keeps the amber line under the origin block, a mint TRUSTED chip, one notched Approve and the trust line, at the narrow width.
- **Quick start** keeps one notched primary per screen, the shared step dots and the soft amber notice, with no icon plate or rail (§5, §6, §7).
- **Back up dialog.** The passphrase panel sits about 28px below the intro text before its hairline, because the dialog's own 16px gap and the shared export panel's 12px top margin stack. It is the component onboarding also uses, nothing is cut off, and it is a small wrong spacing rather than a broken layout, so it is not changed here.
- **Banned patterns (§6).** No gradient, accent rail, dot grid, icon plate, pill or emoji on any new surface. Every colour is a token.

### Not covered

- The side panel for Quick start and for the unreadable-key states.
- The narrow approval window with a list of more than three requests.
- A refusal row that carries the key-unreadable reason.
- A failed **Refresh picture** note: the runner never loads a picture, so it cannot photograph the failure.

## Verification

- `pnpm run compile` and `pnpm run lint` passed.
- `pnpm run test:coverage` passed: 175 files, 2951 tests; lines 98.53%, branches 94.57%.
- `pnpm run build` and `pnpm run build:firefox` passed.
- `pnpm run doctor`: 100/100.
- `pnpm run slop:changes`: 100/100 on a clean tree (it scores changed files, and the work was committed). `pnpm run slop:ci`: whole project 91/100, no errors, against the floor in `.aislop/config.yml`.
- `pnpm audit --audit-level high` exits 0.
- `tests/e2e/accessibility.spec.ts`, `quick-start.spec.ts` and `activity-view.spec.ts`: 15 passed; axe judged 36 surfaces per theme with no finding.
- Light capture and dark capture: both complete, 64 screenshots each, no skipped step.

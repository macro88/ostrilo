## Context

Auto-lock is enforced by two independent mechanisms: a `chrome.alarms` alarm that fires and locks, and a lazy deadline check inside `KeyVaultService.getLockState()` that compares the stored `lastActivity` against `autoLockMinutes` on every privileged access. The lazy check is the one that matters — an MV3 service worker can be evicted with the alarm pending, so a timer-only design silently never locks.

Nothing the UI can reach today exposes the deadline. `state.getLock` returns `{ isLocked, selectedKeyId }`, and `lastActivity` never leaves the background.

Two constraints shape everything below.

**The MV3 worker must not be kept alive.** `LOCK_POLL_MS` is 5s specifically so that an idle options page does not become the thing that keeps the service worker running. A countdown that asks the background for the remaining time once a second would defeat that deliberate choice and, worse, would be a UI that extends the life of the process enforcing the lock.

**`lastActivity` does not currently move.** `touchActivity()` and the `state.touch` RPC exist and are reachable, but the repository has no caller outside tests. `lastActivity` is written at unlock (`key-vault.service.ts:662`), at lock (`:772`), and by the worker-eviction correction (`:857`). The `session-auto-lock` spec already requires that deliberate user action postpones the lock, so this is an implementation gap against a written requirement, not a new behavior being invented here.

## Goals / Non-Goals

**Goals:**

- Show the time remaining before auto-lock on the surfaces where a user would look for it, accurately enough to be trusted and cheap enough to run continuously.
- Close the activity-recording gap so the countdown describes real behavior and the shipped slider copy becomes true.
- Keep the deadline inside the extension's own trust boundary: no web page gains a read on session lifetime.
- Add no background traffic that scales with the number of open surfaces or with how long they stay open.

**Non-Goals:**

- Changing when the vault locks, the accepted `autoLockMinutes` range, the shipped default, or the re-authentication gate on changing the timeout.
- A countdown on the approval window.
- Any control that extends or ends the session from the ring itself.
- Second-accurate agreement between the ring and the moment the background actually locks. The ring is a readout; `getLockState()` remains the only authority.

## Decisions

### Derive the countdown from an absolute deadline, not a duration

`state.getLock` returns `lockAt`: an absolute epoch-milliseconds timestamp, computed as `lastActivity + autoLockMinutes * 60_000`, present only when the vault is unlocked. The UI ticks locally against `Date.now()` and re-reads `lockAt` on the 5s poll that `KeyManagerContext` already runs.

*Why:* an absolute deadline is self-correcting. A duration (`remainingMs`) starts decaying the instant it is serialized and is wrong by however long the surface was backgrounded, suspended, or throttled — and browsers throttle timers in hidden tabs aggressively, which is exactly the options-page-left-open case. With a timestamp, a surface that wakes after five minutes of throttling computes the correct remaining time on its first frame.

*Alternatives considered:* (a) `remainingMs` — rejected for the decay above; (b) a push broadcast on every deadline change — rejected because it adds a message per activity event across every open surface to replace a value the existing poll can carry for free; (c) computing the deadline in the UI from `settings.autoLockMinutes` plus a separately fetched `lastActivity` — rejected because it duplicates the deadline formula outside the service that owns it, and a countdown that disagrees with the lock is worse than no countdown.

The deadline formula moves into one private helper on `KeyVaultService` used by both `isPastAutoLockDeadline()` and `getLockState()`, so the number shown and the number enforced cannot drift.

### `lockAt` is absent while locked, and the `state` namespace stays UI-only

`state` is not in `PAGE_REACHABLE_NAMESPACES`, so a web page cannot reach `state.getLock` through the content script — the field is only ever served to the extension's own pages. While locked, `lockAt` is omitted entirely rather than sent as `null` or a past timestamp.

*Why:* `state.getLock` is in `LOCKED_REACHABLE_METHODS` because the lock screen needs it. That list is about reachability, not about what a locked response may contain — the router already redacts `keys.list` and `settings.get` on the way out for exactly this reason. A locked vault's `lockAt` would disclose when the session ended, which is a fact about the absent user's habits that the lock screen has no use for. Omission also makes the type honest: `lockAt?: number` cannot be read as a live deadline by a caller that forgot to check `isLocked`.

### Tick at 1Hz in the UI, and only while the surface is visible

A single `setInterval` per mounted countdown, at 1s, suspended on `document.hidden` via `visibilitychange` and resynced on the way back. No RPC per tick.

*Why:* the ring's smallest meaningful unit is one second, so a higher rate buys nothing. Suspending while hidden means a backgrounded options page costs nothing at all, and the absolute-timestamp decision above makes resync free.

*Alternative considered:* `requestAnimationFrame` for a continuously sweeping arc — rejected. It is 60x the work for sub-second arc motion nobody reads, and `DESIGN_RULES.md` treats persistent animation in chrome as close to the banned list.

### Recording activity: an explicit call at the interaction, throttled in the client

Activity is reported by calling the existing `touchActivity()` client function from the places the spec already names — unlock, key selection, approval resolution, settings mutations — plus a throttle in `client.ts` that collapses calls within a window (30s) to one RPC.

*Why explicit call sites over a global listener:* a document-level `pointerdown`/`keydown` listener on every extension surface is the tempting version and it is wrong here. It cannot distinguish deliberate action from a stray scroll over a pinned sidepanel, it fires on the lock screen (which must never revive a session — `touchActivity()` refuses this at the service, but the UI should not be leaning on that refusal as its design), and it makes "what postpones the lock" a property of where the mouse happens to be rather than of what the user did. The spec's own scenarios are phrased in terms of actions, so the call sites should be too.

*Why throttle in the client rather than the handler:* the handler's job is to record and re-arm; the throttle exists to stop N open surfaces from each sending an RPC for the same burst of interaction. 30s against a 1-minute minimum timeout is the tightest window that still guarantees at most one round trip per interaction burst while never letting a deadline expire that should have been postponed — worst case, the deadline is 30s staler than the interaction, which is inside the window a 1-minute timeout already tolerates.

*Consequence, stated plainly:* sessions under active use will last longer than they do today, because today they do not slide at all. That is the specified behavior, but it is a real change to observed session lifetime and goes in the changelog.

### One component, three sizes, no new dependency

`AutoLockCountdown` renders an inline SVG: a full-circumference track in `--muted`, and an arc drawn with `stroke-dasharray`/`stroke-dashoffset` over it. A `size` prop (`sm` for header chrome, `lg` for settings) drives radius, stroke width and label typography.

*Why inline SVG over a conic-gradient background:* `conic-gradient` cannot draw a ring with a hairline track without a second stacked layer, does not take a line cap, and is harder to make respect the theme tokens in both roles. SVG stroke geometry is exact, themeable through `currentColor`, and needs no library — the project has no charting dependency and this should not introduce one.

The arc is the only moving element. No pulse, no glow, no gradient — `DESIGN_RULES.md` bans gradients outright and budgets the violet accent at roughly three appearances per screen, so the ring spends the accent once and the track stays muted.

### Sub-minute state: role color and unit change, nothing else

Above 60s: minutes, rounded up, muted arc. At or below 60s: seconds, and the arc plus label take the `destructive` role already in the token set. At zero: the ring reads `Locked` and stops; the actual transition to the lock screen is driven by the existing poll, not by the ring.

*Why rounded up above a minute:* a ring that reads "0 min" for the last 59 seconds is lying in the direction that costs the user work. Rounding up means the label only reaches its final value when that value is true.

*Why the ring does not trigger the lock at zero:* `getLockState()` is the single definition of locked, and it fails closed. A UI that locked on its own clock would be a second authority with a different one, and the two would disagree across a suspend, a clock change, or a throttled tab.

### Accessibility

The ring is `role="timer"` with an `aria-live="off"` label and an `aria-label` carrying the full phrase (`"Vault locks in 12 minutes"`), refreshed on the tick. The arc itself is `aria-hidden`. Under `prefers-reduced-motion` the arc updates without a CSS transition between states — it steps rather than eases.

*Why `aria-live="off"`:* a live region that announces every second is unusable. The label is available on demand; it does not interrupt.

## Risks / Trade-offs

**Sessions get longer once activity recording works, and no one asked for that in this change.** → It is the behavior `session-auto-lock` already specifies and the slider already promises, and it is the precondition for the countdown being honest. It is called out in the proposal's Impact and belongs in the changelog. The lock still fires from a genuinely idle window, which is the property the timeout exists to provide.

**A throttled activity report can be up to 30s stale, so a vault can lock up to 30s "early" relative to the last interaction.** → Bounded and stated. The alternative — an RPC per interaction from every open surface — trades a bounded staleness for unbounded background wake-ups, which is the worse failure for a lock that depends on the worker.

**The ring and the background can disagree at the boundary.** The ring can read a few seconds remaining when `getLockState()` has already locked (a shorter timeout was configured elsewhere, the clock moved, the worker was evicted). → The ring is explicitly not an authority; the poll corrects it within 5s and the lock screen replaces the surface. Any privileged operation attempted in that window is refused by the background regardless of what the ring shows. The countdown spec states this as a requirement rather than leaving it to implementation.

**A visible countdown is a nudge to keep the timeout long.** Making the cost of a short timeout legible ("this thing is always about to lock") is a real pressure toward weaker settings. → The range is already bounded at 60 minutes and the change does not touch it; the re-auth gate on changing it stays. Worth watching in design review, not worth withholding the information over.

**Another element in persistent header chrome, on the surface with the least room.** → The `sm` variant is a ring around the existing lock button's footprint rather than a new slot beside it, and the header is judged in both themes against a populated vault per `AGENTS.md`. If the screenshot review says it crowds the key selector at popup width, the header placement is the one to drop — the settings placements carry the feature on their own.

## Migration Plan

No data migration. `lockAt` is an optional field on an existing response, so an older UI against a newer background ignores it and a newer UI against an older background renders no ring rather than a wrong one — the countdown treats an absent `lockAt` as "not available", not as zero.

Rollback is removing the UI: the activity-recording call sites are independently correct and would stay.

## Open Questions

- Does the `sm` header variant survive a populated vault at popup width alongside the key selector, or does the header keep only the existing tooltip? Settled by the screenshot review, not in advance.
- Is 30s the right activity throttle, or should it scale with `autoLockMinutes` (e.g. `min(30s, autoLockMinutes * 60s / 10)`)? The fixed value is correct for the 1-minute floor; the scaled version only matters if the floor is ever lowered.

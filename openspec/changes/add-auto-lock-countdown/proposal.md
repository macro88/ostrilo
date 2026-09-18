## Why

The auto-lock timeout is configured as an abstract number of minutes and then disappears. Nothing in the UI tells the user how much of that window is left, so the only way to discover the deadline is to hit it — a vault that locks mid-task reads as the extension breaking rather than as the timeout working. A visible countdown makes the security property legible and turns the slider into a control with observable consequences.

Building it surfaces an existing gap. `KeyVaultService.touchActivity()` and the `state.touch` RPC exist and are wired through the client, but **nothing calls them**: `lastActivity` is written only at unlock, at lock, and by the worker-eviction correction. The deadline therefore runs from unlock and never slides, while `session-auto-lock` already specifies that deliberate user action postpones the lock, and the auto-lock slider tells the user it is "measured from your last activity in the extension, not from when you unlocked." A countdown would display that contradiction once a second. The display is not honest until the activity path it reports on actually works, so the two ship together.

## What Changes

- **Record activity for real.** Deliberate user action in an extension surface calls `state.touch`, so the inactivity deadline slides as `session-auto-lock` already requires. Throttled, and never triggered by lock-state polling, broadcast handling, or background bookkeeping.
- **Expose the deadline to the extension's own UI.** `state.getLock` gains a `lockAt` timestamp when the vault is unlocked. It is absent while locked, and the `state` namespace stays unreachable from web pages, so no page gains a read on session lifetime.
- **New `AutoLockCountdown` component.** An SVG ring that drains from full to empty over the inactivity window, with the remaining time as its label. Under one minute it switches to seconds and takes the destructive role color. Purely a readout — the existing header lock button remains the only lock control.
- **Three placements.** The Options → Security tab (beside the auto-lock slider), the popup/sidepanel header (small, beside the lock button), and the popup's own Settings panel. Deliberately **not** the approval window: the signing moment stays calm.
- **Tick locally, sync on the existing poll.** The ring interpolates from `lockAt` in the UI and re-reads it on the 5s lock poll that already runs. No new background traffic, and nothing that keeps the MV3 service worker alive.

## Capabilities

### New Capabilities

- `session-countdown-display`: A readout of the time remaining before the vault auto-locks — where it appears, what it derives from, how it degrades near zero and at the boundary, its accessibility contract, and the rule that it never itself postpones the lock.

### Modified Capabilities

- `session-auto-lock`: `state.getLock` discloses the inactivity deadline to trusted extension surfaces while unlocked, and MUST NOT disclose it while locked. The existing locked-reachable disclosure rule is extended to cover the new field.
- `ui-options-page`: The Security Settings Tab and Basic Settings in Popup requirements gain the countdown alongside the auto-lock slider.

## Impact

**Background and messaging**
- `src/application/services/key-vault.service.ts` — `getLockState()` returns `lockAt`; the deadline computation currently inlined in `isPastAutoLockDeadline` becomes the single source for both.
- `src/infrastructure/messaging/handlers/state-rpc.ts`, `src/infrastructure/messaging/client.ts` — `getLockState` response type widens.
- `src/infrastructure/messaging/rpc-router.ts` — locked-state redaction covers `lockAt`.

**UI**
- New `src/ui/components/AutoLockCountdown.tsx` (or under `features/settings/components/shared`) and a `useAutoLockCountdown` hook.
- `src/ui/state/KeyManagerContext.tsx` — the existing 5s poll carries `lockAt`; a throttled activity reporter lives alongside it.
- `src/ui/components/layout/Header.tsx`, `src/ui/features/settings/components/SecuritySettingsTab.tsx`, `src/ui/features/settings/components/BasicSettings.tsx`.

**Existing behavior that changes**
- Sessions will now last longer under active use than they do today, because the deadline finally slides. This is the specified behavior, not a relaxation — but it is a real change to observed session lifetime and belongs in the changelog.

**Tests**
- `tests/security/auto-lock.test.ts` — activity recording is reached through the RPC path, not only the service method; `lockAt` is absent while locked.
- `tests/unit/ui/...` — countdown rendering, the sub-minute transition, the expired boundary.
- `tests/e2e/vault-lock.spec.ts` — the ring is present and drains on the surfaces that carry it.

**Design**
- One more element competing for the violet accent budget in persistent header chrome; the ring uses a muted track and a foreground arc, with the accent spent only where `DESIGN_RULES.md` already allows. Screenshot review in both themes against a populated vault, per `AGENTS.md`.

**Not in scope**
- The approval window placement.
- Any change to the accepted `autoLockMinutes` range, its default, or the re-authentication gate on changing it.

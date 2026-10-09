## 1. Reproduce and test first

- [x] 1.1 Deterministic-clock tests in `tests/security/auto-lock.test.ts`: 35 minutes is 2,100,000 ms, unlocked at 34:59 and 2,099,999 ms, locked at the deadline; measured from the last activity; a shortened and a lengthened timeout apply to the running session; a new unlock starts a new deadline
- [x] 1.2 Record the other hypotheses (default, unit, stale snapshot, competing alarms, popups) as confirmed or ruled out in `design.md`
- [x] 1.3 Failing test for a `NaN` last-activity timestamp, which read as a deadline that never arrives
- [x] 1.4 Real-browser test that counts the keepalive's calls from inside the worker; confirm it fails with the keepalive wiring removed

## 2. Keepalive

- [x] 2.1 `SessionKeepAlive` in `src/infrastructure/lifecycle/session-keepalive.ts` with injected `ping` and `getLockState`
- [x] 2.2 Start on `vault.onUnlock`, stop on `vault.onLock`, refresh when settings change
- [x] 2.3 Unit tests: 20 second cadence, no ping before start, stop, double start, locked stops it, deadline-aligned final tick, refusal of a deadline beyond the maximum or of no usable deadline, unreadable state stops it, a failed ping does not stop it, a stop during an in-flight check, refresh
- [x] 2.4 Chrome e2e: pings while unlocked with every extension page closed; no pings after a manual lock

## 3. Lock reason

- [x] 3.1 `LockReason`, `LOCK_REASONS`, `isLockReason` in the domain
- [x] 3.2 `lock(reason)`, reason-bearing `getLockState()`, `NaN`-safe deadline evaluation, `background_restarted` on the eviction correction
- [x] 3.3 Startup and install handlers lock with `browser_restarted` and `extension_updated`
- [x] 3.4 `LockStatePayload` and the locked `state.getLock` projection carry `lockReason` and `inactivityMinutes`; a security test shows nothing else rides through
- [x] 3.5 Tests for every reason, persistence across readers, clearing on unlock, an unrecognised stored value

## 4. UI

- [x] 4.1 `describeLockReason` and the lock screen sentence
- [x] 4.2 `KeyManagerContext`: carry the reason, `lockCheckFailed`, `retryLockCheck`; a rejected request no longer sets `isLocked`
- [x] 4.3 `BackgroundUnreachable`, wired ahead of onboarding and the lock screen in `MainApp` and the options gate
- [x] 4.4 Unit tests for the context, the lock screen, both gates and the copy
- [x] 4.5 e2e: the inactivity sentence on the real lock screen; the `background_restarted` sentence after `ServiceWorker.stopWorker`

## 5. Verify

- [x] 5.1 `pnpm run compile`, `pnpm run lint`, `pnpm test`, the touched e2e specs, `pnpm run build`, `pnpm run build:firefox`
- [ ] 5.2 Manual check in a real Chrome profile with DevTools closed: unlock with the popup closed and `autoLockMinutes` of 35, wait at least five minutes, confirm the vault is still unlocked; lock manually and confirm the lock screen says "You locked Ostrilo."
- [ ] 5.3 Manual check in Firefox: note whether the event page unloads before the timeout and that the lock screen then says the browser restarted the background
- [ ] 5.4 Screenshots in both themes against a populated vault for the reason line and "Can't reach Ostrilo" (`docs/design-review/`)
- [ ] 5.5 Archive this change (Task 14 of phase 0.10)

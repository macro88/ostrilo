## Context

OSTR 04 reports an auto-lock of 35 minutes that locked after one to two minutes. The first reading of the source blamed the setting: a default or unit fallback, a stale settings snapshot, a second alarm. None holds (below). What holds is a lifecycle fact. Chrome ends an idle MV3 service worker about 30 seconds after its last event or extension API call, and `KeyVaultService.unlocked` - the only place decrypted keys exist - is that worker's memory.

The archived change `openspec/changes/archive/2026-09-17-implement-session-auto-lock/design.md` knew this. Its Context calls the worker's death "an accidental partial mitigation" and says that "anything that makes the timer reliable by keeping keys alive across worker death would remove this accident". Its Decision 1 lists, under "Alternative considered", a long-lived `runtime.Port` from an open surface plus a plain timer, rejected because it works only while a surface is open and "inverts the incentive (an open options tab would keep the vault alive precisely when the user has walked away)". It also rejects, explicitly, persisting the unlocked key or the password to `chrome.storage.session`.

That design was right about the hazards and wrong about the price. The accident it wanted to keep is not a mitigation a user can predict: it locks a 35-minute session in 30 seconds with no explanation, on a setting the product advertises as honoured.

### The owner's decision (2026-10-09)

Keep the background alive while unlocked, so a 35-minute setting is honoured. While unlocked, the worker calls a cheap extension API about every 20 seconds, which resets Chrome's idle timer; the keepalive stops at lock and never outlives the auto-lock deadline. Decrypted keys stay in worker memory only. If the worker still dies, the vault fails closed and the lock screen says why.

### What is reversed, and what stands

| Archived position | This change |
| --- | --- |
| A keepalive is rejected (Decision 1, "Alternative considered: a long-lived Port"). | **Reversed, keepalive only.** A bounded keepalive runs while unlocked. It is not a Port from a surface; it is the background calling an extension API on its own timer, so it is independent of any open surface. |
| Eviction is relied on as a partial mitigation (Context). | **Reversed in practice, not in principle.** Eviction is no longer the expected path, but it is still handled exactly as before: the vault fails closed. |
| Persisting keys, a password or a derived key to survive worker death is rejected (Decision 1). | **Stands, unchanged.** Keys are never written to `storage.session`, `storage.local` or anywhere else. Nothing here adds a write. |
| Lock state is derived from a stored timestamp on every access, not from a timer (Decision 2). | **Stands.** The keepalive's timer is not the lock mechanism and the lock does not depend on it. |
| `state.getLock` polling and background bookkeeping are not activity (Decision 5). | **Stands.** A keepalive ping is not activity, and it never calls `touchActivity`. |

The archived objection to a Port-based keepalive - that it would keep the vault alive "precisely when the user has walked away" - is answered by the bound below rather than by the absence of a keepalive. The keepalive is a statement about the worker's memory, not about the vault's deadline: the deadline is still measured from the last activity, and the vault still locks when it passes.

## Goals / Non-Goals

**Goals**

- A configured timeout is the timeout: a 35-minute setting locks at 35 minutes of inactivity, not at 30 seconds of idle worker.
- The keepalive runs only while unlocked, stops on every lock path, and cannot outlive the deadline.
- Every lock says why, and the lock screen shows it.
- A failed lock-state request is shown as a failure, not as a lock.
- The keepalive holds no secret and writes nothing.

**Non-Goals**

- Persisting key material across worker death.
- Rehydrating key metadata in the UI after unlock (OSTR 05, the next change).
- A different keepalive for Firefox.
- Any change to what counts as activity.

## Decisions

### Decision 1: Hypotheses checked before the fix

| Hypothesis from the bug report | Result | Evidence |
| --- | --- | --- |
| Default, unit or parse fallback replaces 35 | Ruled out | `normalizeAutoLockMinutes(35)` is 35 (floor, clamp to 1-60, non-numbers fall to the default 5). The deadline test asserts `lockAt - unlockTime === 2_100_000`. |
| Deadline arithmetic is early | Ruled out | Deterministic-clock tests in `tests/security/auto-lock.test.ts`: unlocked at 34:59 and at 2,099,999 ms, locked at 2,100,000 ms, measured from the last activity rather than from unlock. |
| Stale settings snapshot | Ruled out | The vault reads settings from storage on every deadline evaluation; there is no cache. Tests shorten and lengthen the timeout on a running session and the deadline follows at once. |
| An earlier alarm or timer outlives a settings change or an unlock | Ruled out | There is one named alarm; `alarms.create` with an existing name replaces it. The alarm only polls `getLockState()`, which evaluates the stored deadline, so an old alarm cannot apply an old interval. A new unlock overwrites `lastActivity`; tests show the first session's deadline does not lock the second. |
| Multiple popups or lifecycle callbacks compete to lock | Ruled out as a cause | Every lock path goes through one `lock()`; popups only read, and a poll cannot extend or shorten a deadline. |
| Worker termination | **Confirmed as the cause** | With the keepalive removed, the background made no API calls while unlocked (the e2e count is 0). The vault's own `unlocked.size === 0` branch locks the record as soon as a fresh worker answers any request. |
| The UI shows "locked" after a transport failure | Confirmed as a separate defect | `KeyManagerContext` set `isLocked: true` on any rejected `getLockState()`. Fixed here (Decision 5). |
| Not in the report: `lastActivity` of `NaN` | Found, fixed | `NaN > Date.now()` and `Date.now() >= NaN` are both false, so a `NaN` timestamp read as a deadline that never arrives. `Number.isFinite` now guards it; it fails closed as `state_unreadable`. |

A caveat on the evidence. Playwright attaches DevTools to the extension's service worker, and Chrome does not end a worker that has DevTools attached, so a plain "wait 50 seconds, check still unlocked" end-to-end test passes with or without the keepalive. The e2e tests therefore count the keepalive's own calls from inside the worker and assert the state afterwards, and simulate termination with `ServiceWorker.stopWorker`. The browser's real idle termination is checked by hand (tasks.md).

### Decision 2: A keepalive in `src/infrastructure/lifecycle/`, with its ping and lock-state read injected

`SessionKeepAlive` takes two functions: `ping` (the background passes `() => browser.runtime.getPlatformInfo()`) and `getLockState` (the vault's own). It has no access to storage, settings or keys, so it cannot hold a secret or write anything.

Chrome's documented rule is that receiving an event or calling an extension API resets the idle timer. `runtime.getPlatformInfo()` is the cheapest such call: it reads a constant and touches no storage, network or user data, and needs no permission. The interval is 20 seconds, a third of the 30-second window as margin for a late tick.

**Alternative considered:** `setInterval`. A chain of `setTimeout`s is used instead because each delay is computed (Decision 3).

**Alternative considered:** a `chrome.alarms` alarm every 20 seconds. Chrome clamps alarms to 30 seconds in current builds, which is too coarse for the 30-second window, and an alarm fires into a possibly dead worker rather than keeping a live one alive.

**Alternative considered:** an offscreen document or a `runtime.Port` held open from one. Rejected: it adds a permission (`offscreen`) and a page, for something one API call does.

### Decision 3: The keepalive cannot outlive the session

Four independent bounds, any one of which stops it:

1. **It asks first.** Each tick calls `vault.getLockState()` before pinging. That call evaluates the stored deadline and locks the vault if it has passed, and a tick that finds the vault locked stops without pinging. A read that throws also stops it: a keepalive that cannot prove the vault is unlocked does not run.
2. **The delay is shortened to land on the deadline.** The next tick is `min(20 s, lockAt - now)`, so a check runs at the deadline itself instead of up to 20 seconds after it. The keepalive therefore also locks the vault on time, as a side effect, while the worker is alive.
3. **A deadline further away than the longest auto-lock the product allows (`AUTO_LOCK_BOUNDS.max`, 60 minutes) is refused.** A damaged or tampered record cannot buy an unbounded run. This is the "bounded lifetime at most the configured auto-lock maximum" requirement.
4. **Every lock path stops it.** The background calls `keepAlive.stop()` from `vault.onLock`, which runs after manual lock, timeout lock and the lock-on-start paths. A lock that happens while a tick is mid-flight is handled by a generation counter: the stale tick does not ping and does not reschedule.

The keepalive starts from `vault.onUnlock`, so it runs for an unlock from any surface (popup, options, side panel, approval window) because the vault, not the surface, announces it. Starting twice leaves one timer. A settings change calls `refresh()`, which re-checks at once, so a shortened timeout is applied now rather than at the next tick.

A failed ping is not retried or reported. It changes nothing the keepalive can fix; if the worker is going to die, the vault fails closed.

### Decision 4: Lock reasons live in the session record and are labels

`LockState` in `storage.session` gains `lockReason` and, for a timeout, `inactivityMinutes`. Both are non-secret labels. `lock(reason = "manual")` writes them; `unlock` writes a fresh record without them. The values:

| Value | Set when |
| --- | --- |
| `manual` | The Lock button, or any caller that names no reason. |
| `inactivity` | `getLockState()` finds the deadline passed. Carries the elapsed minutes. |
| `background_restarted` | The record says unlocked and the worker holds no keys. |
| `state_unreadable` | The record is malformed, its `lastActivity` is not a finite positive number, or the read throws. |
| `clock_rollback` | `lastActivity` is in the future. |
| `browser_restarted`, `extension_updated` | The startup and install handlers lock on purpose. |

An absent record is the ordinary first state of a browser session and carries no reason. An unrecognised stored reason is ignored, not shown.

`state.getLock` already reduces a locked response to the fields the lock screen renders from; the two new labels are added to that projection and nothing else is.

The reason is recorded at the moment of locking, so a surface opened later reads the same answer. The popup learns of a lock either from the broadcast (which says that, not why) followed by an immediate re-read, or from its poll.

### Decision 5: A failed request is not a lock

`KeyManagerContext` exposes `lockCheckFailed` and `retryLockCheck()`. A rejected `getLockState()` sets the flag and leaves `isLocked` as the last answer the background gave; a later successful answer clears it. `MainApp` and the options gate show `BackgroundUnreachable` - "Can't reach Ostrilo", a retry button, no vault content - ahead of onboarding and ahead of the lock screen, because a silent background also yields an empty key list that would otherwise read as a first run.

The earlier behaviour ("unreachable background: assume locked") was fail-closed for the display but wrong about the fact. Nothing is disclosed by the new screen, and nothing can be signed while the background is unreachable.

The change to `KeyManagerContext` is deliberately confined to the lock-state plumbing: the initial load is now a callable `loadState` shared with the retry. The next change rehydrates key metadata and selection after unlock in the same file and builds on it.

### Decision 6: Firefox

The Firefox build is Manifest V3 with a `background.scripts` entry, which Firefox runs as a non-persistent event page. The keepalive runs there too, and `runtime.getPlatformInfo` is available, but Firefox decides event-page unloading by its own rules and an API call is not documented to defer it. An event page may therefore unload earlier than the configured timeout. When it does, the vault fails closed exactly as it does after a Chrome worker is ended, and the lock screen says "Locked because the browser restarted Ostrilo's background." That is the honest statement of what happened. This change does not try to defeat Firefox's lifecycle, and it does not claim to. `pnpm run build:firefox` must still pass.

## Risks / Trade-offs

- [Risk] The browser now holds the background alive, and decrypted keys with it, for up to the auto-lock timeout with no extension page open. -> Mitigation: that was always the vault's stated exposure window; the keepalive adds no new place a key lives and no new write. The deadline, the lock and the zeroization are unchanged. The accepted trade is exactly the one the owner chose: a signer that honours its setting over one that locks itself unpredictably.
- [Risk] A bug leaves the keepalive running after a lock. -> Mitigation: four independent bounds (Decision 3), tests for each, and a real-browser test that counts calls after a manual lock and expects none.
- [Risk] Chrome changes its idle rule, or stops counting `getPlatformInfo`. -> Mitigation: the vault still fails closed and says why; the e2e call count and the manual check in tasks.md are how it would be noticed.
- [Risk] Battery and wakeups: one API call per 20 seconds while unlocked. -> Accepted; it runs only during an unlocked session and stops at the deadline, which is at most 60 minutes after the last activity.
- [Risk] Firefox may still lock early. -> Documented above; the lock screen says so.

## Migration Plan

No data migration. The new fields exist only in `storage.session`, which the browser clears at the end of the session, and a record written by an older build has no reason, which reads as none. Rollback is removing the keepalive wiring and the reason fields; no stored data depends on either.

## Open Questions

- Should the lock screen offer a link to a short explanation when the reason is `background_restarted`? Deferred: the sentence is the whole of what is known.

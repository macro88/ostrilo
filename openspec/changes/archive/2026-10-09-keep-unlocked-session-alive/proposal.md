## Why

A user set auto-lock to 35 minutes and was locked out after one to two minutes, with the popup closed. The setting was honoured by the deadline arithmetic and ignored by the browser.

`KeyVaultService.getLockState()` treats "stored state says unlocked, but the background holds no decrypted keys" as a worker that was ended, and locks (`key-vault.service.ts`, the `this.unlocked.size === 0` branch). That is deliberate and stays. What was missing is anything that stopped the browser ending the worker. Chrome terminates an idle MV3 service worker about 30 seconds after its last event or extension API call; the keys live in that worker's memory and nowhere else; so with every extension page closed, an unlocked vault lasted about as long as the idle window, whatever `autoLockMinutes` said.

The deadline arithmetic itself is correct. Tests on a deterministic clock confirm 35 minutes is 2,100,000 ms, no timeout lock at 34:59, a lock at the deadline, and that a settings change or a new unlock replaces the old deadline. The unit-conversion, stale-snapshot and competing-alarm hypotheses are ruled out by them (see `design.md`).

Two smaller defects sat beside it. The lock screen gave no reason, so a timeout, a manual lock and an ended worker looked identical to the user, and the 35-minute report was undiagnosable from the product. And the UI treated a failed lock-state request as "locked", so a transport failure told the user to unlock a vault that might be open.

## What Changes

- **A bounded keepalive while unlocked.** From a successful unlock on any surface until the vault locks by any path, the background makes one cheap extension API call (`runtime.getPlatformInfo()`) about every 20 seconds, which resets Chrome's idle timer. It holds no secret and writes nothing. Every tick asks the vault first and the vault enforces its deadline as it answers, so the keepalive cannot outlive the auto-lock.
- **A recorded lock reason.** The session lock record carries a non-secret `lockReason`: `manual`, `inactivity`, `background_restarted`, `state_unreadable`, `clock_rollback`, `browser_restarted` or `extension_updated`, plus the elapsed `inactivityMinutes` for a timeout. `state.getLock` reports it while locked.
- **The lock screen says why**, in short plain sentences chosen by the UI ("Locked after 35 minutes without activity.", "Locked because the browser restarted Ostrilo's background.").
- **A failed lock-state request is not a lock.** Surfaces show "Can't reach Ostrilo" with a retry, and no vault content, instead of the lock screen.
- **A hole closed on the way:** a stored `lastActivity` of `NaN` compared false against every deadline and read as a session that never expires. It now fails closed as `state_unreadable`.
- **Not changed:** decrypted keys are never persisted anywhere. If the worker still dies (browser update, crash, memory pressure, Firefox event-page unload), the vault still fails closed, and the lock screen says so.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `session-auto-lock`: three requirements added. The inactivity deadline is exactly the configured timeout; the background is kept alive while unlocked, bounded by the deadline; every lock records why.
- `unlock-feedback`: two requirements added. The lock screen states why the vault is locked; an unreachable background is not shown as a locked vault.

## Impact

**Code**
- `src/infrastructure/lifecycle/session-keepalive.ts` (new): the keepalive, with its ping and lock-state read injected.
- `src/extension/background.ts`: constructs it, starts it on `vault.onUnlock`, stops it on `vault.onLock`, refreshes it when the settings change; startup locks carry a reason.
- `src/application/services/key-vault.service.ts`: `lock(reason)`, reason-bearing `getLockState()`, and `NaN`-safe deadline evaluation.
- `src/domain/types.ts`: `LockReason`, `LOCK_REASONS`, `isLockReason`.
- `src/infrastructure/messaging/rpc.ts`, `rpc-router.ts`: `LockStatePayload` and the locked projection of `state.getLock` carry the two new fields.
- `src/ui/state/KeyManagerContext.tsx`, `MainApp.tsx`, `OptionsApp.tsx`, `LockScreen.tsx`, `BackgroundUnreachable.tsx`, `lock-reason.ts`.

**Manifest:** no new permission. `runtime.getPlatformInfo` needs none.

**Behaviour users will notice:** a vault left unlocked with no extension page open now stays unlocked until the configured timeout, as the slider says, and the browser holds the background alive for that long. The timeout is still measured from the last activity, not from unlock. An unlocked vault no longer lets the browser reclaim the background's memory; that is the price of the owner's decision.

**Not in scope**
- Rehydrating key metadata and selection in the UI after an unlock (OSTR 05).
- Persisting keys, a password or a derived key across worker death. Rejected again in `design.md`.
- A Firefox-specific keepalive. See the caveat in `design.md`.

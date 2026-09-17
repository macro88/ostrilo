## Context

Ostrilo has the vocabulary of auto-lock but none of the machinery.

- `LockState` in `src/application/services/key-vault.service.ts:17-21` already carries `lastActivity`, and `unlock()` and `lock()` both write it. Nothing ever reads it.
- `autoLockMinutes` defaults to `15` at `settings.service.ts:121`, feeds `AutoLockSlider` in both `BasicSettings` and `SecuritySettingsTab`, and is read once by `Header.tsx:17-19` to render `Unlocked · 15m`.
- There is no `chrome.alarms` or `browser.alarms` usage anywhere in `src/`, no idle detection, and no timer that calls `lock()`. Neither generated manifest requests `alarms` or `idle`.
- The only caller of `lock()` in the codebase is the manual header button path at `src/ui/state/KeyManagerContext.tsx:150`.

The README advertises "Session Management: Automatic locking with configurable timeouts", so the product claims a protection it does not provide.

Three things make a naive fix dangerous.

**An accidental partial mitigation already exists.** The MV3 service worker is terminated after roughly 30 seconds idle, which destroys the in-memory `unlocked` Map at `key-vault.service.ts:24`. But `lockState` in `chrome.storage.session` still says unlocked, so the extension then presents an unlocked vault with an empty key map. `ensureUnlockedKey` (`key-vault.service.ts:383-389`) throws `no_unlocked_key`, which the catch block in `src/infrastructure/messaging/handlers/nostr-rpc.ts:316-336` does not map. The user sees a misleading `denied` rather than `locked`. So today's apparent safety comes from the worker dying, and it surfaces as the wrong error. Anything that makes the timer reliable by keeping keys alive across worker death would remove this accident and make the product strictly worse.

**The lock state fails open.** `getLockState()` at `key-vault.service.ts:378-381` returns `{ isLocked: !!state?.isLocked }`. After every browser restart, before anything is unlocked, session storage holds no `lockState`, `state` is `undefined`, `!!undefined` is `false`, and the vault reports UNLOCKED. `handleGetPublicKey` at `nostr-rpc.ts:60-85` checks only that lock state and then reads the pubkey out of local storage, so the user's Nostr identity leaks from a vault that was never opened. Note the asymmetry: `PolicyService.loadContext` at `policy.service.ts:33` computes `unlocked = lock?.isLocked === false`, which is already fail-closed, and `evaluatePolicy` returns `{ mode: "deny", reason: "locked" }` first. So `nostr.signEvent` is caught by the second gate and mapped back to `LOCKED` at `nostr-rpc.ts:162-171` with a "vault check passed but policy check failed!" warning. The two gates disagree, the warning is the symptom, and `getPublicKey` has no second gate at all.

**The options page has no lock check.** `MainApp.tsx:32-36` renders `LockScreen` when locked, but `src/extension/options/OptionsApp.tsx` never reads lock state. With the vault locked, the options page exposes every key label and pubkey, every origin policy (a record of which Nostr sites the user visits), the relay list, and the activity log with content previews of everything signed, and it permits mutation. The concrete chain: brief physical access to a locked browser, open options, set an origin to `high` trust, walk away; after the next unlock that site signs silently and no prompt ever appears.

Two smaller defects sit in the same code. `unlock()` at `key-vault.service.ts:300-346` reports success and writes `isLocked: false` without verifying anything when the vault holds zero key records, because `records.map` over an empty array resolves immediately. And two shipped defaults disagree: `src/domain/types.ts:62` says `autoLockMinutes: 5` while `settings.service.ts:121` says `15`. Both are live, because `useAppSettings` merges `DEFAULT_SETTINGS_V1` over whatever the background returns.

One property is genuinely right and must survive this change: decrypted private keys live only in the in-memory `unlocked` Map inside the background service worker. They are never written to `chrome.storage.session`, never persisted, and never sent across a message boundary. The only session-storage writes are lock state and session grants. Many MV3 signers persist the unlocked key or the password to survive worker termination, which is far worse than a signer that asks for a password again.

## Goals / Non-Goals

**Goals:**

- Enforce `autoLockMinutes` so an unattended unlocked signer locks itself.
- Make lock state fail closed, so a vault that was never unlocked is never treated as unlocked.
- Make the lock survive service-worker death, missed alarms, browser restart, and sleep.
- Tell the truth about lock status in both the UI and the RPC error codes.
- Gate the options page behind the lock screen and enforce the lock in the handlers, not the UI.
- Require password re-authentication for high-risk actions while unlocked.
- Reconcile the conflicting defaults and remove the never-lock option.
- Keep decrypted key material in background memory only.

**Non-Goals:**

- No biometric or WebAuthn unlock.
- No gradual or tiered lock that restricts some operations before others (PRD `SEC-012` describes this; only the flat lock ships here).
- No `idle` permission and no OS idle or screen-lock detection.
- No consent gate on `nostr.getPublicKey`; that belongs to `fix-consent-policy-defects`.
- No password policy or password change flow; that belongs to `enforce-password-policy`.
- No broader manifest or CSP work; that belongs to `harden-manifest-and-build`.
- No key-derivation changes.

## Decisions

### Decision 1: Schedule the lock with alarms, never with `setTimeout`

Use `browser.alarms` and add the `alarms` permission to `wxt.config.ts:12`, which currently declares `["storage", "sidePanel", "windows"]` and flows into both generated manifests.

A `setTimeout` in an MV3 service worker cannot work. Chrome terminates the worker after roughly 30 seconds of inactivity, and a pending timer is destroyed with it. The worker is not resurrected to run a timer callback; it is woken only by a registered event, of which an alarm is one. So a `setTimeout(lock, 15 * 60_000)` scheduled at unlock is guaranteed not to fire in the common case. Alarms persist across worker termination and wake the worker to run the handler.

Alarm granularity is a real constraint. Chrome clamps alarm scheduling to a platform minimum in packaged builds (historically one minute, reduced to 30 seconds in recent versions), and shorter delays are silently raised. That means the alarm alone cannot lock at a precise sub-minute boundary, and it cannot honour a hypothetical 30-second timeout. Two consequences: the minimum selectable timeout becomes one minute (Decision 8), and correctness must not depend on the alarm's precision at all (Decision 2). The alarm's job is to promptly zeroize memory and update the UI, not to be the thing that decides whether the vault is open.

Firefox MV2 has a persistent background script, so a timer would survive there, but `browser.alarms` is available in Firefox with the same permission and keeps both browsers on one code path.

**Alternative considered:** a long-lived `chrome.runtime.Port` from an open UI surface to keep the worker alive, with a plain timer. That works only while a UI surface is open, inverts the incentive (an open options tab would keep the vault alive precisely when the user has walked away), and burns battery. Rejected.

**Alternative considered:** persist the unlocked key or the password to `chrome.storage.session` so the timer can be re-derived and signing can continue across worker death. This is what makes several MV3 signers weaker than they look, and it would delete the one property this codebase gets right. Rejected explicitly.

### Decision 2: Derive lock state from `lastActivity` on every privileged access

`getLockState()` becomes a computation, not a field read: the vault is unlocked only if stored session state explicitly records `isLocked === false` **and** `now - lastActivity < autoLockMinutes * 60_000`. Every privileged access re-evaluates this, so a dead worker, a clamped alarm, or an alarm that was never re-armed cannot leave a stale open session behind. The alarm becomes an optimization; the timestamp check is the enforcement.

`lastActivity` is already in the `LockState` type and already written by `unlock()` and `lock()`, so this reads a field the code has been maintaining and ignoring.

Honest limitation: `Date.now()` is a clock the user controls. Someone with local control of the machine can set the clock backwards to extend an unlocked window. Two mitigations, neither complete. A `lastActivity` in the future is treated as expired, so moving the clock backwards after unlock fails closed rather than open. And moving the clock forwards locks early, which is the safe direction. There is no trustworthy monotonic clock available across worker restarts; `performance.now()` resets with the worker.

What this does and does not protect. It protects against an unattended unlocked browser, against a page quietly reusing a session the user believes has ended, and against the vault surviving a restart. It does not protect against an attacker who already has OS-level control of the browser profile: that attacker can read the encrypted key records out of `chrome.storage.local`, install a modified extension, or attach a debugger, and no timestamp defends against any of that. Auto-lock is a bound on exposure window, not an access-control boundary against a local root adversary.

### Decision 3: Make `getLockState` fail closed

Change `isLocked: !!state?.isLocked` to `isLocked: state?.isLocked !== false`, then apply the deadline check from Decision 2. Callers whose behaviour changes:

- `StateRpcHandler.handleGetLock` (`state-rpc.ts:27-30`), which feeds `KeyManagerProvider`'s initial load (`KeyManagerContext.tsx:96-105`). A fresh browser start now renders `LockScreen` via `MainApp.tsx:32` instead of the home view.
- `NostrRpcHandler.handleGetPublicKey` (`nostr-rpc.ts:60-69`). This is the leak: it now returns `locked` instead of reading the selected key's pubkey out of local storage and handing it to the page.
- `NostrRpcHandler.handleSignEvent` (`nostr-rpc.ts:112-126`). Behaviour is largely unchanged in outcome, because `PolicyService.loadContext` was already fail-closed and produced `deny/locked`, but the error now originates from the correct gate and the "vault check passed but policy check failed!" warning at `nostr-rpc.ts:164-166` becomes unreachable.
- `NostrRpcHandler.handleSignEvent`'s policy branch, `PolicyService.evaluate`, and every handler newly gated by Decision 6, which all now agree on one definition of locked.
- `KeyVaultService.selectKey` (`key-vault.service.ts:238-244`), which only refreshes the session record when `state.isLocked === false`; unchanged in logic but now consistent with the single definition.

One regression to guard against: `MainApp` checks `needsOnboarding` before `isLocked`, and `useOnboarding` derives `isFirstRun` from `!hasKeys && !settings.onboardingCompleted`, where `hasKeys` comes from `keys.list`. If `keys.list` were gated behind the lock, a locked vault with existing keys would report `hasKeys: false` and render onboarding instead of the lock screen. `keys.list` therefore must stay reachable while locked (Decision 6).

### Decision 4: Reconcile lock state with a background that lost its keys

Locking is not only a stored flag; it is also the absence of key material. Add an internal check for whether the `unlocked` map holds material, and treat "session says unlocked, key records exist, memory is empty" as locked: correct the stored lock state to locked and report locked.

Then fix the error mapping so the UI and pages hear the truth. Both `no_unlocked_key` and `key_locked_or_missing` from `ensureUnlockedKey` must map to `RPC_ERROR_CODES.LOCKED` in `nostr-rpc.ts:316-336` and in the vault handler's error translation. Today only `key_locked_or_missing` is mapped, so the common case after worker death falls through to the generic `DENIED` at `nostr-rpc.ts:332-335`. A user whose vault simply needs unlocking is told the site was denied, which is the single most confusing failure this extension currently produces.

**Alternative considered:** treat an empty `unlocked` map as authoritative and silently re-lock without correcting the stored state. That leaves the stored state lying to the next reader and makes the bug reappear per call site. Correcting the record once is cheaper and self-healing.

### Decision 5: Define activity narrowly and record it without a keepalive

Activity is a deliberate user action in an extension surface, or a completed privileged operation:

- unlock, explicit key selection, an approval decision, a signature actually produced, a settings or policy mutation, and opening the popup, sidepanel, options tab, or approval window.

Not activity: background bookkeeping such as badge updates and `queue.updated` broadcasts, relay traffic, storage reads, and `state.getLock` polling from a UI that is only rendering the lock screen. That last exclusion matters: without it, a permanently open options tab polling lock state would hold the vault open forever, which is the exact scenario auto-lock exists to close.

Mechanism: a new `state.touch` RPC that UI contexts call on genuine interaction, throttled client-side to at most one call per 30 seconds so a busy surface does not wake the worker repeatedly. The background writes `lastActivity` into the existing session `lockState` record and re-arms the alarm. Because Decision 2 reads the timestamp on demand, a closed surface simply stops refreshing it. No port, no keepalive, no artificial worker lifetime.

**Alternative considered:** derive activity from any RPC traffic. Simpler, but it makes polling and background bookkeeping count as user presence, which silently defeats the timeout.

### Decision 6: Gate the lock in the handlers, and gate the options page in the UI

Two layers, because the UI is not a security boundary.

UI: `OptionsApp` reads lock state through the same `useKeyManager()` path `MainApp` uses and renders `LockScreen` before any `Tabs` content, so no key label, pubkey, origin policy, relay entry, or activity preview is ever rendered while locked, and no mutation control exists to click. Because `OptionsApp` already wraps everything in `KeyManagerProvider`, this is a check at the top of the component, not a new data path.

Handlers: one shared `assertUnlocked` guard, applied so that an unclassified method is privileged by default.

Lock-gated: `settings.update`, `policy.setOrigin`, `policy.setKindRule`, `policy.setSession`, `policy.clearSession`, `policy.removeOrigin`, `policy.evaluate`, `vault.select`, `vault.renameKey`, `vault.deleteKey`, `vault.sign`, `vault.export`, `vault.reveal`, `nostr.getPublicKey`, `nostr.signEvent`, `approval.resolve`, all `activity.*`, all `profile.*`.

Reachable while locked, because the user must be able to unlock: `vault.unlock`, `state.getLock`, `keys.list`, `crypto.evaluatePassword`, `crypto.parsePrivateKey`, `settings.get`.

The two reachable read methods need reducing rather than blocking, because both leak while serving a legitimate need:

- `keys.list` returns full `KeyRecord[]` including labels, pubkeys, and ciphertext, but the only locked-state consumers are `LockScreen`'s `hasKeys` and `useOnboarding`'s `isFirstRun`. While locked it should return only what distinguishes "keys exist" from "first run".
- `settings.get` returns everything including `origins`, the record of which Nostr sites the user uses. The lock screen needs only `theme` (for `useTheme`), `sidePanel`, and the onboarding flags. While locked it returns that projection. This is safe for the UI because `useAppSettings` already merges `DEFAULT_SETTINGS_V1` over the response (`useAppSettings.ts:103-106`), so omitted fields read as defaults: an empty origin list and the default relay list, which is exactly the desired locked view.

**Alternative considered:** block `settings.get` entirely while locked. The lock screen then cannot resolve the theme and flashes the wrong palette, and `useOnboarding` cannot distinguish a first run from a locked vault. Rejected in favour of the projection.

### Decision 7: Re-authenticate high-risk actions using the `vault.reveal` pattern

`revealKey` at `key-vault.service.ts:473-520` already does this correctly: it takes the password, derives a key from the target record's salt, decrypts to prove the password, and zeroizes in a `finally`. Extract that verification into a reusable primitive and use it for deleting a key, revealing or exporting a private key, raising an origin to `high` trust, setting a per-kind rule to `allow`, enabling a session grant, and changing the auto-lock or session TTL timeout.

Two details. The primitive must fail when the vault holds zero key records, because there is nothing to verify against; `validatePasswordAgainstExistingKeys` at `key-vault.service.ts:97-125` returns early in that case, which is correct for adding the very first key but must not be reused as an authorization check. And renaming a key is deliberately excluded: a label change grants no privilege and is trivially reversible, so it requires an unlocked vault but not a password.

Fixing `unlock()` uses the same primitive. An unlock against a vault with zero key records currently resolves `Promise.all([])` immediately and writes `isLocked: false`; it must instead fail with a distinct empty-vault error and leave the stored state locked.

**Alternative considered:** a short verified window (say 60 seconds) after one successful re-authentication, so a multi-step flow prompts once. Better ergonomics, more state to get wrong, and it re-introduces a small "recently authorized" session of exactly the kind this change is trying to bound. Left as an open question.

### Decision 8: One shipped default of 5 minutes, range 1 to 60, no never-lock

Define the default once in `src/domain/types.ts` and have `settings.service.ts` import it instead of restating `15`. Ship 5 minutes: this is a signing key, the domain layer already declares 5, and the cost of re-entry is bounded because no UI surface holds anything sensitive across a lock.

Remove the never-lock option. `AutoLockSlider` currently has `min = 0` and labels `0` as "Never", `Header.tsx:17` special-cases `0` as plain "Unlocked", and `AppSettingsPatchSchema:41` accepts `0` to `1440`. In a signer, never-lock means the decrypted key stays resident for the life of the worker and every site policy stays live indefinitely, which is the precise hazard this change exists to remove. New range: whole minutes 1 to 60, in the schema, in the slider, and in the settings service normalization. The 24-hour ceiling goes with it; a signer left unlocked for a day is not a configuration worth supporting.

`sessionTTLMinutes` keeps `0` with its own distinct meaning. Per `src/domain/types.ts:50` and `PolicyService.setSessionGrant` at `policy.service.ts:161`, `0` stores an expiry of `0`, which `evaluate` at `policy.service.ts:48` reads as "no expiry", meaning "until lock". That meaning is now backed by a lock that actually happens, and `lock()` already clears `sessionGrants` at `key-vault.service.ts:359`, so `0` is safe to keep. Only the ceiling changes, from 1440 to 60, so a grant cannot be configured to outlive any session it is scoped to.

### Decision 9: Lock on browser close and start; skip the `idle` permission

Browser close is handled by construction once Decision 3 lands: `chrome.storage.session` is cleared when the browser closes, and a missing record now reads as locked. This is why the fail-closed change is the actual fix for "lock on browser close" rather than a separate feature.

Add `runtime.onStartup` and `runtime.onInstalled` handlers that explicitly write locked lock state, clear `sessionGrants`, and clear any stale `sessionGrantAll` display flags, so the first read after a restart, install, or update is unambiguous rather than merely absent.

Do not request the `idle` permission in this change. `chrome.idle.onStateChanged` can report `locked` on OS screen lock, but the permission reads to a store reviewer and to a user as "detect when you are away from your computer", the `locked` state is not reported uniformly across platforms, and the Decision 2 timestamp check already produces the correct outcome the moment the machine wakes and anything privileged is attempted: a sleeping machine generates no activity, so the deadline passes during sleep. The residual gap is that key material may remain in worker memory during a short sleep if the worker survives it, which in practice it usually does not. This keeps the permission diff to exactly one entry and can be revisited if the ergonomics justify the review cost.

Note that `openspec/project.md` still claims "Minimal manifest permissions: only `storage` and `sidePanel`", which the built manifests already contradict by including `windows`. That line needs correcting alongside the `alarms` addition.

## Risks / Trade-offs

- [Risk] A 5-minute default annoys users into raising the timeout to 60 or abandoning the extension. -> Mitigation: approvals, signatures, and settings changes all count as activity, so active use never locks mid-task; the lock screen returns the user to the surface and options tab they were on; the range top of 60 minutes remains available for users who accept the trade.
- [Risk] The `alarms` permission appears in the Chrome Web Store listing and invites review questions for a signer. -> Mitigation: `alarms` is not a sensitive-data permission and triggers no additional data-use disclosure; the listing and README should state plainly that it exists solely to lock the vault on a timer, and no other feature in the extension may use it.
- [Risk] A partial fix reports locked in the UI while a signing path stays live, or vice versa. This is the worst outcome available here. -> Mitigation: one `assertUnlocked` guard shared by every privileged handler, one definition of locked shared by `getLockState` and `PolicyService.loadContext`, and a test that enumerates the `RpcRequest` union and asserts a lock disposition for every member, so a newly added method fails the suite until it is classified.
- [Risk] Clock changes weaken the timestamp check. -> Mitigation: a future `lastActivity` is treated as expired, so backwards clock movement fails closed; forwards movement locks early. Documented as a residual weakness against a local adversary, who has stronger attacks available anyway.
- [Risk] Alarm clamping means a 1-minute timeout locks later than requested. -> Mitigation: the timestamp check refuses privileged operations at the exact deadline regardless of when the alarm runs; the alarm's lateness only delays memory zeroization and the UI transition, and the UI shows the enforced timeout rather than implying second-level precision.
- [Risk] The reduced `settings.get` projection while locked breaks a consumer that assumes full settings. -> Mitigation: `useAppSettings` already merges defaults over the response, and the projection is covered by tests for both the locked and unlocked shapes.
- [Risk] Gating `keys.list` would make a locked vault render onboarding instead of the lock screen, since `MainApp` checks `needsOnboarding` first. -> Mitigation: `keys.list` stays reachable while locked in reduced form, with an explicit test that a locked vault holding keys renders the lock screen and not onboarding.
- [Risk] Firefox `storage.session` and `browser.alarms` behaviour differs from Chrome. -> Mitigation: `storage.session` clearing on browser close and alarm firing after background restart are verified against the Firefox MV2 build, not assumed from the Chrome build.
- [Risk] Re-authentication prompts on high-risk actions add friction and may push users toward keeping trust levels high to avoid prompts. -> Mitigation: re-authentication is required for raising trust and not for lowering it, so the friction is asymmetric in the safe direction.

## Migration Plan

1. No key re-encryption and no change to stored key records. Encryption parameters, salts, and ciphertext are untouched.
2. On the first `SettingsService.get()` after upgrade, normalize the auto-lock settings in place: `autoLockMinutes` of `0`, the former "Never" value, becomes the shipped default of 5, because `0` no longer has a meaning; values above `60` are clamped to `60`; values below `1` are raised to `1`. `sessionTTLMinutes` is clamped to `0` through `60`, preserving `0` as "until lock".
3. Leave in-range explicit values alone, including `15`. A stored `15` cannot be distinguished from a deliberate choice of 15, so it is preserved rather than silently reduced to 5. Only values that are no longer representable are migrated.
4. `runtime.onInstalled` writes locked lock state, so the upgrade lands with the vault locked and the user unlocks once. This is also the moment the fail-closed change becomes visible, and it should be called out in the release notes so a locked extension after update does not read as a bug.
5. Rollback: revert the `getLockState` expression, remove the alarm registration and the `alarms` permission, and remove the handler guards. Stored settings remain valid under the previous schema because the new accepted range is a strict subset of the old one, and the normalized values are all still legal there.

## Open Questions

- Should a successful re-authentication open a short verified window (for example 60 seconds) so a multi-step high-risk flow prompts once, or should every high-risk action prompt individually?
- Should the UI warn shortly before an automatic lock, and if so, does dismissing the warning count as activity?
- Should the reduced `keys.list` response while locked also omit the encrypted `ct`, `iv`, and `salt` fields, given that the same ciphertext is readable from `chrome.storage.local` by anything with profile access?
- Is the `idle` permission worth requesting in a follow-up to lock on OS screen lock, and does the store-listing cost outweigh closing the sleeping-worker gap?

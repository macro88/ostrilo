## Why

Ostrilo advertises "Session Management: Automatic locking with configurable timeouts" and shows `Unlocked · 15m` in the header, but nothing in the extension ever locks the vault on a timer. `autoLockMinutes` defaults to `15` in `settings.service.ts`, drives two sliders, and is read once for a label. There is no `alarms` usage, no idle detection, and no timer that calls `lock()`; the only caller of `lock()` is the manual header button. A user who walks away from an unlocked signer stays unlocked until the browser closes.

Worse, the lock state itself fails open. `getLockState()` returns `isLocked: !!state?.isLocked`, so the missing session record that exists after every browser restart reports the vault as UNLOCKED, and `nostr.getPublicKey` hands the user's Nostr identity to any page from a vault that was never opened. The options page has no lock check at all, so a locked browser still exposes every key label and pubkey, every origin policy, the relay list, and activity-log content previews, and still permits mutation: brief physical access is enough to raise a site to high trust and have it sign silently after the next unlock.

## What Changes

- Enforce `autoLockMinutes` for real: lock the vault, zeroize in-memory key material, and clear session grants once the configured inactivity window elapses.
- Derive lock state from the stored `lastActivity` timestamp on every privileged access, so a terminated MV3 service worker or a missed alarm can never skip the lock.
- Schedule the lock with the extension alarms API and add the `alarms` permission. A `setTimeout` in an MV3 service worker dies with the worker and can never fire.
- **BREAKING** Make `getLockState()` fail closed. Absent or unrecognised session lock state now reports LOCKED. A fresh browser start shows the lock screen and `nostr.getPublicKey` returns `locked` instead of leaking the selected pubkey.
- Reconcile lock state with lost key material: when session storage claims unlocked but the background holds no decrypted keys, report locked and return the `locked` RPC error rather than the misleading `denied` produced today by the unmapped `no_unlocked_key`.
- Record activity from deliberate user actions across popup, sidepanel, options tab, and approval window, throttled, without keeping the service worker alive artificially.
- Gate the options page behind the lock screen, and enforce an unlocked vault inside the RPC handlers for settings, policy, activity, and key mutation instead of trusting the UI.
- Require password re-authentication for high-risk actions while unlocked, following the existing `vault.reveal` verification pattern.
- **BREAKING** Fix `unlock()` reporting success without verifying the password when the vault holds zero key records.
- **BREAKING** Reconcile the two conflicting shipped defaults (`5` in `src/domain/types.ts`, `15` in `settings.service.ts`) to a single value, and remove the "Never" auto-lock option. A signer that never locks is the hazard this change exists to remove.

Biometric or WebAuthn unlock, a gradual or tiered lock, the `idle` permission, and the `nostr.getPublicKey` consent gate owned by `fix-consent-policy-defects` do not ship in this change.

## Capabilities

### New Capabilities

- `session-auto-lock`: Inactivity-driven vault locking, fail-closed lock state, activity recording, and the lock-gated RPC surface.

### Modified Capabilities

- `key-vault`: Unlock must verify the password even with an empty vault, automatic lock must zeroize, unlocked key material must stay in background memory only, and high-risk vault actions must re-authenticate.
- `ui-options-page`: The options page entrypoint must render the lock screen while the vault is locked, and the Security tab must expose an enforced, bounded auto-lock timeout.

## Impact

- `KeyVaultService`: `getLockState`, `unlock`, `lock`, and `ensureUnlockedKey` change behaviour; a password-verification primitive and an activity-touch path are added.
- Background entrypoint: alarm registration, `runtime.onStartup` and `runtime.onInstalled` lock initialisation, and lock-triggered approval-queue teardown.
- Manifest: `alarms` joins `storage`, `sidePanel`, and `windows` in `wxt.config.ts`, which flows into both generated manifests.
- RPC layer: a shared unlocked-vault guard across vault, policy, settings, activity, and profile handlers; a new activity-touch method; `no_unlocked_key` mapped to the `locked` error code.
- Settings: one shipped default for `autoLockMinutes`, a narrowed validation range for `autoLockMinutes` and `sessionTTLMinutes`, and normalization of stored out-of-range values.
- UI: `OptionsApp` lock gating, `AutoLockSlider` range, `SessionTTLSlider` range, and the `Header` lock label.
- Tests: unit coverage for fail-closed lock state on empty session storage, timeout expiry, empty-vault unlock rejection, and the lock-gated method table; Playwright coverage for lock, unlock, and the options page while locked.
- Docs: the README session-management claim, the stale minimal-permissions line in `openspec/project.md`, and PRD `SEC-012`.

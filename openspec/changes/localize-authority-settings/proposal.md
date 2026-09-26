## Why

Every setting that grants authority is stored in `storage.sync`, and browser sync copies it to every browser signed into the same account. That breaks the rule the rest of the security model is built on: **authority is granted by entering this vault's password.**

On this device, raising a site to `high` trust, adding a per-kind `allow` rule, granting identity disclosure, and changing the auto-lock or session timeout each require the password (`key-vault`, "High-Risk Vault Actions Require Password Re-Authentication"). All of them are then written into the single `appSettings` item in `storage.sync` (`settings.service.ts:46, 104, 136, 165`; `policy.service.ts:32, 102, 107, 271`; `key-vault.service.ts:72, 375, 429, 448, 790`). On every other synced browser the grant takes effect without that browser's password. That browser may hold a different vault, a different password or different keys.

Consequences, from the 2026-09-25 competitor review and the follow-up analysis:

- **A compromised browser account becomes silent signing.** Someone holding the user's Google or Firefox account login can:
  1. Install Ostrilo in their own browser.
  2. Create a throwaway vault.
  3. Grant `high` trust to a site they control, using their own password.

  The grant syncs to the victim's devices. There the extension signs the high-trust allowlist without a prompt: reposts, reactions, mute, pin and bookmark lists, the NIP-65 relay list (kind 10002), and application data. It also discloses the victim's public key. Protected kinds still prompt, so this is bounded, but it crosses a line the product tells users holds. The mechanism follows from the storage code and the Web Store extension id being the same everywhere. It has not been demonstrated end to end.
- **Egress and retention are remotely settable.** The relay list, the profile-upload endpoint and the activity-log retention sync too. A remote value can point this device's profile lookups at a relay of the attacker's choosing, redirect uploads, or shrink retention and delete local activity history.
- **It fails on quota before anyone attacks it.** Every setting lives in one item under sync's 8 KB per-item quota, so with enough site records every settings write fails. `lock()` also writes the item on every lock (`key-vault.service.ts:790`), spending sync's write-rate budget and fanning the change out to every device.
- **Device-specific values leak across devices.** `selectedKeyId` names a key that may not exist on another device, and onboarding completion is per install.
- **Privacy.** The list of sites a user uses Nostr on is copied to the browser vendor. `PRIVACY.md` discloses this honestly, but the product has no need to send it.

## What Changes

- Store `appSettings` in `storage.local`. Browser sync no longer copies trust levels, rules, disclosure consent, timeouts, `mediumAllowKinds`, the relay list, the upload endpoint, activity retention, the selected key, onboarding flags or theme.
- Keep `storage.sync` for the docked-panel flag only. It is already a separate key, and a remote change to it can do nothing but move the UI.
- Route every read and write of `appSettings` through one settings store, so no service can reach `storage.sync` for settings again. Add a security test that fails on any other use of the sync area under `src/`.
- Migrate once, losslessly. On the first read after upgrade, copy an existing `appSettings` from sync into local when local has none, keeping every grant exactly as it was. Leave the sync copy in place for this release, so a device still running an older version keeps its settings during a staggered update. Removing the stale copy is a follow-up, tracked on the roadmap.
- **BREAKING (behaviour)** Settings stop following the user between browsers. A user with two browsers approves a site once on each, and sets theme and relays on each. Cross-device sync of this data is future work on a mechanism that can authenticate its author (SYNC-005, and PROTO-009 for relays via NIP-65), not browser sync.
- Update `PRIVACY.md`, `docs/extension-manifest.md` and the roadmap's SYNC-001 and SYNC-006 rows to describe what syncs after the change.

## Capabilities

### New Capabilities

- `settings-storage-locality`: which settings may be stored in browser-synced storage, the single path through which settings are persisted, and the one-time migration from sync to local.

### Modified Capabilities

None. No existing requirement names the storage area. The `ui-options-page` "Cross-Context Settings Sync" requirement is about popup and options-page propagation on one device, and continues to hold.

## Impact

- New application-layer settings store: the only owner of the `appSettings` item. `SettingsService`, `PolicyService` and `KeyVaultService` read and write through it rather than calling `storage.sync` directly.
- `src/extension/background.ts`: the `storage.onChanged` handler that re-arms auto-lock and rebuilds the relay manager must react to the local area. It is area-agnostic today; a test pins that down. The migration also runs eagerly on startup and install/update.
- Tests: the unit and integration fixtures that seed `storage.sync` with `appSettings` (about 20 files), and `tests/e2e/profile-edit.spec.ts:338`. Plus a new security test for sync-area usage and a migration test.
- Docs: `PRIVACY.md` (a material change to what leaves the device), `docs/extension-manifest.md`, `docs/vault-storage-format.md` if it describes settings placement, and `docs/roadmap.md`.
- Relationship to other changes. This resolves the open question recorded in `harden-origin-and-password-boundaries`, and reduces that change's `lock()` fix to defence in depth, since `storage.local` has no 8 KB item quota. Whichever of the two lands second writes the final `docs/extension-manifest.md` wording.
- No new permission, dependency or network behaviour. `storage` already covers both areas.

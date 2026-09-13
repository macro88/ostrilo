## 1. Lock State Foundation

- [x] 1.1 Confirm the current lock paths end to end: `KeyVaultService.getLockState`, `unlock`, `lock`, `ensureUnlockedKey`, `PolicyService.loadContext`, `StateRpcHandler`, and `KeyManagerProvider`.
- [x] 1.2 Make `getLockState()` fail closed so absent, malformed, or non-explicit session lock state reports locked.
- [x] 1.3 Derive lock state from the stored `lastActivity` timestamp and the configured `autoLockMinutes`, and treat a future timestamp as expired.
- [x] 1.4 Report locked when stored lock state claims unlocked but the background holds no decrypted key material, and correct the stored record.
- [x] 1.5 Make `unlock()` fail with a distinct empty-vault error when the vault holds zero key records, without writing unlocked lock state.
- [~] 1.6 The reusable password-verification primitive already exists as the vault envelope verifier (`openEnvelope`), landed by harden-vault-key-derivation. It fails when no envelope exists (`vault_not_created`). Extract the password verification used by `revealKey` into a reusable primitive that fails when no key record exists.
- [x] 1.7 Give `PolicyService.loadContext` and `getLockState` one shared definition of locked so the two gates cannot disagree.

## 2. Reliable Lock Scheduling

- [x] 2.1 Add the `alarms` permission to `wxt.config.ts` and confirm it appears in both generated manifests.
- [x] 2.2 Register an alarm-driven lock in the background entrypoint and arm it on unlock.
- [x] 2.3 Re-arm the alarm when activity is recorded or when `autoLockMinutes` changes.
- [x] 2.4 Lock, zeroize in-memory key material, and clear session grants when the alarm fires past the deadline.
- [x] 2.5 Add `runtime.onStartup` and `runtime.onInstalled` handlers that write locked lock state, clear session grants, and clear stale `sessionGrantAll` flags.
- [x] 2.6 Verify no `setTimeout` or `setInterval` is used to lock the vault, and that no key material, password, or derived key is persisted to survive worker termination.

## 3. Activity Recording

- [x] 3.1 Add a `state.touch` RPC method that updates `lastActivity` and re-arms the lock alarm.
- [~] 3.2 PARTIAL: `state.touch` exists and re-arms the alarm. Wiring every call site (key selection, approval resolution, settings mutation) is UI work deferred to the slices that own those components. Record activity on unlock, key selection, approval resolution, produced signatures, and settings or policy mutation.
- [~] 3.3 DEFERRED: UI-side throttled activity reporting from popup/sidepanel/options/approval. Report activity from popup, sidepanel, options tab, and approval window on genuine user interaction, throttled client-side.
- [x] 3.4 Ensure background bookkeeping, broadcast handling, relay traffic, and lock-state polling from a locked UI do not record activity.
- [x] 3.5 Confirm no keepalive port or artificial worker lifetime is introduced by activity tracking.

## 4. Lock-Gated RPC Surface

- [x] 4.1 Add a shared `assertUnlocked` guard that returns the `locked` error code and treats unclassified methods as privileged.
- [x] 4.2 Apply the guard to the vault mutation and signing methods: `vault.select`, `vault.renameKey`, `vault.deleteKey`, `vault.sign`, `vault.export`, `vault.reveal`.
- [x] 4.3 Apply the guard to `settings.update` and to every `policy.*` method including `policy.evaluate`.
- [x] 4.4 Apply the guard to every `activity.*` and `profile.*` method and to `approval.resolve`.
- [x] 4.5 Keep `vault.unlock`, `state.getLock`, `keys.list`, `crypto.evaluatePassword`, `crypto.parsePrivateKey`, and `settings.get` reachable while locked.
- [x] 4.6 Reduce `keys.list` while locked to the identifiers needed to distinguish existing keys from a first run, with no labels or public keys.
- [x] 4.7 Reduce `settings.get` while locked to the theme, side panel, and onboarding fields needed by the lock screen, omitting origins, relays, and selected key.
- [x] 4.8 Map `no_unlocked_key` and `key_locked_or_missing` to the `locked` error code in the Nostr and vault handlers so a locked vault never reports `denied`.
- [x] 4.9 Resolve pending approval requests as denied and clear the approval badge when the vault locks.

## 5. Re-Authentication For High-Risk Actions

- [x] 5.1 Require verified password re-entry for `vault.deleteKey`, `vault.export`, and `vault.reveal`.
- [x] 5.2 Require verified password re-entry to raise an origin to `high` trust, set a per-kind rule to `allow`, or enable a session grant.
- [x] 5.3 Require verified password re-entry to change `autoLockMinutes` or `sessionTTLMinutes`.
- [x] 5.4 Keep key rename lock-gated but not password-gated.
- [x] 5.5 Add the re-authentication prompt to the affected UI flows and zeroize the entered password immediately after the RPC call.

## 6. Settings Defaults, Range, And Migration

- [x] 6.1 Define the shipped `autoLockMinutes` default once in `src/domain/types.ts` and import it in `settings.service.ts`.
- [x] 6.2 Narrow `AppSettingsPatchSchema` to accept `autoLockMinutes` of 1 to 60 and `sessionTTLMinutes` of 0 to 60.
- [x] 6.3 Normalize stored out-of-range values on read, mapping a stored `0` auto-lock to the shipped default and clamping values above the ceiling.
- [x] 6.4 Update `AutoLockSlider` to a minimum of 1 minute with no "Never" label, and `SessionTTLSlider` to a maximum of 60.
- [x] 6.5 Remove the `autoLockMinutes === 0` special case from `Header.tsx` and show the enforced timeout.
- [x] 6.6 Explain in the Security tab that the timeout is measured from the last recorded activity.

## 7. Options Page Lock Gating

- [x] 7.1 Read lock state in `OptionsApp` through the existing `useKeyManager` path and render `LockScreen` before any tab navigation or tab content.
- [x] 7.2 Ensure no key label, public key, origin policy, relay entry, or activity entry renders while locked, including via a direct hash fragment.
- [x] 7.3 Transition an open options page to the lock screen without a reload when the vault locks.
- [x] 7.4 Return the user to the requested tab after unlocking from the options page.
- [x] 7.5 Confirm a locked vault holding keys renders the lock screen and not onboarding.

## 8. Tests

- [x] 8.1 Add a `KeyVaultService` unit test proving lock state fails closed when session storage holds no `lockState`.
- [x] 8.2 Add unit tests for deadline expiry, activity postponing the lock, a future `lastActivity` treated as expired, and a shortened timeout re-evaluating an existing session.
- [x] 8.3 Add a unit test proving `unlock()` fails and writes no unlocked state when the vault holds zero key records.
- [x] 8.4 Add a unit test proving stored lock state is corrected to locked when the background holds no decrypted key material.
- [x] 8.5 Add a unit test asserting no decrypted key, password, or derived key material is written to session, local, or sync storage after unlock.
- [x] 8.6 Add a test that enumerates the `RpcRequest` union and asserts a lock disposition for every method, failing for any unclassified method.
- [x] 8.7 Add handler tests proving `settings.update` and every `policy.*` mutation are refused while locked and leave stored data unchanged.
- [x] 8.8 Add handler tests proving the locked `keys.list` and `settings.get` projections omit labels, public keys, origins, and relays.
- [x] 8.9 Add handler tests proving `no_unlocked_key` maps to `locked` rather than `denied`.
- [x] 8.10 Add unit tests for the settings default reconciliation, the narrowed schema range, and the stored-value normalization.
- [x] 8.11 Add re-authentication tests covering key deletion, raising trust, and changing the auto-lock timeout with correct and incorrect passwords.
- [x] 8.12 Add Playwright coverage for lock and unlock, including automatic lock and the resulting refusal of a signing request.
- [x] 8.13 Add Playwright coverage for the options page while locked, proving the lock screen renders, no stored data is visible, and mutation is unavailable.

## 9. Documentation

- [x] 9.1 Update the README session-management claim so it matches the shipped behavior, including the `alarms` permission rationale.
- [x] 9.2 Correct the stale minimal-permissions line in `openspec/project.md` to reflect `storage`, `sidePanel`, `windows`, and `alarms`.
- [x] 9.3 Update `docs/v2-prd.md` status notes for `SEC-012` to reflect the flat auto-lock shipped here and the gradual lock left outstanding.
- [x] 9.4 Note in the release notes that the extension lands locked after update because lock state now fails closed.

## 10. Verification

- [x] 10.1 Run `openspec validate implement-session-auto-lock --strict`.
- [x] 10.2 Run `pnpm run compile`.
- [x] 10.3 Run focused Vitest suites for the key vault service, policy service, settings service, RPC handlers, and validation schemas, including the test that lock state fails closed on empty session storage.
- [x] 10.4 Run the Playwright extension tests for lock and unlock, the options page while locked, NIP-07 signing, and approval flow.
- [x] 10.5 Run `pnpm run build` and `pnpm run build:firefox`, and confirm `alarms` appears in `.output/chrome-mv3/manifest.json` and `.output/firefox-mv3/manifest.json` (the Firefox target moved to MV3 in `harden-manifest-and-build`).
- [x] 10.6 Defer `npx react-doctor@latest` until React Doctor is pinned locally by `restore-security-test-assurance`, because pnpm currently blocks the install with `ERR_PNPM_TRUST_DOWNGRADE` on `semver@6.3.1`.

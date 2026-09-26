## Why

There is no way to change the master password. KEYMGMT-007 is a **Must** on the roadmap and still ⬜. The competitor review of 2026-09-25 found the competitor ships it (nostr-wot-extension, `KeyActionModal.tsx`). The gap is not only parity:

- **A suspected-compromised password cannot be rotated.** The only recourse is to delete every key and re-import it, which requires having an nsec or backup for each one.
- **Users who predate the password policy are stuck with a weak password.** `password-policy` deliberately applies the 12-character minimum and blocklist only at creation. The code says why three times (`schemas.ts:138`, `vault-rpc.ts:96`): enforcing it at unlock would tell an existing user their correct password is invalid "with no change-password flow to escape through". This change is that escape route.
- **`add-biometric-unlock` already assumes it will exist.** It specifies that any envelope write deletes the biometric wrapping, "so a future change-password flow cannot leave a wrapping that opens a KEK the user believes they rotated away from".

The vault design makes the change cheap in cryptographic work: one KDF run for the new KEK, then a DEK re-wrap per key. Private-key ciphertexts are not touched. The hard part is durability. The envelope and the key records are separate storage items, and a rotation interrupted between the two writes must never leave a vault that neither password opens.

## What Changes

- Add a `vault.changePassword` RPC in the UI-only `vault` namespace. It is lock-gated and takes `currentPassword` and `newPassword`.
- Verify the current password through the shared unlock throttle, and apply the creation-time password policy to the new password. The new password must differ from the current one.
- Rotate the KEK:
  - Derive a new KEK under a fresh salt and the current `KDF_DEFAULTS`, which also upgrades any vault still on an older work factor.
  - Re-wrap every record's DEK under it with AAD bound to the new KDF parameters.
  - Seal a new verifier.
  - Zeroize both KEKs.
- Refuse the change while any record is legacy (unversioned) or fails to open, and say which. Rotating around a record that cannot be opened would strand it permanently.
- Make the rotation crash-safe with a single-item rotation journal written before the commit and consumed on the next unlock. At every interruption point, the password the user was last told is valid opens the vault.
- Serialise the rotation against every other vault write (generate, import, delete, legacy migration), so no record is sealed under a KEK that is being replaced.
- Keep the session unlocked, with in-memory keys and session grants intact. Encrypted backup files keep their own passphrase and are unaffected.
- Add a "Change master password" action to the Security settings tab, with current, new and confirm fields, the existing strength feedback, and a plain statement that backup files are unaffected. The dialog follows `docs/design/DESIGN_RULES.md`.

## Capabilities

### New Capabilities

- `master-password-change`: rotating the vault master password. Covers verification, policy, KEK rotation, crash safety, write serialisation, and the settings surface.

### Modified Capabilities

- `password-policy`: the new-password policy and confirm-field rule also apply to a changed password.
- `ui-options-page`: the Security tab gains the password-change action.

## Impact

- `src/application/services/key-vault.service.ts`: `changePassword`, the rotation journal, a vault write lock, and journal recovery in `unlock()`.
- `src/infrastructure/messaging/handlers/vault-rpc.ts`, `rpc.ts`, `client.ts`, `schemas.ts`: the new method and its validation.
- `src/infrastructure/messaging/rpc-router.ts`: stays lock-gated by default. No allowlist entry is needed.
- `src/ui/features/settings/components/SecuritySettingsTab.tsx` and a new dialog under `src/ui/components/dialogs/`.
- `docs/vault-storage-format.md`: the journal record and the recovery rule.
- `tests/security/`: fault injection at each rotation write, plus throttle and policy boundary tests. `tests/e2e/security-settings.spec.ts`: an end-to-end change followed by a re-unlock.
- **Depends on** `harden-origin-and-password-boundaries` for the shared password-throttle helper. If this lands first, it introduces the helper and that change adopts it.
- **Interacts with** `add-biometric-unlock`. If biometric unlock lands first, a password change deletes the enrolled factor, and the success message tells the user to re-enrol.

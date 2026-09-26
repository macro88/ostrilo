## 1. Service: rotation core

- [x] 1.1 Add a private promise-chain write lock to `KeyVaultService`, and run `generateKey`, `importKey`, `deleteKey`, `renameKey` and legacy migration under it. Existing vault tests pass unmodified.
- [x] 1.2 Add a `rewrapRecord(rec, oldKek, newKek, newKdf)` helper that unwraps the DEK, re-wraps it with a fresh IV and `dekAad(v, newKdf, id, pubkey)`, round-trips it, matches the pubkey, and zeroizes the DEK and the round-tripped key.
- [x] 1.3 Add `changePassword(current, next)`, implementing design Decision 1. Refuse with `vault_has_legacy_records` or `vault_has_damaged_records` (with the ids) before deriving the new KEK, and zeroize both KEKs in `finally`.
- [x] 1.4 Unit-test the rotation: ciphertexts byte-identical, wrapped DEKs, salt and verifier changed, the old password refused, the new password opening every key, `KDF_DEFAULTS` written, legacy and damaged refusals leaving storage unchanged.
- [x] 1.5 Add zeroization cases to `tests/security/memory-zeroization.test.ts` for the KEK and DEK buffers on success and on failure.

## 2. Service: journal and recovery

- [x] 2.1 Implement the commit sequence in design Decision 2: write the `vaultRotation` item, then `saveEnvelope`, then `saveKeys`, then remove the journal.
- [x] 2.2 Implement recovery at the top of `unlock()` and `verifyPassword()`: roll forward on a password that opens `to`, roll back on one that opens `from`, and otherwise report `incorrect_password`.
- [x] 2.3 Add `tests/security/password-rotation-durability.test.ts`. A storage adapter throws at each of the four commit steps and at each recovery write. After each fault, assert that the specified password opens the vault with every pubkey intact, the other password is refused, and a repeated recovery is idempotent.
- [x] 2.4 Add a concurrency test: an import issued during a rotation lands after it and opens under the new password.

## 3. RPC

- [x] 3.1 Add `vault.changePassword { currentPassword, newPassword }` to `rpc.ts`, a Zod schema in `schemas.ts`, and a `client.ts` helper. Confirm it is not in `LOCKED_REACHABLE_METHODS`.
- [x] 3.2 Add a `handleChangePassword` in `vault-rpc.ts`. It validates both passwords, refuses equal values with `invalid_params`, applies the creation policy with the blocklist to `newPassword`, and verifies the current password through the shared password throttle.
- [x] 3.3 Map the service refusals to canonical error codes, add them to `docs/rpc-error-codes.md`, and never echo a password in `details`.
- [x] 3.4 Extend the security suites: `rpc-privilege-boundary` (a page sender is refused), `lock-gate` (refused while locked), `unlock-throttle` (a wrong current password charges the counter, and a backoff refuses before derivation), and `password-policy-boundary` (a weak new password is refused, and a pre-policy current password is accepted).

## 4. UI

- [x] 4.1 Add `ChangePasswordDialog` under `src/ui/components/dialogs/`, following `docs/design/DESIGN_RULES.md`. It has current, new and confirm fields using the shared secret-input declaration, `crypto.evaluatePassword` feedback, and a confirm-match gate.
- [x] 4.2 Clear all password state on success, failure and unmount, and render `rate_limited`, the legacy or damaged refusals, and success copy (backup-passphrase note, plus the biometric re-enrol note when enrolled) per the `ui-options-page` delta.
- [x] 4.3 Add the "Change master password" action to `SecuritySettingsTab`. Remove the sentence in its header comment saying no change-password control is rendered.
- [x] 4.4 Add component tests for the confirm gate, field clearing, and each result state.
- [x] 4.5 Add an e2e case to `tests/e2e/security-settings.spec.ts`: change the password, lock, confirm the old password fails, unlock with the new password, and confirm every key is listed.
- [x] 4.6 Design review: `pnpm run build`, then the screenshot runner in light mode and with `OSTRILO_DESIGN_REVIEW_THEME=dark`, capturing the dialog in its empty, error, throttled and success states against the populated vault. Record the findings in `docs/design-review/README.md`.

## 5. Documentation

- [x] 5.1 Document the `vaultRotation` item, its lifetime and the recovery rule in `docs/vault-storage-format.md`.
- [x] 5.2 Update `docs/key-backup.md` to say backup files are unaffected by a password change.
- [x] 5.3 Mark KEYMGMT-007 ✅ in `docs/roadmap.md` and update the snapshot, coordinating with the roadmap reconciliation.
- [x] 5.4 Add a `CHANGELOG.md` entry.
- [x] 5.5 If `add-biometric-unlock` has landed, confirm its envelope-write deletion fires on rotation and that the dialog shows the re-enrol note. If it has not, record the dependency in that change's tasks.

## 6. Verification

- [x] 6.1 `pnpm run compile` and `pnpm run lint`
- [x] 6.2 `pnpm run test:coverage`
- [x] 6.3 `pnpm run build` and `pnpm run build:firefox`
- [x] 6.4 Playwright: `security-settings`, `vault-lock`, `onboarding-create`, `onboarding-import` and `multi-key-selector`
- [x] 6.5 `pnpm run doctor` and `pnpm run slop:changes`; address findings in the changed files and report both scores
- [x] 6.6 Dependency audit, unchanged: no dependency is added

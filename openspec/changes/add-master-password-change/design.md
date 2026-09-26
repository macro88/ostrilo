## Context

The vault stores two independent items in `storage.local` (`key-vault.service.ts:33-34`):

- `vaultEnvelope`: `{ v, kdf, verifier }`. The KEK is derived from the password with `kdf`, and the verifier is a known plaintext sealed under it.
- `encryptedKeys`: one record per key, `{ id, pubkey, ct, iv, wrappedDek, v }`. `ct` is the private key under a per-record DEK with `skAad(v, keyId, pubkey)`. `wrappedDek` is the DEK under the KEK with `dekAad(v, kdf, keyId, pubkey)`.

Rotating the password therefore changes `envelope.kdf` (new salt, possibly new cost), `envelope.verifier`, and every record's `wrappedDek`. It does not change any `ct`, because `skAad` does not bind the KDF.

`StoragePort` exposes single-item `set`. Chrome and Firefox both implement multi-key `storage.local.set` as one backend transaction in practice, but neither documents that as atomic. The design must stay correct if it is not.

Precedents to follow: `migrateLegacyRecord`'s write-verify-then-trust (`:708-732`); `openEnvelope` as the only producer of `incorrect_password`; `add-biometric-unlock`'s rule that `saveEnvelope` deletes the biometric factor.

## Goals / Non-Goals

**Goals:**

- A user who knows the current password can set a new one that meets the creation policy, without re-importing any key.
- At every point where the rotation can be interrupted, the vault opens with the password the user was last told was valid, and no key is lost.
- The current-password check is no weaker an oracle than unlock.

**Non-Goals:**

- Re-keying private keys or rotating DEKs. A password rotation defends against a leaked password, not a leaked DEK. Anyone who held the old KEK in memory held the private keys too, and re-sealing them would not reverse that.
- Re-encrypting backup files. They are sealed under a separate passphrase by design (`secure-key-backup`).
- "Forgot password" recovery. There is no escrow. A user without the current password restores from a backup or nsec, as today.
- Changing the KDF algorithm. The rotation writes `KDF_DEFAULTS`, whatever those are when it runs.

## Decisions

### 1. Rotate the KEK, re-wrap the DEKs, leave the ciphertexts

`changePassword(current, next)`:

1. Take the vault write lock (Decision 4).
2. `openEnvelope(current, envelope)` gives `oldKek`, through the shared password throttle.
3. Refuse with `vault_has_legacy_records` if any record has no `v`, and with `vault_has_damaged_records` (naming the ids) if any record's DEK does not unwrap under `oldKek`.
4. Derive `newKek` from `next` under a fresh salt and `KDF_DEFAULTS`.
5. For each record, unwrap the DEK with `oldKek` and re-wrap it under `newKek` with a fresh IV and `dekAad(v, newKdf, id, pubkey)`. Then **verify by round trip**: open the candidate record with `newKek`, and check the private key against `pubkey`, as `migrateLegacyRecord` does. Zeroize each DEK and each round-tripped key.
6. Seal a new verifier under `newKek`.
7. Commit through the journal (Decision 2).
8. Zeroize `oldKek` and `newKek` in `finally`.

*Alternative: decrypt every private key and re-seal with fresh DEKs.* Rejected. It is more work and more plaintext key material in memory, for no defence against the threat a rotation addresses.

### 2. Crash safety through a single-item rotation journal

The commit sequence:

1. Write `vaultRotation = { from: { envelope, records }, to: { envelope, records } }` as **one item**. Single-item writes are atomic. `from` is the state before the rotation and `to` the state after it.
2. Write `vaultEnvelope = to` through `saveEnvelope`, which keeps the biometric-factor deletion in the one place it lives.
3. Write `encryptedKeys = records`.
4. Remove `vaultRotation`.

Recovery happens in `unlock(password)` and `verifyPassword`, before normal processing. If `vaultRotation` exists:

- If `password` opens `rotation.to.envelope`, **roll forward**: write `to.envelope` and `to.records`, remove the journal, and continue with the new state.
- Else if `password` opens `rotation.from.envelope`, the user never saw success, so the old password is still the one they believe in. **Roll back**: write `from.envelope` and `from.records`, and remove the journal.
- Else the result is `incorrect_password`, as usual.

Both recoveries write whole states from the journal, so they are correct whichever of steps 2–3 had run, and they are idempotent if recovery itself is interrupted. The journal is one item of roughly twice the vault's size. At the 10-key scale this is a few KiB, far inside `storage.local`'s quota.

The RPC reports success only after step 4. A crash before that means the user was never told the new password works, but if they try it, it does: roll-forward is allowed because the new password is already a valid credential the user chose, and the rotation was otherwise complete.

*Alternative: one multi-key `storage.local.set({ vaultEnvelope, encryptedKeys })`.* Rejected as the sole mechanism: its atomicity is undocumented, and a key-loss bug would rest on an implementation detail. It may still be used for steps 2–3 as an optimisation, but the journal is what makes this correct.

*Alternative: merge the envelope and the records into one storage item (vault format v2).* Rejected for this change. It is a format migration that touches every vault, `add-biometric-unlock` hooks `saveEnvelope`, and the journal gives the same guarantee locally. Worth revisiting if a second multi-item vault operation appears.

### 3. The throttle and the policy at the boundary

The handler validates both fields with `PasswordSchema`. It evaluates `newPassword` with the same background policy `enforceNewPasswordPolicy` uses for creation (blocklist included) and refuses `newPassword === currentPassword` with `invalid_params`. The current-password check runs through the shared password throttle from `harden-origin-and-password-boundaries`, so a wrong current password charges the unlock counter.

### 4. A vault write lock

`KeyVaultService` gains a private promise-chain mutex. `changePassword`, `generateKey`, `importKey`, `deleteKey`, `renameKey` and legacy migration inside `unlock` run under it. Without it, a key imported during a rotation is sealed under `oldKek` and then overwritten by the rotation's record list, or survives with a DEK the new envelope cannot open. The lock is in-memory. That is sufficient because the background worker is the only writer and there is one worker.

### 5. Session behaviour

The in-memory `unlocked` map holds private keys, not KEK-derived material, so it stays valid, and the session stays unlocked with its grants. The auto-lock deadline is touched, as for any user action. No lock listener runs.

### 6. UI

A `ChangePasswordDialog` opened from the Security tab. The rules it follows:

- Fields are current, new and confirm, sharing the secret-input declaration (no autofill, no spell-check).
- The new field uses the existing `crypto.evaluatePassword` feedback.
- Password state is cleared on success, failure and unmount, as `harden-password-entry-surfaces` requires.
- `rate_limited` is shown as a wait with its remaining time.
- Refusals on damaged or legacy records name the next step: unlock once to migrate, or remove the damaged key.
- The success copy says backup files keep their own passphrase. If biometric unlock was enrolled, it says it must be enrolled again.

Judge it in both themes against a populated vault, per `AGENTS.md`.

## Risks / Trade-offs

- **[A recovery-path bug loses keys]** → Fault-injection tests make the storage adapter throw at each of the four commit steps. They then assert that both the "old password" and "new password" recoveries open the vault with every key's pubkey intact. This suite is the change's acceptance gate.
- **[The journal holds two copies of wrapped key material]** → Everything in it is ciphertext under a password-derived KEK, as the live records are, and it lives only between steps 1 and 4. After a completed rotation, the `from` half is removed with it. The old password's KEK is obsolete, but an attacker holding a pre-rotation copy of `storage.local` could already attack the old password offline. A rotation cannot retract a copy already taken.
- **[Blocking other vault writes during the KDF run]** → One Argon2id run plus N AES operations is the same order as an unlock. The UI shows progress, and page signing does not take the write lock (signing reads the in-memory keys).
- **[Unlock grows a recovery branch]** → Its cost is one `get` when no journal exists. The branch is covered by the fault-injection suite, and the journal's presence is logged by key name only, never contents.

## Migration Plan

No migration is needed. The journal item is absent in every existing vault, and the absent case is today's behaviour. Rollback is a revert. A vault rotated before a revert is a normal v1 vault under the new password.

## Open Questions

- ~~Should a successful rotation append an entry to the activity log?~~ Decided 2026-09-26: no. The log records signing decisions; a security-event category belongs with SEC-013 (tamper-evident audit log).

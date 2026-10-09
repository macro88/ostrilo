## Why

An encrypted backup can only be made while the first key is being created. A key added later, from Settings or by any other route, has no backup path inside Ostrilo, and the README lists "Backup for keys added later" as planned for 1.0. A Nostr key cannot be rotated, so a second identity with no backup is the one most likely to be lost, and nothing today tells the user which keys have one.

## What Changes

- **Settings backs up any key.** Keys & Identities gets a **Back up** action on every key. It asks for the master password, reveals that key with the existing password-gated `vault.reveal`, and hands it to the same encrypted export and the same file verification onboarding uses. The file is the same `ostrilo-key-backup` envelope, so it restores through the onboarding import. The key is never displayed, copied or put in a URL by this flow, and the revealed key lives only in a ref that every way out empties.
- **Verification is the file.** Onboarding offers two proofs: re-enter the last characters of the nsec, or reopen the saved file. A Settings backup never shows the key, so only the file proof is offered. A Settings backup counts only once the saved file is read back and decrypts to the key.
- **A vault that locks mid-backup records nothing.** The flow stops, the revealed key is dropped, and the dialog says why.
- **Per-key backup status**, kept outside the vault envelope in its own non-secret `storage.local` record: `pending` or `verified`, with a time.
  - A key the vault generates starts `pending`. The vault sets it before the key is stored, so a key cannot be created without its status. This is the one hook Quick Start (a later task in this change) uses.
  - A key generated through onboarding becomes `verified` only when its backup verification passes.
  - The status is written before anything else names the new key, so a failed write creates no key and no selection of one. A later failure to store the key can leave an inert orphan `pending` record: the id is random and never reused.
  - An imported key gets no record: the user already holds the secret.
  - A key that existed before this change has no record and is *unknown*: no marker, no banner, and Back up stays available. This avoids nagging users who backed up during onboarding. The cost is that a legacy key added from Settings before this change is not nagged either.
  - Deleting a key removes its record.
- **Writes are narrow.** `backup.markVerified` is the only status write the UI has. There is no request that sets `pending` or clears a record. `backup.list` reads. Both are UI-only and refused while the vault is locked.
- **The keys list marks `pending` keys** with a quiet "No backup" chip.
- **Docs:** `docs/key-backup.md`, `docs/vault-storage-format.md` and the README no longer say a later key cannot be backed up.

- **Quick start** (phase 0.10, Task 10), a lighter way in for a new vault: a password, one key, a recoverability notice, then Home. No backup step, no key shown. The key is `pending`, which is why the status record exists before it. This scopes the first-key requirements that make backup mandatory to the full create flow, and adds the Quick Start requirement beside them.
- **A Home banner** for the selected `pending` key: "This key has no backup", with an action that opens Settings on that key's backup. Dismissal lasts for the browser session and applies to that key only (`storage.session`, one item per key). It is the owner's chosen reminder: no schedule, no counter, no server.

Not changed: the envelope format, the KDF and AEAD, the backup passphrase rules, the clipboard behaviour of onboarding, and the rule that no plaintext export exists anywhere.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `secure-key-backup`: adds Settings backup, per-key backup status, the keys-list marker, Quick Start and the Home banner; scopes the mandatory first-key backup requirements to the full create flow.

## Impact

**Code**
- `src/domain/backup/status.ts`: the status types and the validating reader of the stored record.
- `src/application/services/key-backup-status.service.ts`: the record's owner. `KeyVaultService` exposes it as `backupStatus`, sets `pending` in `generateKey`, and removes the record in `deleteKey`.
- `src/infrastructure/messaging/handlers/backup-rpc.ts`, `rpc.ts`, `client.ts`, `events.ts`, `validation/schemas.ts`, `background.ts`: `backup.list`, `backup.markVerified`, the `KEY_BACKUP_CHANGED` broadcast.
- `src/ui/features/backup/`: the envelope, export and verification moved out of `features/onboarding`; `useKeyBackup`, `KeyBackupDialog`, and the reader hooks `useKeyBackupStatuses` and `useKeyBackupStatus`.
- `src/ui/features/settings/components/KeysIdentitiesTab.tsx`, `shared/KeySelectorCard.tsx`; `OnboardingCreateKey.tsx` marks its key verified.
- `src/ui/features/onboarding/components/OnboardingQuickStart.tsx`, `OnboardingWelcome.tsx`, `OnboardingContainer.tsx`, `validate-new-password.ts`: the Quick start flow.
- `src/ui/features/backup/backup-banner.ts`, `hooks/useBackupBanner.ts`, `components/BackupBanner.tsx`; `HomeView.tsx`: the banner.
- `src/ui/lib/open-options.ts`, `src/extension/options/OptionsApp.tsx`, `KeysIdentitiesTab.tsx`: the `#keys?backup=<id>` deep link.

**Storage:** one new `storage.local` item, `keyBackupStatus`, holding key ids, a state and a time, and one `storage.session` item per dismissed banner (`backupBannerDismissed:<keyId>`). No secret, no new permission, no dependency and no network behaviour.

**Behaviour users will notice:** every key can be backed up from Settings; a key made in Settings shows "No backup" until it is; a new install can take Quick start, and Home reminds a key without a backup until one is made.

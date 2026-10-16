## 1. Status record

- [x] 1.1 `src/domain/backup/status.ts`: types, and a reader that drops malformed entries and entry keys that are not key ids
- [x] 1.2 `KeyBackupStatusService`: `list`, `markPending`, `markVerified`, `remove`; serialised read-modify-write; broadcast on `markVerified`
- [x] 1.3 `KeyVaultService`: `generateKey` sets `pending` before storing the key, `deleteKey` removes the record, `importKey` writes none
- [x] 1.4 `backup.list` and `backup.markVerified` (UI-only, lock-gated, key must exist); client functions and the response schema
- [x] 1.5 Unit tests: status transitions, malformed storage, vault integration (generate, import, delete, no key when the write fails), handler validation and access

## 2. Settings backup

- [x] 2.1 Move the envelope, export panel and verification to `features/backup`; the verification offers the file route alone when it is given no re-entry check
- [x] 2.2 `useKeyBackup` and `KeyBackupDialog`: password reveal into a ref, export, file verification, `markVerified`, abort on lock
- [x] 2.3 Keys & Identities: Back up on every key, disabled with its reason for an unreadable key; "No backup" marker for `pending`
- [x] 2.4 Onboarding marks its key `verified` when verification passes
- [x] 2.5 `useKeyBackupStatuses` / `useKeyBackupStatus` for Home and other surfaces
- [x] 2.6 Component and hook tests; Chrome e2e: add a key in Settings, back it up, restore it in a fresh profile with the same public key (`tests/e2e/backup-round-trip.spec.ts`)

## 3. Quick start and the Home banner

- [x] 3.1 Welcome offers Quick start; `OnboardingQuickStart`: password, one key through the existing generate path, recoverability notice, Home; guards against repeat submission and a retry after a lost reply
- [x] 3.2 `BackupBanner` and `useBackupBanner` on Home: `pending` only, per-key session dismissal, gone on `verified`
- [x] 3.3 `#keys?backup=<id>` deep link: the banner opens Settings and starts that key's backup once
- [x] 3.4 Unit tests (flow, banner visibility, dismissal, deep link) and Chrome e2e (`tests/e2e/quick-start.spec.ts`): Quick start, lock and unlock, back up from the banner, restore in a fresh profile

## 4. Docs and verify

- [x] 4.1 `docs/key-backup.md`, `docs/vault-storage-format.md`, README
- [x] 4.2 Light and dark review on the production build with a populated vault (Task 14 of phase 0.10)
- [x] 4.3 Archive this change (Task 14 of phase 0.10)

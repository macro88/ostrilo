## 1. Policy and storage

- [x] 1.1 `src/domain/profile/avatar.ts`: limits, data-URL check (type, size, header bytes), validating reader of the stored record
- [x] 1.2 `ProfileAvatarService`: `get`, `save` (prunes keys the vault does not hold), `remove`; serialised read-modify-write; broadcast on change
- [x] 1.3 `KeyVaultService`: exposes `profileAvatar`; `deleteKey` removes the copy last and best effort
- [x] 1.4 `avatar.get`, `avatar.save`, `avatar.remove` (UI-only, lock-gated, validated); client functions and the response schema
- [x] 1.5 Unit tests: record parsing, service, vault deletion, handler validation and access, no network

## 2. Capture and header

- [x] 2.1 `captureAvatar`: one `crossOrigin="anonymous"`, no-referrer load; `https:` only; 10 s timeout; 4096 limit; 96 by 96 centre crop; webp then png
- [x] 2.2 `useProfilePicture` and the Profile view: cache on a save with a picture, remove on a save without, Refresh picture control, status note
- [x] 2.3 `useOwnAvatar`, `OwnAvatarImage`, `KeySelector`: selected key's copy only, fixed size, alt text, seal fallback
- [x] 2.4 Unit tests: capture limits and failures, hook identity isolation, header rendering, Profile view flows, source scans that pin the only remote load

## 3. Docs and verify

- [x] 3.1 `PRIVACY.md`, README privacy paragraph, `docs/managing-multiple-keys.md`, `docs/vault-storage-format.md` and `docs/roadmap.md`
- [x] 3.2 Chrome e2e (`tests/e2e/profile-avatar.spec.ts`): one request per save or refresh, none on open, unlock, side panel or key switch; centre crop; failure notes; deletion; background refusals. `profile-long-values.spec.ts` covers the header image and the note beside long values
- [x] 3.3 The design-review runner seeds a copy for the populated vault
- [x] 3.4 Light and dark review on the production build with a populated vault (Task 14 of phase 0.10)
- [x] 3.5 Archive this change (Task 14 of phase 0.10)

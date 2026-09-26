## 1. Settings store

- [x] 1.1 Add a `SettingsStore` in `src/application/services/`, constructed over a `StorageSuite`. It holds the only `appSettings` key constant, exposes `read()`, `write(next)` and `migrate()`. `read()` copies sync to local when local is empty and never deletes; `migrate()` reads, verifies the local copy, then removes the sync item (design Decision 3).
- [x] 1.2 Unit-test the store: local present returns local and ignores sync; local absent with sync present copies as-is and returns it, leaving sync in place; neither present returns `undefined`; concurrent first reads converge; `write` never touches sync; `migrate()` removes the sync item only after local reads back, sweeps a later sync copy, and is a no-op on a fresh install.

## 2. Move the services onto the store

- [x] 2.1 `SettingsService`: replace every `storage.sync` get and set of settings with the store (`get` normalisation write-back, `update`, `reset`, defaults on first read). Behaviour is otherwise unchanged.
- [x] 2.2 `PolicyService`: replace settings reads and writes, including `runConsentMigration`.
- [x] 2.3 `KeyVaultService`: replace `getSettings` and the `selectedKeyId` and `sessionGrantAll` writes in `generateKey`, `importKey`, `selectKey`, `deleteKey` and `lock`.
- [x] 2.4 Wire one `SettingsStore` instance into all three services in `src/extension/background.ts`, and call `migrate()` when the worker starts and on `runtime.onStartup` and `onInstalled`, so migration completes before the first page request and a failed removal is retried.
- [x] 2.5 Confirm the background `storage.onChanged` handler reacts to the local area. Add a test that a local `appSettings` change re-arms auto-lock and rebuilds the relay manager. (Implementation found the handler area-agnostic, which would let a synced write from an older install rebuild the relay manager; it now filters to the local area. See design Decision 4.)

## 3. Guard the boundary

- [x] 3.1 Add `tests/security/settings-locality.test.ts`. It scans `src/` and fails on any `storage.sync` / `browser.storage.sync` reference outside the docked-flag allowlist, and on the `appSettings` key string outside `SettingsStore`.
- [x] 3.2 Add the security scenario from the spec: after migration, a synced settings item granting `high` trust and disclosure `allow` to an origin changes no evaluation, disclosure or signing outcome.
- [x] 3.3 Assert that `lock()` and a trust-raising `policy.setOrigin` perform no synced-storage write, using a spying storage adapter.

## 4. Update tests and tooling

- [x] 4.1 Move the unit, integration and security fixtures that seed `storage.sync` with `appSettings` to seed local storage, through the store where practical. Candidates: `policy.service*.test.ts`, `keyvault.service.test.ts`, `key-vault.service.paths.test.ts`, `settings.service.migration.test.ts`, `policy-rpc-handler.test.ts`, `signing-approval-rpc.test.ts`, `vault-rpc-handler.test.ts`, `password-policy-boundary.test.ts`, `auto-lock.test.ts`, `policy-invariants.test.ts`, `vault-envelope.test.ts`, `consent-policy-integration.test.ts` and `cross-layer.test.ts`.
- [x] 4.2 Change `tests/e2e/profile-edit.spec.ts:338` to seed `chromeApi.storage.local`.
- [x] 4.3 Add a migration e2e case to `tests/e2e/settings-origin-policy.spec.ts`. Seed synced settings with a `high` origin, reload the extension, and confirm the Permissions tab shows the origin at `high`, the local item exists, and the synced item is gone.
- [x] 4.4 Check `docs/design-review/capture-screenshots.mjs` and `docs/agent-loop.md` helpers for direct sync-storage seeding, and update any found.

## 5. Documentation

- [x] 5.1 Rewrite "What your browser may sync" in `PRIVACY.md`. Only the docked-panel preference syncs; settings, site permissions and relays stay on the device. The copy earlier versions kept in browser sync is removed on upgrade.
- [x] 5.2 Update `docs/extension-manifest.md`'s storage-area description. `harden-origin-and-password-boundaries` landed first, so this change writes the final wording.
- [x] 5.3 In `docs/roadmap.md`:
  - Reword SYNC-001 to "settings are device-local; cross-device sync only through an authenticated mechanism (SYNC-005, PROTO-009)", and set its status accordingly.
  - Record SYNC-006 as moot for browser sync.
  - Replace the "Open product question" paragraph in the competitor-review subsection with a pointer to this change.
  - Record that the synced copy is removed on upgrade, so no follow-up is needed.
- [x] 5.4 Update `harden-origin-and-password-boundaries/design.md`: replace its `storage.sync` Open Question and Non-Goal with a pointer to this change.
- [x] 5.5 Add a `CHANGELOG.md` entry under behaviour changes: settings, site permissions and relays no longer sync between browsers, and why; the synced copy is removed on upgrade, which resets settings on a browser still running an older version on the same account.

## 6. Verification

- [x] 6.1 `pnpm run compile` and `pnpm run lint`
- [x] 6.2 `pnpm run test:coverage`
- [x] 6.3 `pnpm run build` and `pnpm run build:firefox`
- [x] 6.4 Playwright: `settings-origin-policy`, `general-settings`, `security-settings`, `relay-management`, `profile-edit`, `vault-lock`, `identity-disclosure` and `onboarding-create`
- [x] 6.5 `pnpm run doctor` and `pnpm run slop:changes`; address findings in the changed files and report both scores
- [x] 6.6 Dependency audit, unchanged: no dependency is added

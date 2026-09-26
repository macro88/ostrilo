## 1. Settings store

- [ ] 1.1 Add a `SettingsStore` in `src/application/services/`, constructed over a `StorageSuite`. It holds the only `appSettings` key constant, exposes `read()` and `write(next)`, and `read()` performs the migration in design Decision 3.
- [ ] 1.2 Unit-test the store: local present returns local and ignores sync; local absent with sync present copies as-is and returns it; neither present returns `undefined`; concurrent first reads converge; the sync item is never removed or written.

## 2. Move the services onto the store

- [ ] 2.1 `SettingsService`: replace every `storage.sync` get and set of settings with the store (`get` normalisation write-back, `update`, `reset`, defaults on first read). Behaviour is otherwise unchanged.
- [ ] 2.2 `PolicyService`: replace settings reads and writes, including `runConsentMigration`.
- [ ] 2.3 `KeyVaultService`: replace `getSettings` and the `selectedKeyId` and `sessionGrantAll` writes in `generateKey`, `importKey`, `selectKey`, `deleteKey` and `lock`.
- [ ] 2.4 Wire one `SettingsStore` instance into all three services in `src/extension/background.ts`, and call `read()` on `runtime.onStartup` and `onInstalled` so migration completes before the first page request.
- [ ] 2.5 Confirm the background `storage.onChanged` handler reacts to the local area. Add a test that a local `appSettings` change re-arms auto-lock and rebuilds the relay manager.

## 3. Guard the boundary

- [ ] 3.1 Add `tests/security/settings-locality.test.ts`. It scans `src/` and fails on any `storage.sync` / `browser.storage.sync` reference outside the docked-flag allowlist, and on the `appSettings` key string outside `SettingsStore`.
- [ ] 3.2 Add the security scenario from the spec: after migration, a synced settings item granting `high` trust and disclosure `allow` to an origin changes no evaluation, disclosure or signing outcome.
- [ ] 3.3 Assert that `lock()` and a trust-raising `policy.setOrigin` perform no synced-storage write, using a spying storage adapter.

## 4. Update tests and tooling

- [ ] 4.1 Move the unit, integration and security fixtures that seed `storage.sync` with `appSettings` to seed local storage, through the store where practical. Candidates: `policy.service*.test.ts`, `keyvault.service.test.ts`, `key-vault.service.paths.test.ts`, `settings.service.migration.test.ts`, `policy-rpc-handler.test.ts`, `signing-approval-rpc.test.ts`, `vault-rpc-handler.test.ts`, `password-policy-boundary.test.ts`, `auto-lock.test.ts`, `policy-invariants.test.ts`, `vault-envelope.test.ts`, `consent-policy-integration.test.ts` and `cross-layer.test.ts`.
- [ ] 4.2 Change `tests/e2e/profile-edit.spec.ts:338` to seed `chromeApi.storage.local`.
- [ ] 4.3 Add a migration e2e case to `tests/e2e/settings-origin-policy.spec.ts`. Seed synced settings with a `high` origin, reload the extension, and confirm the Permissions tab shows the origin at `high` and the local item exists.
- [ ] 4.4 Check `docs/design-review/capture-screenshots.mjs` and `docs/agent-loop.md` helpers for direct sync-storage seeding, and update any found.

## 5. Documentation

- [ ] 5.1 Rewrite "What your browser may sync" in `PRIVACY.md`. Only the docked-panel preference syncs; settings, site permissions and relays stay on the device. Earlier versions left a copy in browser sync, which a later release removes and which turning off extension sync removes at once.
- [ ] 5.2 Update `docs/extension-manifest.md`'s storage-area description. Coordinate with `harden-origin-and-password-boundaries` task 7.1: whichever lands second writes the final wording.
- [ ] 5.3 In `docs/roadmap.md`:
  - Reword SYNC-001 to "settings are device-local; cross-device sync only through an authenticated mechanism (SYNC-005, PROTO-009)", and set its status accordingly.
  - Record SYNC-006 as moot for browser sync.
  - Replace the "Open product question" paragraph in the competitor-review subsection with a pointer to this change.
  - Add the follow-up to delete the stale sync copy, with the timing rule from design Open Questions.
- [x] 5.4 Update `harden-origin-and-password-boundaries/design.md`: replace its `storage.sync` Open Question and Non-Goal with a pointer to this change.
- [ ] 5.5 Add a `CHANGELOG.md` entry under behaviour changes: settings, site permissions and relays no longer sync between browsers, and why.

## 6. Verification

- [ ] 6.1 `pnpm run compile` and `pnpm run lint`
- [ ] 6.2 `pnpm run test:coverage`
- [ ] 6.3 `pnpm run build` and `pnpm run build:firefox`
- [ ] 6.4 Playwright: `settings-origin-policy`, `general-settings`, `security-settings`, `relay-management`, `profile-edit`, `vault-lock`, `identity-disclosure` and `onboarding-create`
- [ ] 6.5 `pnpm run doctor` and `pnpm run slop:changes`; address findings in the changed files and report both scores
- [ ] 6.6 Dependency audit, unchanged: no dependency is added

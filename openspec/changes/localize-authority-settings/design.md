## Context

`appSettings` is one object (`AppSettingsV1`, `src/domain/types.ts:154-177`) in `storage.sync`. Three application services read and write it directly through `StorageSuite.sync`:

- `SettingsService`: read with normalisation and write-back, update, reset.
- `PolicyService`: origin records, disclosure consent, the consent migration.
- `KeyVaultService`: `selectedKeyId` on first key and on select, `sessionGrantAll` flags on lock.

The background's `storage.onChanged` listener (`background.ts:481-494`) keys on `changes.appSettings` without checking the area, and re-arms auto-lock and rebuilds the relay manager. UI surfaces read settings through RPC and the `SETTINGS_CHANGED` broadcast. The only UI code that touches `storage.sync` directly is `useWxtStorage`, whose single consumer is the docked-panel flag (`GeneralSettingsTab.tsx:104`), and the background reads that flag with `storage.sync.get(DOCKED_STORAGE_KEY)`.

The product decision this change implements was taken on 2026-09-26 after the competitor review: keep real preferences in sync, and make authority device-local.

## Goals / Non-Goals

**Goals:**

- No value that browser sync can deliver from another device can sign, disclose identity, relax a security control, or direct where this device sends data.
- One code path owns the settings item, and a test keeps it that way.
- Upgrading loses no grant and prompts no user for anything they already decided.

**Non-Goals:**

- Cross-device sync of any kind. SYNC-005 (encrypted, key-authored settings events) is the path for grants. PROTO-009 (NIP-65) is the path for relays. Both authenticate their author, which browser sync cannot.
- Deleting the stale sync copy in this release (see Decision 3).
- Changing the shape of `AppSettingsV1`, its normalisation, or any policy semantics.
- Defending local storage against a compromised renderer. That is out of scope here, as it is in `harden-origin-and-password-boundaries`.

## Decisions

### 1. Move the whole object, not a split

The approved direction listed theme, relays, activity retention and upload endpoint as preferences to keep synced. Applying the rule in Goals field by field narrows that:

| Field | Remote change can… | Area |
|---|---|---|
| `origins`, `mediumAllowKinds` | sign silently, disclose the public key | local |
| `autoLockMinutes`, `sessionTTLMinutes` | relax a password-gated security control | local |
| `relays` | direct profile lookups, and the IP address that comes with them, to a chosen relay | local |
| `uploadEndpoint` | direct uploads to a chosen HTTP host (SEC-021 exists to control exactly this) | local |
| `maxActivityEntries` | shrink retention and trim local history, erasing the record of what was signed | local |
| `selectedKeyId`, `onboardingCompleted*` | nothing useful: device-specific and meaningless elsewhere | local |
| `theme`, `sidePanel` | change appearance | either |

Only `theme` and `sidePanel` pass. Keeping them synced would mean splitting one object across two storage areas: a merge on every read, two items to write, two change events, and a second item for a later field to be put in by mistake. That cost buys syncing the theme. **Move the whole `appSettings` item to `storage.local`.** The docked flag is already its own sync key and stays there.

*Alternative: split into `appPreferences` (sync) and `appAuthority` (local).* Rejected for the reasons above. If synced theme is wanted later, it should get its own key like the docked flag, not a split object.

### 2. One settings store owns the item

Add a small application-layer store, for example `SettingsStore` with `read()` and `write(next)`, constructed over `StorageSuite.local`. It is the only code that names the `appSettings` key. `SettingsService`, `PolicyService` and `KeyVaultService` take it by injection in place of reaching into `storage.sync`, so the storage area is decided in one place, and the change is mostly mechanical call-site substitution.

A security test, `tests/security/settings-locality.test.ts`, scans `src/` in the style of `crypto-single-implementation.test.ts` and fails on:

- any reference to `storage.sync` or `browser.storage.sync` outside an allowlist, which is the docked-flag accessors;
- any occurrence of the `appSettings` key string outside the store.

*Alternative: flip `storage.sync` to `storage.local` at each call site.* It is smaller today, but it leaves twelve call sites each deciding the area, and the next one added will copy whichever it sees first.

### 3. Migrate by copying; delete the old copy later

`SettingsStore.read()`:

1. Read `appSettings` from local. If present, return it.
2. Otherwise read `appSettings` from sync. If present, write it to local as-is and return it. Existing normalisation in `SettingsService.get()` then runs on it, as it would have.
3. Otherwise return `undefined`, and `SettingsService` writes defaults to local as it writes them to sync today.

The background also calls it on `runtime.onStartup` and `onInstalled`, so the migration completes before the first page request, not on first use. The step is idempotent: two concurrent first reads both write the same value.

The sync copy is **not removed** in this release. `storage.sync` is shared by every device on the account, and some of them are still running the old version. Removing the item would propagate: an old-version device would lose every grant, and a device that upgrades later would migrate an empty object. Both fail safe (more prompts, never fewer), but multi-browser users would pay for it for no gain. The new version never reads the sync copy after the first migration, so leaving it has no security cost. It does keep the site list at the browser vendor until removed. A follow-up release deletes it once this version has been the only supported one long enough (the roadmap row carries the rule). `PRIVACY.md` says so plainly.

Migrated grants are copied exactly, trust levels included. A grant already planted through sync before the upgrade survives migration. The threat this change closes is injection from then on, and re-prompting every user for every site in order to cover a hypothetical earlier injection is the worse trade. The design says so rather than implying otherwise.

### 4. Local-context propagation is unchanged

The background listener is already area-agnostic, and the UI updates from the RPC broadcast, not storage events. A test asserts that a local-area change to `appSettings` re-arms auto-lock and rebuilds the relay manager, so that a future area filter cannot silently break it.

## Risks / Trade-offs

- **[Users with several browsers lose sync they may rely on]** → That is the product decision. It is stated in the CHANGELOG as a behaviour change, and PRIVACY.md and the Settings copy say settings are per browser. Grants are re-approved once per browser, with the same prompts as a new site.
- **[A later write path bypasses the store]** → The locality security test fails CI.
- **[The stale sync copy lingers]** → It is inert for the new version, disclosed in PRIVACY.md, and removal is tracked. A user who wants it gone at once can turn off extension sync in the browser, which PRIVACY.md already explains.
- **[A migration read races an old-version write on the same device]** → Cannot happen: one device runs one version of the extension.
- **[The local item grows without the sync quota's back-pressure]** → `storage.local` allows 10 MB. Origin records are bounded by user decisions, and the existing retention caps bound the activity log. No action is needed now; the SYNC-001 note about the 8 KB item quota becomes moot.

## Migration Plan

1. Ship the store, the migration and the call-site changes together.
2. Next release or later: delete `appSettings` from `storage.sync`, and track it on the roadmap.
3. Rollback: reverting makes the old version read the sync copy, which still exists (Decision 3) but misses changes made since the upgrade. Grants made after the upgrade would be lost on rollback, and prompts would return; that fails safe.

## Open Questions

- **Should theme sync via its own key?** It is cheap to add later, on the docked-flag pattern. Left out unless asked for.
- **When should the stale copy be deleted?** Proposed rule: the first release shipped 30 or more days after this one. That is long enough for Chrome and Firefox auto-update to have reached effectively every active install.

# Implementation notes

## Unlock failure codes: complete coverage (task 3.5)

Every failure `vault.unlock` can return, read off the whole of `handleUnlock`
(`src/infrastructure/messaging/handlers/vault-rpc.ts:127-195`) plus the router's
catch-all:

| Cause | Code | UI copy |
|---|---|---|
| `PasswordSchema` rejects the shape (`:133-138`) | `invalid_password` | yes — the background's `details` |
| Throttle window in force (`:142-151`) | `rate_limited` | yes — the background's `details`, carrying the countdown |
| Genuinely incorrect password (`:162-172`) | `invalid_password` | yes — the background's `details`, carrying the countdown when one applies |
| `vault_not_created` (`:173-180`) | `no_key_selected` | yes |
| `vault_version_unsupported` / `kdf_below_floor` / `kdf_unknown_algorithm` (`:181-191`) | `vault_unreadable` | yes |
| Anything else — rethrown at `:192` | `unknown_method` (`rpc-router.ts:239-242`, `:321-327`) | generic fallback |
| Transport: `no_response`, `invalid_response_type`, legacy string, `transport_error` | `unlock_failed` (assigned in the context) | yes |

**Nothing is uncovered.** Two notes on the table:

- `INVALID_PASSWORD` is returned for two different causes — a schema-shape
  failure at `:134` and an incorrect password at `:164` — so the code alone does
  not identify the failure. That is why its `details` is what gets rendered.
- The router's catch-all is `UNKNOWN_METHOD` with `details: "Request could not
  be handled"`. It is deliberately absent from the UI's copy map, so it takes
  the generic fallback and the background's detail string is not shown.

## Ephemeral Input State: three incompatible texts (task 8.2)

`### Requirement: Ephemeral Input State` exists in three places, and **neither of
the two in-flight deltas is archived**:

| Source | Position |
|---|---|
| `openspec/specs/ui-security/spec.md:6-13` (main baseline) | Absolute prohibition; carries the incorrect dev-tools clause at `:13`; Purpose is still the archive placeholder |
| `openspec/changes/enforce-password-policy/specs/ui-security/spec.md` | Absolute prohibition extended to derived values; then requires the confirmation comparison to "read the current input values ephemerally", contradicting itself; specifies a generated-passphrase feature absent from `src` |
| `openspec/changes/secure-key-backup-flow/specs/ui-security/spec.md:3-35` | Permits a bounded controlled value; explicitly disclaims zeroization |

**Archive order decides which survives**, silently. This change baselines on the
`secure-key-backup-flow` text — the only one that matches what the code does —
and carries over the two `enforce-password-policy` scenarios whose obligations
are implemented (debounced strength feedback, `password-input.tsx:41`; and
confirmation matching without persisting either value), so archiving does not
lose them. It does not carry over that text's generated-passphrase scenario,
because no such feature exists.

**This change must archive after both**, or the three deltas must be reconciled
at archive time.

## The dev-tools clause (task 8.3, 8.4)

The clause "MUST NOT trigger re-renders that expose the value to dev tools" is a
**scenario bullet** at `openspec/specs/ui-security/spec.md:13`, not a requirement
of its own. It is therefore deleted by the `MODIFIED` rewrite of the
`Password Entry` scenario, and **not** by a `REMOVED Requirements` block — such a
block naming a requirement that does not exist would not validate against the
baseline. The requirement text carries a tombstone recording why the stated
mechanism is wrong, so a future reader does not reinstate it.

Checked for tasks in other changes still checked off against the deleted clause
(task 8.4): `openspec/changes/enforce-password-policy/tasks.md:30` is checked off
against "immediately zeroizes the password", which is the same class of
overclaim and comes from `openspec/specs/key-vault/spec.md:14` and `:25`. It is
left as found and noted here rather than silently edited — amending the
`key-vault` spec is out of this change's scope, and is recorded as an open
question in `design.md`.

## Two defects found during implementation, not visible from the artifacts

### 1. The options page unmounted the lock screen mid-attempt

`OptionsGate` (`src/extension/options/OptionsApp.tsx`) began `if (isLoading) return null;`. `isLoading` is set by `KeyManagerContext.unlock` for the duration of an unlock, so pressing Unlock **unmounted `LockScreen` entirely** and remounted it when the RPC returned — with fresh state, and therefore no error.

The consequence: on the options page the new failure message could never be displayed, no matter how correct the component was. Every unit test passed, because they render `LockScreen` directly; only the new Playwright test caught it.

`MainApp.tsx` does not have this bug — it checks `isLocked` before `isLoading`, so the lock screen stays mounted.

Fixed by adding `isInitialising` to the context — true only until the first lock-state and key-list read resolves — and gating on that instead. `tests/unit/ui/features/settings/options-app.test.tsx` now carries a guard that goes red if the gate is switched back to `isLoading`.

### 2. Passive effect cleanups cannot see a DOM ref

Both new teardowns were first written with `useEffect`. React detaches DOM refs during the mutation phase, **before** passive effect cleanups run, so on unmount `inputRef.current` and `privateKeyRef.current` were already `null` and both teardowns silently cleared nothing. Verified with a probe: a `useEffect` cleanup sees `null`, a `useLayoutEffect` cleanup still holds the element.

Both now use `useLayoutEffect`. `useExpiringClipboard.ts:135-153`, which this was modelled on, is unaffected — it nulls its own plain refs, not a DOM element ref.

A related observation for task 5.5: the pre-existing `privateKeyRef.current.value = ""` on the import success path (`OnboardingImportKey.tsx:210-212` before this change) is **dead on that path**. The import step unmounts when the flow advances to the password step, so `privateKeyRef.current` is already `null` by the time `handleSetPassword` runs. The line is preserved and is live on the new unmount path, where the import step may still be mounted. What actually held the key at that point was `privateKeyValueRef`, which was and is nulled.

## React Doctor

`no-giant-component` fired on `OnboardingImportKey` (threshold 300 lines) once this change's ~30 lines landed. Confirmed not pre-existing: reverting the file to `HEAD` cleared it. Addressed by moving `handleFileUpload` out of the component as a module-level `readSelectedKeyFile`, which needs none of the component's state. Behaviour-preserving; the suite is green either way. React Doctor now reports no issues.

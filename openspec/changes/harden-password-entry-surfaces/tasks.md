## 1. Establish The Failing Test First

- [ ] 1.1 Confirm the defect by hand before changing anything: with a vault created, submit a wrong password at the lock screen and record that no error appears, the field clears, and `onUnlock` fires. Note the observed behaviour in the change directory so the fix has a stated baseline.
- [ ] 1.2 Create `tests/unit/ui/features/authentication/lock-screen.test.tsx`. There is no LockScreen **unit** test today and `tests/unit/ui/features/settings/options-app.test.tsx:32-33` stubs the component out. The only existing coverage is `tests/e2e/vault-lock.spec.ts:179-215`, which drives the real component but asserts only that it renders and discloses nothing — it never submits a password, so it cannot catch this defect.
- [ ] 1.3 Write the acceptance test and watch it FAIL against current code: a wrong password renders an error AND does not invoke `onUnlock`.
- [ ] 1.4 Do NOT write these three assertions as acceptance criteria — each passes against the broken code today: that `setPassword("")` runs after an attempt; that the rendered HTML no longer contains the password; that the password is absent from storage. Record in the test file why they are insufficient.

## 2. Unlock Contract

- [ ] 2.1 Define an `UnlockResult` type in `src/ui/state/KeyManagerContext.tsx`: `{ ok: true }` or `{ ok: false; code: string; detail?: string }`.
- [ ] 2.2 Change `unlock` to return `Promise<UnlockResult>`, unwrapping `RpcClientError` inside the context so the error shape does not leak into components. `RpcClientError` is not the only throw: map `client.ts`'s four plain-`Error` paths — `no_response` (`:69`), `invalid_response_type` (`:73`), the legacy string path (`:86`) and `transport_error` (`:101`) — to one non-specific failure code, so none of them reaches the screen as a raw message.
- [ ] 2.3 Read `error.rpcError.data.errorCode` and `error.rpcError.data.details`. Do NOT read `error.message` — it is the machine string `rpc:<method>:<code>` built at `src/infrastructure/messaging/client.ts:17`.
- [ ] 2.4 Keep the `setLockState` success write and the `finally { setIsLoading(false) }` exactly as they are; only the failure path changes.
- [ ] 2.5 Update the `KeyManagerContextType` declaration at `KeyManagerContext.tsx:94` and the re-export in `src/ui/features/authentication/hooks/useKeyManager.ts:22`.
- [ ] 2.6 Run `pnpm run compile` and fix every consumer the type change surfaces.

## 3. Lock Screen Failure Reporting

- [ ] 3.1 Branch `handleUnlock` on `result.ok`. Move `onUnlock?.()` inside the success branch — it fires on failure today at `LockScreen.tsx:50`.
- [ ] 3.2 Clear the password on both branches, preserving the existing behaviour at `LockScreen.tsx:49`.
- [ ] 3.3 Map error codes to copy in the UI: incorrect password, throttled (with the wait), no vault created, vault damaged or unsupported. Render `details` only for codes where the background is known to carry a countdown in it.
- [ ] 3.4 Never render a background `details` string for an unrecognised code — fall back to a generic failure message. Note the residual this does not cover: a recognised code's `details` is still rendered verbatim, so editing one of those strings in the background reaches the screen without passing through the UI.
- [ ] 3.5 Verify against the whole of `handleUnlock` (`src/infrastructure/messaging/handlers/vault-rpc.ts:127-195`) that every failure the background can return has UI copy, and list any that do not. Note that `RPC_ERROR_CODES.INVALID_PASSWORD` is returned for two different causes — a schema-shape failure at `:134` and a genuinely incorrect password at `:164` — so the code alone does not identify the failure.
- [ ] 3.6 Delete `attemptCount` (`LockScreen.tsx:32`, `:52`) and the two UI blocks it drives (`:136-138`, `:192-200`).
- [ ] 3.7 Replace `onKeyPress` (`:110`, deprecated in React 19) with a `<form onSubmit>` wrapper, following `src/ui/components/dialogs/ReauthDialog.tsx:72`, so the Enter path and the button path share one guard.

## 4. Secret Input Hygiene

- [ ] 4.1 Add an `autoFocus?: boolean` prop to `src/ui/components/ui/password-input.tsx`, defaulting to `false` so existing callers including `ReauthDialog` are unchanged. Add a forwarded ref (or an `inputRef` prop) to the underlying `<input>` at `password-input.tsx:263-272` in the same edit — the component exposes no element handle today, and task 6.1 has nothing to clear without one.
- [ ] 4.2 Replace the bare `<Input>` in `LockScreen.tsx:104-114` with `PasswordInput`, passing `autoFocus` and an `idPrefix`. Do not enable `showStrengthMeter` — it defaults to `false` and an unlock must not evaluate the strength of a password the user cannot change here.
- [ ] 4.3 Confirm the reveal toggle and error styling still work through `PasswordInput` rather than being reimplemented beside it.
- [ ] 4.4 Fix the two other secret inputs already known to lack the attributes — the vault-password fields at `CreateKeyForm.tsx:62-69` and `ImportKeyForm.tsx:78-84` — then sweep `src/ui` for any further ones and list what was found. Import the shared constant from `password-input.tsx:23-29`; do not declare a second copy.

## 5. Key Import Flow Clearing

- [ ] 5.1 Add a clear action to the reducer action union in `src/ui/features/onboarding/components/OnboardingImportKey.tsx:35-43`, mirroring `clearSensitiveState` in `OnboardingCreateKey.tsx:125-135`.
- [ ] 5.2 Dispatch it on the success path at `OnboardingImportKey.tsx:206-216`, before the success step renders, so the component does not sit mounted holding the password.
- [ ] 5.3 Dispatch it on the error path.
- [ ] 5.4 Add an unmount effect that drops the password, the confirmation, and any key-material ref — the file currently contains no `useEffect` at all.
- [ ] 5.5 Confirm `privateKeyValueRef` and `privateKeyRef.current.value` are still cleared where they already are (`OnboardingImportKey.tsx:210-213`), and that the new clearing does not regress that. What that code does is overwrite a DOM property and drop a reference — not erase a string; describe it that way.

## 6. Input Element Clearing Where The Document Persists

- [ ] 6.1 Add a teardown that clears the input element's `value` on `pagehide` and on unmount, modelled on `src/ui/features/onboarding/backup/useExpiringClipboard.ts:135-153`.
- [ ] 6.2 Copy that file's constraint verbatim into the new code: no `setState` in the teardown path, because it runs while the component is being unmounted.
- [ ] 6.3 Scope it to the surfaces whose document outlives the attempt — the options page (`open_in_tab: true`, `wxt.config.ts:112-115`) and the side panel. Do not add it to the popup, where teardown does it already and a handler would look like a control that is not one.
- [ ] 6.4 State in a comment what this does and does not achieve: it drops the extension's own reference, it does not erase the string.

## 7. Tests

- [ ] 7.1 Confirm the task 1.3 acceptance test now PASSES, and that reverting the `result.ok` branch turns it red again.
- [ ] 7.2 Add a test per failure code proving the right copy renders: incorrect password, throttled with the wait shown, no vault, damaged vault.
- [ ] 7.3 Add a test proving the throttle wait is presented as a wait and NOT as an incorrect password.
- [ ] 7.4 Add a test proving no failure message contains the entered password.
- [ ] 7.5 Add a test proving an unrecognised error code renders the generic fallback rather than raw background text.
- [ ] 7.6 Add a test proving `onUnlock` is invoked exactly once on success and never on failure.
- [ ] 7.7 Add a test proving the lock screen password field carries the anti-autofill attributes.
- [ ] 7.8 Add a reducer test for `OnboardingImportKey` proving the new clear action empties the password and confirmation, modelled on `tests/unit/ui/features/onboarding/create-key-sensitive-state.test.ts`. A reducer is a pure function and cannot observe unmount, so add a **separate component test** proving the action is dispatched on success, on error, and on unmount.
- [ ] 7.9 Word every assertion as non-retention and reference-dropping, never as erasure, per `openspec/changes/restore-security-test-assurance/specs/security-test-assurance/spec.md:70-80`. The working shape is `tests/security/memory-zeroization.test.ts:401-435`.
- [ ] 7.10 Demonstrate each new protection failing: revert the `result.ok` branch, revert the import-flow clear action, and remove the autofill attributes, confirming a red test with a message naming the property in each case. Restore and confirm green, verifying with `git diff` that each restore is byte-identical.
- [ ] 7.11 Add Playwright coverage for a wrong password at the lock screen showing an error and remaining locked. The e2e harness already creates and locks vaults in `tests/e2e/vault-lock.spec.ts`.

## 8. Spec Reconciliation

- [ ] 8.1 Confirm the delta in `specs/ui-security/spec.md` is baselined on `openspec/changes/secure-key-backup-flow/specs/ui-security/spec.md:3-35`, not on the stale main baseline at `openspec/specs/ui-security/spec.md:6-13`, whose text predates the controlled-value caveat and still carries the dev-tools clause this change removes.
- [ ] 8.2 Record in the change directory that `enforce-password-policy` and `secure-key-backup-flow` both carry incompatible `MODIFIED` blocks for `### Requirement: Ephemeral Input State`, that neither is archived, and that archive order decides which survives.
- [ ] 8.3 Verify the dev-tools clause is removed by the `MODIFIED` rewrite of the `Password Entry` scenario, and that the requirement text records the mechanism error so a future reader does not reinstate it. Do NOT use a `REMOVED Requirements` block: the clause is a scenario bullet at `openspec/specs/ui-security/spec.md:13`, not a requirement, and a `REMOVED` block naming a requirement that does not exist would not validate.
- [ ] 8.4 Check whether any task in another change is still checked off against the deleted clause, and note it rather than silently leaving it.

## 9. Documentation

- [ ] 9.1 Update the `docs/v2-prd.md` SEC-003 status note to record the input-hygiene half as done and the realm split as outstanding. Do NOT flip the row to ✅ — `keyflow.html` and `welcome.html` are not built.
- [ ] 9.2 Add a CHANGELOG entry for the user-visible change: a failed unlock now says why, including how long a throttled user must wait.
- [ ] 9.3 Note in the changelog that this is a behaviour change for anyone who had learned to read the blank field as failure.

## 10. Verification

- [ ] 10.1 Run `openspec validate harden-password-entry-surfaces --strict`.
- [ ] 10.2 Run `pnpm run compile`.
- [ ] 10.3 Run `pnpm run lint`.
- [ ] 10.4 Run `pnpm exec vitest run` and report exact pass/fail counts.
- [ ] 10.5 Run `pnpm exec playwright test --project=chromium-extension` and report exact counts.
- [ ] 10.6 Run `pnpm run build` and `pnpm run build:firefox`.
- [ ] 10.7 Run `node_modules/.bin/react-doctor --scope changed --no-score` and address findings in changed files. Never invoke React Doctor via `npx`, `pnpm dlx`, or any `@latest` specifier.
- [ ] 10.8 Run `pnpm audit --prod`.
- [ ] 10.9 Manually confirm the original defect is gone: a wrong password shows an error naming the reason. Note that the screen already stays put today — `unlock` never clears `isLocked` on failure and both `onUnlock` callers are no-ops (`MainApp.tsx:34-40`, `OptionsApp.tsx:77`) — so "stays locked" is not evidence of the fix. The error text and the suppressed `onUnlock` are.

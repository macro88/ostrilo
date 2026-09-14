## Why

A wrong password at the lock screen is currently indistinguishable from a correct one.

`KeyManagerContext.unlock` wraps its whole body in `try/catch` and returns `false` instead of rethrowing (`src/ui/state/KeyManagerContext.tsx:243-260`), so it can never reject. `LockScreen.handleUnlock` calls `await unlock(password)` and discards the boolean (`src/ui/features/authentication/components/LockScreen.tsx:48`), so its `catch` block is unreachable in practice — it could only run if `onUnlock?.()` itself threw, and both call sites pass no-ops. On a wrong password the success path runs: `setError("")` has already cleared any message, the field blanks itself, and `onUnlock?.()` fires. The user sees an empty box and no explanation.

The background has already worked out exactly what went wrong and says so in detail — a throttle countdown in seconds, "Incorrect password. Further attempts are paused for N seconds.", "No vault exists yet.", and the corrupt- and unsupported-vault cases (`src/infrastructure/messaging/handlers/vault-rpc.ts:140-191`). All of it is discarded by the bare `return false` at `KeyManagerContext.tsx:256`. The unlock throttle shipped in `enforce-password-policy` is therefore invisible: a user being backed off has no way to learn that waiting is the answer, and their only available move is to type the master password again. That is a security cost, not just a usability one — it increases how many times the secret is entered and crossed between realms.

Two hygiene defects sit alongside it. `LockScreen`'s password field is one of three secret inputs in `src/ui` carrying no `autoComplete`/`spellCheck` attributes — the others are the vault-password fields in `CreateKeyForm.tsx:62-69` and `ImportKeyForm.tsx:78-84`. `secure-key-backup-flow` mandated those attributes for inputs that display or accept *private key material*; no requirement has ever covered password fields. This change extends the obligation to cover them. And `OnboardingImportKey.tsx` is the only password-bearing flow in `src/ui` that never clears its password at all: its reducer holds `password` and `confirmPassword` (`:29-30`), its action union has no clear action (`:35-43`), the file contains no `useEffect` at all, and the success path wipes the private-key ref but never the password — then renders the success step with the component still mounted. Its twin `OnboardingCreateKey.tsx` has both `clearSensitiveState` and `dropKeyMaterial`.

Finally, `LockScreen` still carries an `attemptCount` in component state (`:32`, `:136-138`, `:192-200`). That is the exact control `unlock-throttle.service.ts:6-10` names as the defect it replaced. It never increments — its only writer is inside the unreachable catch — so it now reads as a brute-force control that is neither working nor needed.

**What this change is not.** It is not "stop holding the master password in React state". `LockScreen` already clears that state on every attempt (`:49`), the `secure-key-backup-flow` delta explicitly permits a bounded controlled value — the main baseline spec does not yet, which is the conflict this change resolves — and `ReauthDialog.tsx:45` is the in-repo precedent for doing exactly that. A JavaScript string cannot be zeroized; `src/domain/utils/memory.ts:13-16` says so in terms. Nothing here claims otherwise.

## What Changes

- Make a failed unlock report itself. `KeyManagerContext.unlock` gains a result type carrying the background's error code and human-readable detail; `LockScreen` renders it. The throttle countdown, the missing-vault case and the damaged-vault case all become visible.
- Move `onUnlock?.()` to a genuine success branch. It fires on failure today. Both call sites pass no-ops, so nothing breaks now — but it must be correct before those props carry behaviour.
- Read `RpcClientError.rpcError.data.details` and `.errorCode`, not `error.message`. The latter is only the machine string `rpc:<method>:<code>` built at `client.ts:17`.
- Adopt the shared `PasswordInput` in `LockScreen`, and add both an `autoFocus` prop and a forwarded ref to that component — `autoFocus` so the most-used screen keeps its focus behaviour, and the ref because `PasswordInput` owns the `<input>` internally and exposes no element handle, which the input-clearing work below needs. This brings `NO_AUTOFILL_PROPS` with it — the only item in this change that targets an on-disk persistence risk rather than an in-memory one. It reduces rather than removes it: the component's own doc comment records that `autoComplete="off"` is advisory and that managers routinely ignore it.
- **BREAKING** (internal, no user-visible behaviour): `KeyManagerContext`'s `unlock` signature changes from `Promise<boolean>` to a result object. Sole consumer is `LockScreen` via `useKeyManager.ts:22`.
- Add a clear action to `OnboardingImportKey`'s reducer and call it on success, on error, and on unmount — matching `OnboardingCreateKey`.
- Clear the input element's value, not only component state, on the surfaces whose document outlives the attempt: `options.html` (a tab, `open_in_tab: true`) and `sidepanel.html`. The popup's teardown is platform behaviour the code does not control and is not claimed here.
- Delete `attemptCount` and the two UI blocks it drives. The real throttle lives in the background where an attacker on the message bus cannot skip it.
- Resolve a spec conflict this change cannot write around: `enforce-password-policy` and `secure-key-backup-flow` both carry `MODIFIED` blocks for `### Requirement: Ephemeral Input State`, and they are incompatible — one is an absolute prohibition on controlled values, the other permits a bounded one. Neither is archived, so whichever archives last silently wins.
- Delete the clause "MUST NOT trigger re-renders that expose the value to dev tools". The mechanism is wrong: re-rendering exposes nothing, and `document.getElementById('password').value` reads an uncontrolled input identically.

## Capabilities

### New Capabilities

- `unlock-feedback`: What the user is told when an unlock attempt fails — the distinction between a wrong password, a throttled attempt, an absent vault and a damaged one, and the requirement that a failure is never presented as a success.

### Modified Capabilities

- `ui-security`: `Ephemeral Input State` gains the anti-autofill obligation and the input-element clearing obligation, loses the incorrect dev-tools clause, and supersedes the two conflicting unarchived deltas with one text that carries the substance of both — including `enforce-password-policy`'s debounced-strength-feedback and confirmation-matching scenarios, which are implemented in code (`password-input.tsx:41`) and would otherwise be lost.

## Impact

- `src/ui/state/KeyManagerContext.tsx` — `unlock` result type and error propagation.
- `src/ui/features/authentication/hooks/useKeyManager.ts` — the re-exported contract.
- `src/ui/features/authentication/components/LockScreen.tsx` — error rendering, `PasswordInput` adoption, `onUnlock` placement, `attemptCount` deletion, deprecated `onKeyPress` replaced by a `<form onSubmit>`.
- `src/ui/components/ui/password-input.tsx` — an `autoFocus` prop and a forwarded ref to the underlying input.
- `src/ui/features/onboarding/components/OnboardingImportKey.tsx` — reducer clear action and teardown.
- `src/infrastructure/messaging/client.ts` — read-only; the `RpcClientError` shape is the contract being consumed.
- Tests: there is no `LockScreen` **unit** test today, and `tests/unit/ui/features/settings/options-app.test.tsx:32-33` stubs the component out entirely. The only existing coverage is `tests/e2e/vault-lock.spec.ts:179-215`, which drives the real component but asserts only that it renders and discloses nothing — it never submits a password.
- Docs: `docs/v2-prd.md` SEC-003 status note. The row stays 🔄 — the realm split (`keyflow.html` / `welcome.html`) is the other half and is not built.
- Coordination: this change claims `openspec/specs/ui-security/spec.md` as its delta target and must be archived after, or merged with, the two conflicting deltas named above.

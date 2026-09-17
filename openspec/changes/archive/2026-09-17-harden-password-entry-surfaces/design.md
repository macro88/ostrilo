## Context

`enforce-password-policy` shipped a persistent, background-enforced unlock throttle (`src/application/services/unlock-throttle.service.ts`, added in commit `8761c29`). `harden-vault-key-derivation` shipped the structured unlock errors that distinguish a wrong password from a damaged or absent vault, and `enforce-password-policy` added the throttle countdown to their `details` (`src/infrastructure/messaging/handlers/vault-rpc.ts:140-179`). Neither is visible to the user, because the UI layer between them discards every failure.

`KeyManagerContext.unlock` (`src/ui/state/KeyManagerContext.tsx:243-260`) catches everything and returns `false`. `LockScreen.handleUnlock` (`:40-56`) ignores that boolean. The result is that the `catch` block in `LockScreen` is unreachable, and its three consequences all follow from that one fact: no error message, an attempt counter that never increments, and `onUnlock?.()` firing on failure.

The two call sites currently pass no-op `onUnlock` handlers (`MainApp.tsx:35-38`, `OptionsApp.tsx:77`), and `isLocked` in context is unchanged by a failed unlock, so the lock screen stays put. This is a silent-failure and feedback defect today, not an authentication bypass. It becomes a bypass the moment either `onUnlock` prop is given real behaviour, which is why it is worth fixing now rather than when something depends on it.

This change was originally filed as "LockScreen holds the master password in React state". It does — `LockScreen.tsx:29` is `useState("")` and `:108` is `value={password}` — but that is not a defect. `LockScreen.tsx:49` clears the password on every attempt, `secure-key-backup-flow`'s `Ephemeral Input State` explicitly permits a bounded controlled value, and `ReauthDialog.tsx:45` is the in-repo precedent. The change was renamed to describe the defects that exist.

## Goals / Non-Goals

**Goals:**

- A failed unlock is reported, with the reason the background actually gave.
- The unlock contract cannot silently report failure as success.
- Every secret input in `src/ui` carries the autofill, password-manager and spell-check opt-outs, from one shared declaration. These are advisory attributes and vendor conventions, not enforcement — `password-input.tsx:16-21` says so — so the goal is to stop offering the field, not to guarantee nothing captures it.
- The key import flow clears its password like the key creation flow already does.
- The input element's value — not only component state — is cleared on surfaces whose document outlives the attempt.
- The dead `attemptCount` is removed rather than left looking like a brute-force control.
- One coherent `Ephemeral Input State` requirement, replacing two incompatible unarchived deltas.

**Non-Goals:**

- Zeroizing the password. A JavaScript string cannot be erased (`src/domain/utils/memory.ts:13-16`). No requirement, task or test here says otherwise.
- Hiding the password from anything running in the same realm. A compromised in-bundle dependency, React DevTools, or a heap snapshot all defeat every option available here. Moving from `useState` to `useRef` does not change that, and this change does not claim it.
- Reducing or clearing the copy the RPC boundary makes. `browser.runtime.sendMessage` structured-clones the password into the background realm; neither side can reach the other's copy. `password-input.tsx:35-38` already records this.
- Closing SEC-003. The other half is the realm split (`keyflow.html` / `welcome.html`), which is not built. The PRD row stays 🔄.
- Changing the throttle policy, the password policy, or anything in the background.
- Popup teardown behaviour, which the code does not control.

## Decisions

### 1. Change the `unlock` contract rather than rethrow

`KeyManagerContext.unlock` becomes `Promise<UnlockResult>` where `UnlockResult` is `{ ok: true }` or `{ ok: false; code: string; detail?: string }`.

Rethrowing was the alternative. It keeps the declared type simpler, but it pushes `try/catch` into every future caller and makes it easy to reintroduce exactly this defect by writing a caller that does not catch. A result object makes the failure case hard to ignore *by accident*: any code that reads a field of the result must first narrow on `ok`. It does not make discarding the result a compile error — `await unlock(password); onUnlock?.();` still type-checks, which is exactly the shape of the current defect. That remains a review and test obligation, which is why the acceptance test is "does not invoke `onUnlock`" rather than a type.

The context, not `LockScreen`, unwraps `RpcClientError`. That keeps `client.ts`'s error shape from leaking into a component, and gives one place to map codes to copy.

### 2. Read `rpcError.data.errorCode` and `.details`, never `error.message`

`RpcClientError.message` is the machine string `rpc:<method>:<code>` built at `client.ts:17`. Rendering it would show the user `rpc:vault.unlock:invalid_password`. The human-readable text is in `.data.details`, which the background populates with the countdown and the vault-state cases.

Copy is chosen in the UI from the code, with `details` used where it carries a value the UI cannot compute (the throttle countdown). An unrecognised code never renders its `details`, so a *new* background error cannot put unexpected text on screen. A recognised code's `details` is still rendered verbatim, so editing one of those strings in the background does reach the user — that is intentional for the countdown and is the residual to keep in mind.

`RpcClientError` is not the only thing `client.ts` throws. It also throws plain `Error` for `no_response` (`:69`), `invalid_response_type` (`:73`), a legacy string path (`:86`) and `transport_error` (`:101`). The context maps all four to one non-specific failure code, so none of them reaches the screen as a raw message.

### 3. Adopt `PasswordInput` in `LockScreen` and give it `autoFocus`

`LockScreen` renders a bare `<Input>` (`:104-114`) with no autofill attributes. `PasswordInput` already carries `NO_AUTOFILL_PROPS` (`password-input.tsx:23-29`) and is what `ReauthDialog` uses.

The three deltas: `PasswordInput` has no `autoFocus` prop, it derives `id`/`htmlFor` from `idPrefix`, and it owns the `<input>` internally (`password-input.tsx:263-272`) while exposing no ref or element handle — so Decision 5's input-element clearing has nothing to clear unless a forwarded ref is added at the same time. The first is a real UX regression on the app's most-used screen if left unfixed, so `autoFocus` is added to the shared component rather than dropped. The alternative — spreading `NO_AUTOFILL_PROPS` onto the existing `Input` — is a smaller diff but leaves two password-field implementations to drift.

`showStrengthMeter` defaults to `false` (`password-input.tsx:230`), so adopting it fires no `crypto.evaluatePassword` RPC. An unlock must not evaluate strength: the password predates any policy, and telling a user their own correct password is weak at the moment they cannot change it is noise.

### 4. Replace `onKeyPress` with a form

`onKeyPress` (`LockScreen.tsx:110`) is deprecated in React 19. The empty-password guard at `:41-44` is only reachable via Enter, because the button is `disabled={... || !password.trim()}` (`:145`). Wrapping in `<form onSubmit>` as `ReauthDialog.tsx:72` does collapses both paths onto one guard and removes the deprecated handler.

### 5. Clear the input element only where it matters

Component state clearing already happens. The gap is the DOM node's value on surfaces where the document is not torn down: `options.html` (`open_in_tab: true`, `wxt.config.ts:112-115`) and `sidepanel.html`.

The reusable shape is the `pagehide` + unmount flush at `useExpiringClipboard.ts:135-153`, including its constraint: no `setState` in the teardown path, because it runs while the component is unmounting.

This is deliberately scoped. Adding it everywhere would be cargo-cult: in the popup, teardown does it for free, and a handler there would be code that looks like a control and is not.

### 6. Delete `attemptCount` rather than repair it

`unlock-throttle.service.ts:6-10` names it as the defect it replaced: component state, so closing and reopening the popup reset it, and an attacker on the message bus never saw it. Repairing it would recreate a client-side control that the real throttle already supersedes. Warnings about repeated attempts now come from the background's throttle state, which is where they are enforced.

### 7. Baseline the spec delta on `secure-key-backup-flow`, and say why

Three texts exist for `### Requirement: Ephemeral Input State`:

| Source | Position |
|---|---|
| `openspec/specs/ui-security/spec.md` (current main baseline) | Absolute prohibition; contains the incorrect dev-tools clause at `:13`; its Purpose is still the archive placeholder |
| `enforce-password-policy/specs/ui-security/spec.md` | Absolute prohibition, extended to derived values; contradicts itself by then requiring the comparison to "read the current input values ephemerally"; specifies a generated-passphrase feature that does not exist in `src` |
| `secure-key-backup-flow/specs/ui-security/spec.md` | Permits a bounded controlled value; explicitly disclaims zeroization |

Neither delta is archived, neither change has an open `- [ ]` task (both carry deferred `- [~]` items, including the UI-side throttle countdown this change picks up), and whichever archives last silently overwrites the other. This change baselines on the `secure-key-backup-flow` text because it is the only one that matches what the code actually does and the only one that does not overclaim. It then carries over the two `enforce-password-policy` scenarios whose obligations are implemented and would otherwise be silently lost on archive — debounced strength feedback (`password-input.tsx:41`, `STRENGTH_DEBOUNCE_MS`) and confirmation matching without persisting either value. It does **not** carry over that text's generated-passphrase scenario, because no such feature exists in `src`. The dev-tools clause is deleted in the rewritten `Password Entry` scenario, with a tombstone recording the mechanism error.

Archiving order matters. This change must archive after both, or the conflicting deltas must be reconciled at archive time.

### 8. `OnboardingImportKey` is in scope

It is the genuine no-clearing site: reducer state holding `password` and `confirmPassword` (`:29-30`), an eight-member action union with no clear action (`:35-43`), no `useEffect` in the file, and a success path (`:206-216`) that wipes the private-key ref but not the password before rendering the success step with the component still mounted.

Its twin `OnboardingCreateKey.tsx` already has `clearSensitiveState` (`:125-135`) and `dropKeyMaterial` (`:157-162`). The fix is to mirror that, not to invent a mechanism.

Including it makes the change's title broader than "lock screen", which is why the change is named for password entry surfaces rather than for one component.

## Risks / Trade-offs

- **Changing the `unlock` return type touches a shared context** → Sole consumer is `LockScreen` via `useKeyManager.ts:22`. `tsc` will find any other. The change is mechanical and type-checked.
- **New error copy could leak something** → Copy is selected in the UI by error code; `details` is rendered only for codes where the background is known to put a countdown in it. A spec scenario forbids any failure message containing the password or key material, and task 7.4 takes on writing the test — no such test exists today. Note the residual: for a *recognised* code the UI still renders `details` verbatim, so a future edit to the background's detail string reaches the screen without passing through this change.
- **Adding `autoFocus` to `PasswordInput` affects `ReauthDialog`** → The prop defaults to `false`, so existing callers are unchanged.
- **The `pagehide` handler is throwaway work if the realm split lands** → Accepted. SEC-003's realm split is not scheduled, the options page ships today, and the handler is roughly fifteen lines modelled on an existing one.
- **Tests that pass vacuously** → Three obvious assertions already pass against the broken code: that `setPassword("")` runs after unlock, that the container HTML does not contain the password, and that the password is not in storage. None of them catches this defect — the bogus success path clears the field too. The acceptance test must be that a wrong password renders an error *and* does not invoke `onUnlock`. There is no `LockScreen` test in the repo today, and the one file that references it stubs it out (`options-app.test.tsx:32-33`).
- **Recording the dev-tools deletion** → The clause is a scenario bullet at `openspec/specs/ui-security/spec.md:13`, not a requirement of its own, so it is removed by the `MODIFIED` rewrite of `Password Entry` rather than by a `REMOVED Requirements` block. A `REMOVED` block naming a requirement that does not exist would not validate against the baseline. The mechanism error is recorded in the requirement text and here, so a future reader does not reinstate it.

## Migration Plan

No data migration, no storage format change, no RPC contract change. The `unlock` signature change is internal to the UI layer and compile-checked.

Rollback is a revert: nothing here writes state that a previous version could not read.

## Open Questions

- Should this change also amend `openspec/specs/key-vault/spec.md:14` and `:25`, which state the unachievable "immediately zeroizes the password"? It is the wording that produced an already-checked-off impossible task at `enforce-password-policy/tasks.md:30`. Out of scope as written, but it is the same class of error as the dev-tools clause this change removes.
- `openspec/specs/ui-security/spec.md` still carries the literal placeholder `TBD - created by archiving change harden-security-posture. Update Purpose after archive.` as its Purpose. Worth fixing on archive.
- Does the throttle warning need its own live countdown in the UI, or is reporting the wait at attempt time sufficient? A live countdown means a timer in the lock screen; the background is authoritative either way.

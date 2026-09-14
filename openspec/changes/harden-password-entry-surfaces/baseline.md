# Observed baseline before the fix

Recorded for task 1.1. The baseline was established by driving the real
`LockScreen` component with a wrong password through the acceptance test in
`tests/unit/ui/features/authentication/lock-screen.test.tsx`, rather than by
hand: the automated form observes the same three facts and leaves a record that
stays true.

With a vault created and locked, submitting an **incorrect** password:

1. **No error appears.** `KeyManagerContext.unlock` catches every failure and
   returns `false` (`src/ui/state/KeyManagerContext.tsx:254-257`), so
   `LockScreen`'s `catch` block never runs and `setError` is never called.
2. **The field clears** — `LockScreen.tsx:49` runs on the success path, which a
   failed unlock also takes.
3. **`onUnlock` fires** — `LockScreen.tsx:50`, on the same success path.

The lock screen nonetheless stays put, because `unlock` does not clear
`isLocked` on failure and both `onUnlock` call sites are no-ops
(`MainApp.tsx:34-40`, `OptionsApp.tsx:77`). "Stays locked" is therefore not
evidence about this defect in either direction.

Three assertions that pass against this broken code, and so cannot be
acceptance criteria (task 1.4):

- that `setPassword("")` runs after an attempt — it does, on the bogus success path;
- that the rendered HTML no longer contains the password — it does not, for the same reason;
- that the password is absent from storage — it was never written there.

The acceptance criteria are: a wrong password renders an error, **and**
`onUnlock` is not invoked.

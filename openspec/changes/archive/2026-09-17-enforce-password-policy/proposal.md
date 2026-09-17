## Why

The vault password is the only thing standing between a copied `chrome.storage.local` file and a user's Nostr identity, and today that password can be four characters. `evaluatePasswordStrength` computes a correct verdict and exposes `meetsMinimum` as `score >= 3 && password.length >= 8`, but the onboarding gate ignores that field and re-implements half the check as `strength.score < 3`. Dropping the length term makes the gate satisfiable by character variety alone: `Aa1!` scores mixed case, digit and symbol for a total of 3 and is accepted. The key-creation form on the options page performs no strength check at all, and `PasswordSchema` at the RPC boundary is `min(1)`. The only real password policy in the product lives inside one React component, and every path that does not go through that component accepts a single character.

Nothing throttles guessing either. The lock screen counts attempts and renders a warning, but applies no delay, no backoff and no lockout, and the counter is component state, so closing the popup resets it. Against the current PBKDF2-SHA256 key derivation at 100,000 iterations, roughly 10^6 guesses per second on one inexpensive GPU rig, a four-character password falls in about a minute and a typical eight-character human password in under five minutes. This change moves the policy to the trust boundary, raises the floor to a length that survives offline attack, and moves the failed-unlock throttle into the background worker where closing a window cannot reset it.

## What Changes

- Define one password policy in the domain layer as the single source of truth, and enforce it at the RPC boundary and in `KeyVaultService` so every creation path inherits it.
- **BREAKING** Replace `PasswordStrength.meetsMinimum` with an explicit `acceptable` verdict plus machine-readable violation codes, so no caller can reconstruct a partial predicate from `score`. `score` becomes display-only.
- Raise the minimum for a newly created vault password from 8 characters to 12, drop the character-class mandate, and steer users toward a passphrase.
- Add offline dictionary, pattern and repetition resistance so `Password123!` and `qwertyuiop12` are rejected on their structure rather than passed on their character variety. No network call is made with a password or any prefix of its hash.
- Add an optional offline passphrase generator so the recommended answer is one click away.
- Give the options-page creation form the same strength feedback, confirm field and enforcement the onboarding wizard has, and make the confirm field mandatory wherever the password is new.
- Add persisted exponential backoff for failed unlock attempts in the background worker, surviving MV3 service-worker restarts and popup closes, with a visible countdown and a hard cap rather than a permanent lockout.
- Keep the policy off the verification paths. `vault.unlock` and `vault.reveal` continue to accept any non-empty password so existing users are not locked out of their own vaults, and instead see a dismissible advisory when their password is below the current policy.

Re-encrypting an existing vault under a new password does not ship in this change. `vault.changePassword` is deferred so it can share the single re-encryption pass that `harden-vault-key-derivation` already needs.

## Capabilities

### New Capabilities

- `password-policy`: One authoritative vault password policy, enforced on every creation path, with offline strength evaluation, dictionary and pattern resistance, and a passphrase affordance.
- `unlock-throttling`: Persisted exponential backoff on failed vault unlock attempts, owned by the background worker and not resettable from the UI.

### Modified Capabilities

- `rpc-validation`: `Strict Input Validation` must reject policy-violating new passwords at the boundary instead of accepting any non-empty string.
- `key-vault`: add service-layer password policy enforcement for key creation and import, alongside the existing zero-retention password handling.
- `ui-security`: `Ephemeral Input State` must cover the new strength feedback, confirm field and generated passphrase without persisting any of them in component state.

## Impact

- Domain: `src/domain/utils/validation.ts` gains the policy constants, the verdict type, the violation codes and the structural checks; `evaluatePasswordStrength` loses `meetsMinimum`.
- Validation schemas: `src/infrastructure/validation/schemas.ts` splits `PasswordSchema` into a transport-hygiene schema for verification paths and a policy schema for new passwords.
- RPC handlers: `vault-rpc.ts` applies the policy schema to `vault.generate` and `vault.import` for first-key creation and translates the service policy error; `crypto-rpc.ts` keeps evaluating weak passwords so the meter can explain them, and gains the passphrase generator method.
- Application services: `KeyVaultService.generateKey` and `KeyVaultService.importKey` replace `if (!password)` with the shared policy check when they are creating the first key; `unlock` consults and updates the persisted throttle state.
- UI: `OnboardingCreateKey`, `CreateKeyForm`, `PasswordInput` and `LockScreen` change from enforcement points to feedback surfaces, with the lock screen rendering the throttle state reported by the background worker.
- Tests: new unit coverage for the policy predicate and the throttle schedule, RPC-level tests proving a four-character password is rejected without any UI involved, and Playwright coverage of both creation paths.
- Dependency: `harden-vault-key-derivation` raises the work factor behind this policy. Until it lands the password carries the entire boundary alone, which is why the minimum chosen here is set against the current KDF rather than the intended one.
- Bundle: any bundled wordlist must be measured against the background bundle budget of 150KB gzipped.

## Context

The vault password is the root of Ostrilo's security model. Every `KeyRecord` in `chrome.storage.local` is AES-GCM ciphertext whose key is derived from that password, so an attacker who copies the storage file has an offline guessing problem and nothing else. The current product places no meaningful lower bound on how hard that problem is.

There are four surfaces that create or re-encrypt a key, and no two of them agree:

- `OnboardingCreateKey.validatePassword` calls `evaluatePasswordStrength` and gates on `strength.score < 3`, with a comment claiming score is the better signal.
- `OnboardingImportKey.validatePassword` contains the same `strength.score < 3` gate, a second copy of the same mistake.
- `CreateKeyForm.handleGenerateKey` validates the password as `if (!password)` and has no strength evaluation and no confirmation field.
- `ImportKeyForm.handleImportKey` does the same.

The domain function they all call already computes the right answer. `evaluatePasswordStrength` returns `meetsMinimum: score >= 3 && password.length >= 8`, and the two onboarding callers reimplement half of it. Dropping the length term makes the gate satisfiable by character variety alone: `Aa1!` earns a point for mixed case, one for a digit and one for a symbol, earns nothing for length, totals 3, and is accepted. The strength meter compounds it, because `getStrengthLabel(3)` renders "Good" for that same password.

Behind those components there is no policy at all. `PasswordSchema` is `z.string().min(1).max(1000)` and guards `vault.unlock`, `vault.generate`, `vault.import`, `vault.reveal` and `crypto.evaluatePassword`. `KeyVaultService.generateKey` and `importKey` check `if (!password)`. The existing unit test asserts that `PasswordSchema.safeParse("a")` succeeds. So the only real password policy in the product lives inside two React components, both of which enforce it incorrectly, and every other path accepts one character.

The verdict shape is also declared three times: `PasswordStrength` in `src/domain/utils/validation.ts`, an inline generic argument in `client.ts`, and a locally redeclared interface in `password-input.tsx` with a comment explaining that it is not imported. Three declarations of one contract is how a caller ends up inventing its own predicate.

Nothing throttles guessing. `attemptCount` in `LockScreen` renders "(N attempts)" and a warning after three tries. It applies no delay, no backoff and no lockout, and because it is component state, closing the popup resets it. `VaultRpcHandler.handleUnlock` validates the password shape and calls `context.vault.unlock` with no throttle. Guessing through the UI is bounded only by KDF cost.

That KDF is `pbkdf2(sha256, password, salt, { c: 100_000, dkLen: 32 })`. At roughly 10^6 guesses per second on one inexpensive GPU rig:

| Password | Time to crack |
| --- | --- |
| 4 characters | about 1 minute |
| typical 8-character human password | under 5 minutes |
| typical 12-character human password | about 2 weeks |
| 4 random Diceware words | about 140 years |

A companion change, `harden-vault-key-derivation`, raises that work factor toward Argon2id. Until it lands the password carries the entire security boundary by itself, and even after it lands the table is the honest basis for the floor: 8 characters is not a policy, it is a rounding error. The two changes are complementary and neither is sufficient alone. A strong KDF cannot save a four-character password, and a strong password should not have to compensate for a weak KDF.

## Goals / Non-Goals

**Goals:**

- Enforce the password policy at the trust boundary so every creation path inherits it, including paths that do not exist yet.
- Define the policy exactly once, and make it structurally impossible for a caller to construct a partial predicate.
- Set a minimum length that is defensible against the crack-time table, and steer users toward a passphrase rather than a character-class puzzle.
- Reject structurally guessable passwords using offline checks only.
- Throttle failed unlock attempts in the background worker, persisted so the popup cannot reset it and the service worker cannot forget it.
- Avoid locking existing users out of their own vaults.

**Non-Goals:**

- No `vault.changePassword` and no re-encryption of existing key records. That work belongs with `harden-vault-key-derivation`, which must re-encrypt every record anyway.
- No online breach-corpus lookup, no k-anonymity hash-prefix request, no telemetry about password quality.
- No biometric or WebAuthn unlock. `handleBiometricUnlock` stays a stub.
- No password recovery, escrow, hint or reset. The `nsec` backup remains the only recovery path.
- No per-key passwords. The vault continues to use one password for all keys.
- No rate limiting of RPC methods other than `vault.unlock`.

## Decisions

### Decision 1: The trust boundary enforces the policy, the UI only explains it

Enforcement moves to two places that both call the same domain function:

- `VaultRpcHandler` validates `vault.generate` and `vault.import` with a policy schema when the request would create the first key in the vault.
- `KeyVaultService.generateKey` and `importKey` run the same check before generating or encrypting anything, and throw `password_policy_violation`, which the handler translates.

The four UI surfaces stop being gates. They render the verdict, block their own submit button as a courtesy, and are no longer the thing standing between a one-character password and an encrypted key record.

**Rationale:** The current arrangement fails in the most predictable way possible. Two components enforce a policy, two do not, and the boundary underneath enforces nothing, so the security property depends on which button the user pressed. Putting the check where the vault is mutated makes the property hold for every caller, including a future settings screen, a future CLI, or a compromised popup.

Two layers rather than one is deliberate: the schema gives a clean `invalid_password` response at the boundary with no service work, and the service check means the invariant holds even if a handler is added later that forgets the schema. They cannot drift because they call the same function.

**Alternative considered:** Enforce only in the service and let the handler translate the error. Simpler, one check, but it leaves the boundary schema asserting `min(1)`, which is exactly the misleading signal that let this bug survive. The schema should say what the system actually requires.

### Decision 2: Replace `meetsMinimum` rather than fix its callers

`PasswordStrength` becomes:

```ts
export interface PasswordVerdict {
  acceptable: boolean;            // the only acceptance predicate
  violations: PasswordViolation[];// machine codes for rejection reasons
  requirements: PasswordRequirement[];
  score: 0 | 1 | 2 | 3 | 4;       // display only
  blocklistChecked: boolean;
}
```

`meetsMinimum` is removed, not repaired. The single exported entry point is `checkPassword(password, options)` in a new `src/domain/utils/password-policy.ts`, and `PasswordVerdict` is exported once and imported by `client.ts` and `password-input.tsx` instead of being redeclared.

Two properties make the original bug unrepresentable:

- Removing `meetsMinimum` turns every existing caller into a compile error, so the migration is exhaustive rather than best-effort. `score` remains, but with nothing else to compare against, `strength.score < 3` reads as obviously wrong.
- `acceptable` is false whenever `blocklistChecked` is false. A caller that evaluates a password without the blocklist, which is what the UI does for instant local feedback, can report violations and a score but can never report `acceptable: true`. Partial evaluation cannot green-light a password.

**Rationale:** The comment on the offending line is the tell. A reviewer read `meetsMinimum` versus `score`, judged `score` the better signal, and shipped it. A field that invites callers to second-guess it is a bad contract, and renaming the semantics is not enough while the old field still compiles.

**Alternative considered:** Keep `meetsMinimum` and fix the two onboarding callers. Cheapest change, and it leaves the same trap for the next contributor and the two unchecked forms still bypass it entirely.

### Decision 3: Minimum 12 characters, no character-class mandate, warning band to 20

The policy constants live in one object in the domain module:

- Hard floor: reject below 12 characters, violation `too_short`.
- No character-class requirement at all. Mixed case, digits and symbols are not required and are not presented as requirements.
- Warning band: 12 to 19 characters is accepted with a prominent "weak" verdict and a passphrase prompt.
- Recommended: 20 or more characters, or a generated passphrase, renders as strong.
- Transport limit stays at 1000 characters.

Reading the table against those numbers: 4 characters falls in a minute and 8 in under five minutes, so both are indefensible for a signer. A typical 12-character human password takes about 2 weeks against the current KDF. Two weeks is not comfort, but it is the point where the attack stops being casual and starts requiring sustained, targeted effort, and it is roughly 5,000 times harder than the 8-character case for one extra typed word. Four random Diceware words reach about 140 years, which is the actual target, and 20 characters is the length at which a typed phrase gets into that neighbourhood.

Counting character classes is the wrong axis. `Aa1!` satisfies three classes in four characters and dies in a minute; `unmark thicket parcel` satisfies one class and does not. Class rules add a fixed handful of bits at most while pushing users toward the `Password1!` shape that appears in every leak corpus, and they let a short password look compliant. Length multiplies the search space, so length is what the policy measures.

**Rationale:** 12 is the floor rather than 20 because the floor should be the point below which we refuse to create a vault, not the point we would like users to reach. A hard 20-character floor at first run, before the user has anything invested, is the kind of friction that sends people to a different signer, and it would still accept a badly chosen 20-character string. The floor blocks the indefensible; the generator and the warning band do the steering.

**Alternative considered:** Set the floor at 16 or 20 and accept the abandonment cost. Defensible if the KDF stays weak, and worth revisiting once `harden-vault-key-derivation` lands, since a stronger KDF changes what a given length buys. Recorded in Open Questions rather than settled here.

**Alternative considered:** Keep 8 and rely on the score. This is the status quo, and 8 characters is under five minutes.

### Decision 4: Split the schema so the policy applies to creation, not verification

`src/infrastructure/validation/schemas.ts` grows a second schema:

- `PasswordSchema` keeps its current meaning as transport hygiene, non-empty and at most 1000 characters. It continues to guard `vault.unlock`, `vault.reveal`, and `crypto.evaluatePassword`.
- `NewPasswordSchema` wraps `checkPassword` with the blocklist and guards `vault.generate` and `vault.import` when the vault holds no keys.

The distinction is not cosmetic. `KeyVaultService.validatePasswordAgainstExistingKeys` means that adding a second key requires the user to re-enter the existing vault password, and `unlock` obviously does too. If the policy were applied to those paths, a user whose vault was created last month under an 8-character password would be told their own correct password is invalid, and would be locked out of keys they still hold, with no change-password flow to escape through. The policy governs the moment a password is chosen. Everywhere else the password is being checked against ciphertext, which is a stronger test than any policy.

The handler decides which schema applies by asking whether any key records exist. That is one extra storage read on a rare operation. `KeyVaultService` makes the same determination from the `listKeys()` call it already performs.

`crypto.evaluatePassword` deliberately keeps the hygiene schema. A meter that returns an error instead of a verdict for a weak password cannot tell the user what is wrong with it.

**Rationale:** The most common way a password policy causes damage is by being applied to authentication instead of enrolment. Locking existing users out of their own Nostr identities would be a worse outcome than the weak password we are trying to fix.

**Alternative considered:** Apply the policy everywhere and add a forced change-password flow in the same change. Cleaner end state, but it requires re-encrypting every `KeyRecord` under a new salt, and `harden-vault-key-derivation` has to do exactly that migration. Building it twice is waste, and building it here in a hurry against key material is risk.

### Decision 5: Offline blocklist plus structural rules, lazily loaded in the background

Rejection reasons that apply regardless of length:

- `common_password`: the normalized candidate appears in a bundled common-password list. Normalization lowercases, folds common leet substitutions, collapses whitespace and strips trailing digits and punctuation, so `Password123!` reduces to `password` and is caught.
- `repeated_characters`: a single character or a short unit repeated to fill the length.
- `sequential_characters`: runs such as `abcdefghijkl` or `123456789012`.
- `keyboard_pattern`: walks such as `qwertyuiop12`.
- `product_term`: the whole password is built from `ostrilo`, `nostr`, `npub`, `nsec` or the key label being created.

Structural rules are pure code with no data cost. The list is a bundled asset in its own module, imported with `await import()` inside the background handler, following the pattern `crypto-rpc.ts` already uses for `evaluatePasswordStrength` and `parsePrivateKey`. It is therefore in a lazily loaded background chunk, not in the popup bundle and not in the background entry chunk.

Sizing: start with the top 10,000 normalized common passwords, roughly 80KB raw and 25KB gzipped, and measure. The background bundle budget is 150KB gzipped and the current output is around 503KB uncompressed, so this is a real number and not a rounding error. If the measurement puts the build over budget, fall back to the top 2,000, which covers the overwhelming majority of real-world reuse once the 12-character floor has already removed the short entries. The task list makes the measurement a gate rather than an afterthought.

The UI gets the authoritative verdict from the existing debounced `crypto.evaluatePassword` RPC, so the list exists once, in the background, and the meter and the enforcement path cannot disagree. For instant feedback while typing, the UI calls `checkPassword` locally without the blocklist, which by Decision 2 can surface length and pattern violations but can never return `acceptable: true`.

No network call is made with a password, a hash of a password, or any prefix of such a hash. Ostrilo makes no external API calls for core functionality and a breach lookup would be the first, on the most sensitive value in the product. If an online check is ever added it must be explicitly opt-in per use, and a fully offline list is preferred regardless.

**Rationale:** The strength meter's current blind spot is not a missing character class, it is that it has no idea `Password1!` is one of the most common passwords in existence. A bundled list is the only way to know that without asking someone.

**Alternative considered:** Heuristics only, no wordlist. Zero bundle cost, and it does catch the structural cases, but it cannot distinguish `harbourlanterns` from `iloveyoubaby12`. Kept as the documented fallback if the budget forces it.

**Alternative considered:** Full zxcvbn. Excellent quality and a well-understood scoring model, but roughly 400KB minified with its frequency dictionaries, which is out of the question against a 150KB gzipped background budget, and it adds a runtime dependency to the layer that holds key material.

### Decision 6: Bundle a passphrase generator and make it the recommended answer

A new `crypto.generatePassphrase` RPC returns a passphrase of N words, default 6, selected with `crypto.getRandomValues` from the 1,296-word EFF short wordlist. The wordlist is lazily imported in the background alongside the blocklist, roughly 8KB raw and 4KB gzipped. The UI offers a "Generate a passphrase" control next to the new-password field, writes the result directly into the input element, and never places it in component state, storage or logs.

Six words from a 1,296-word list is about 62 bits, roughly a thousand times the four-word Diceware baseline in the table, which puts it far beyond the 140-year figure and keeps it comfortable no matter what the KDF change settles on. The EFF short list is chosen over the classic 7,776-word Diceware list because its words are at most five characters and easy to retype, and because 7,776 entries cost around 30KB gzipped to reach a weaker 4-word figure. Six short words is about 32 characters, so a generated passphrase clears the recommended band by construction.

The generator is offered, never imposed. A user who wants to type their own phrase can, subject to the floor.

**Rationale:** A policy that only rejects teaches users to append `1!` until the meter turns green. Giving them the recommended answer in one click is the difference between a policy that produces strong passwords and one that produces annoyed users with `Password123!`. Diceware beats a complex short password here because the threat is offline enumeration, where only the size of the search space matters, and because a phrase of real words is far more likely to be remembered, which matters when the only recovery path is an `nsec` backup.

**Alternative considered:** Guidance copy with no generator. No bundle cost, but it leaves the user to invent randomness, which is the one thing humans are reliably bad at.

### Decision 7: Persisted exponential backoff in the background worker

A new `UnlockThrottleService` in the application layer owns the throttle, and `VaultRpcHandler.handleUnlock` consults it before calling `context.vault.unlock`. State lives under a single `unlockThrottle` key in `storage.local`:

```ts
type UnlockThrottleState = {
  failedAttempts: number;
  firstFailureAt: number;
  lastFailureAt: number;
  lockedUntil?: number; // epoch ms
};
```

Schedule, applied to the attempt count after the free attempts:

| Failed attempts | Delay before next attempt |
| --- | --- |
| 1 to 3 | none |
| 4 | 5 seconds |
| 5 | 15 seconds |
| 6 | 60 seconds |
| 7 | 5 minutes |
| 8 | 15 minutes |
| 9 | 30 minutes |
| 10 or more | 60 minutes, capped |

Mechanics that matter:

- `storage.local`, not `storage.session`. Session storage dies with the browser session, and the lock state already lives in session storage precisely because it should. Throttle state must outlive the popup, the service worker and the browser.
- A `lockedUntil` timestamp, not a `setTimeout`. MV3 tears the worker down after roughly 30 seconds of inactivity, so any in-memory timer is a bypass. Remaining time is always computed as `lockedUntil - Date.now()`.
- The check runs before key derivation, so a throttled attempt costs the attacker a message round trip and costs us nothing.
- Refusal returns machine code `rate_limited` with `retryAfterMs` in the error data. The message says the same thing regardless of how wrong the password was.
- Three free attempts, because a legitimate user mistypes and a caps-lock key exists, and punishing the first typo is how a security control gets a bad reputation.
- Success resets the counter to zero. No failure for 24 hours also resets it, so a forgotten afternoon does not become a permanent handicap.
- Hard cap at 60 minutes. No permanent lockout, no wipe-after-N-attempts. A destructive lockout is an attacker-triggerable denial of service against the user's own identity, and the user's real protection against a stolen storage file is the KDF, not the counter.

The honest limitation: throttling only governs guessing through the RPC boundary. An attacker who copies the ciphertext out of `chrome.storage.local` attacks it offline where no throttle exists, which is precisely the attack `harden-vault-key-derivation` addresses. Throttling raises the cost of the opportunistic case, an unlocked laptop or a borrowed browser profile, and nothing more. It must not be described as protection against offline attack.

Recovery for a legitimately locked-out user: wait out the countdown, which the lock screen displays and which resumes correctly after the popup is closed and reopened, or restore from the `nsec` backup captured during onboarding into a fresh profile. The UI never offers deleting the vault as a recovery step.

**Rationale:** The current counter is UI decoration. Any control that a user can reset by closing a window is not a control. Putting it in the worker with a persisted deadline makes it survive everything the UI can do to it.

**Alternative considered:** Throttle inside `KeyVaultService.unlock`. Reasonable, and it keeps the check adjacent to the KDF call, but the service is already doing key derivation, decryption, session state and settings work; a separate service is easier to test in isolation and easier to reuse if a future `changePassword` needs the same treatment.

**Alternative considered:** Progressive KDF cost instead of a wall-clock delay. Elegant, since it slows the attacker with real work rather than a timestamp, but it changes derivation parameters per attempt, which collides directly with the KDF migration and would make that change harder.

### Decision 8: Confirmation is required exactly where the password is new

Confirmation becomes mandatory on the onboarding create and import steps and on the options-page create and import forms when the vault holds no keys. It is deliberately not added when the vault already holds a key, because the password is then verified against existing ciphertext, and verification against real key material is a strictly better typo check than comparing two boxes the user filled in the same way.

The confirm field also gains a purpose it does not have today, since a mistyped 32-character generated passphrase with no confirmation and no recovery path is a permanently lost identity.

**Rationale:** Confirmation exists to catch typos in a value that nothing else can check. Where something else can check it, a second box is friction for no gain.

**Alternative considered:** Require confirmation everywhere for consistency. Predictable, but it asks the user to type a long passphrase twice for an operation that already validates it against stored ciphertext.

### Decision 9: Reuse the existing canonical error codes

No new entries in `RPC_ERROR_CODES`. Policy rejections use `invalid_password`, which the `rpc-error-codes` spec already defines for "a vault unlock or key generation request" whose password "fails validation rules". Throttled attempts use `rate_limited`, already defined for a caller exceeding a limit. `RpcErrorData` gains one optional `retryAfterMs` field, which is additive and does not alter any existing requirement, and `error.data.details` carries the safe, user-actionable reason without ever echoing the password.

**Rationale:** The canonical set already covers both cases, and the existing spec requires exact-equality assertions against `error.data.errorCode`. Adding near-duplicate codes would force churn in the error-code spec, the numeric mapping and every test that enumerates codes, for no behavioural gain.

**Alternative considered:** A dedicated `password_policy` code. More precise, and it would make the error-code spec a fifth modified capability for a distinction the client does not act on differently.

## Risks / Trade-offs

- [Risk] A 12-character floor at first run increases onboarding abandonment. -> Mitigation: the generator makes a compliant passphrase one click away, the floor is the lowest number the crack-time table supports rather than the ideal, no character-class puzzle is imposed, and the copy explains what the password is protecting instead of listing rules.
- [Risk] Existing users hold below-policy passwords and this change does not fix them. -> Mitigation: stated as scope. Verification paths deliberately keep accepting those passwords so nobody is locked out; a successful unlock records a boolean flag and shows a dismissible advisory; the actual re-encryption ships with `harden-vault-key-derivation`, which has to re-encrypt every record regardless. Only the flag is persisted, never the password.
- [Risk] Users who cannot create an additional key because their vault password predates the policy would be a regression. -> Mitigation: this is the specific failure Decision 4 exists to prevent, and it is covered by a scenario in both the `password-policy` and `key-vault` deltas.
- [Risk] The blocklist pushes the background bundle over the 150KB gzipped budget. -> Mitigation: lazy `await import()` keeps it out of the entry chunk, the size is measured as a verification task, and a 2,000-entry fallback is pre-agreed so the decision does not get relitigated under build pressure.
- [Risk] The debounced strength RPC sends the plaintext password to the background on every pause in typing. -> Mitigation: this already happens today in `password-input.tsx`; it is an in-extension message and never a network request; debouncing reduces the frequency, and the cheap local checks cover the common case without a message at all. The alternative, shipping the blocklist into every UI context, is worse for both bundle size and copies of the data.
- [Risk] A legitimate user hits a 60-minute delay and believes their keys are gone. -> Mitigation: three free attempts before any delay, a live countdown that survives reopening the popup, copy that names both recovery paths, decay to zero after 24 quiet hours, a hard cap, and no destructive step offered anywhere.
- [Risk] Throttling is mistaken for protection against a stolen storage file. -> Mitigation: say so explicitly in the spec, the design and the UI copy, and keep the dependency on `harden-vault-key-derivation` visible.
- [Risk] Removing `meetsMinimum` breaks callers and tests. -> Mitigation: that is the point. The field is declared in three places and asserted in three test files, `tests/test-crypto.ts`, `tests/unit/domain/utils.test.ts` and `tests/unit/domain/domain-utils.test.ts`; `pnpm run compile` enumerates the source references, and the existing assertion that `PasswordSchema.safeParse("a")` succeeds moves to the hygiene schema where it is still true.
- [Trade-off] Two enforcement layers instead of one is mild duplication, accepted because both call the same domain function and cannot diverge, and because the schema should not tell readers the boundary requires one character.

## Migration Plan

1. Land the domain policy module, the verdict type and the structural rules first, with unit tests. Nothing enforces anything yet.
2. Add the blocklist and wordlist modules, measure the gzipped background bundle, and confirm the budget before proceeding.
3. Switch the boundary and the service to the new predicate. At this point a four-character password is rejected at the RPC layer regardless of UI, which is the property the change exists to establish.
4. Update the four UI surfaces to render the verdict, add the confirm fields and the generator control, and re-anchor the score so a rejected password can never render as "Good".
5. Add the throttle service and wire `handleUnlock`, then the lock-screen countdown.
6. No data migration. No stored `KeyRecord` changes shape, no re-encryption occurs, and `unlockThrottle` is absent-means-zero.
7. Rollback: reverting the boundary and service checks restores the previous behaviour with no stored-data cleanup, since the only new key is `unlockThrottle` and a stale value expires on its own.

## Open Questions

- Should the floor rise from 12 to 16 once `harden-vault-key-derivation` lands, given the table shifts by orders of magnitude with Argon2id? Raising it later only affects new vaults, so deferring costs nothing.
- Is 6 words the right generator default, or should it be user-selectable between 5 and 8?
- Should the below-policy advisory appear once and stay dismissed, or reappear on a schedule until a change-password flow exists to act on it?
- Should `vault.reveal`, which exposes an `nsec` to the UI, share the unlock throttle? It takes the same password and is a second guessing oracle, though it is only reachable from an unlocked extension.

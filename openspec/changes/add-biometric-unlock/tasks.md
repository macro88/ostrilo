## 1. Measure Before Committing To Anything

The kill criterion in `proposal.md` governs this group. If it fires, stop — do not start group 3.

- [x] 1.1 Build a throwaway unpacked Chromium extension (`spike/`) with a pinned manifest `key` and a page that calls `create()` with `rp.id` omitted, `pubKeyCredParams: [-7, -257]` (nothing verifies the signature, so the algorithm list exists only to avoid refusing an authenticator; Windows Hello has historically offered RS256 only), `attestation: "none"`, `authenticatorSelection: { userVerification: "required", residentKey: "discouraged" }` and `extensions: { prf: {} }`, then `get()` with `prf.eval.first` and `rpId` omitted.
- [ ] 1.2 Run it against every row of the authenticator table in `design.md` Context: macOS 15+ with iCloud Keychain; macOS with Google Password Manager; **macOS with neither configured**, to capture what Chrome's own Touch ID authenticator does; Windows 11 with Windows Hello; Linux with Google Password Manager; ChromeOS; and a CTAP2 security key on each. Record per row: which chooser appears, whether `prf.enabled` is true at create, whether the following `get()` returns 32 real bytes, whether a second `get()` returns the same bytes, the backup-eligible and backup-state bits, and what entry the user is left with in the platform's credential manager.
- [ ] 1.3 For every row that returns output, repeat the `get()` with `userVerification: "discouraged"` and record whether the same 32 bytes come back without a verification prompt. A row that leaks the output this way is not offered.
- [x] 1.4 (created window, options tab, popup and side panel measured on macOS; a background tab was not, and neither flow uses one) Start the same ceremony from a `windows.create` window, a foreground options tab, a **background** options tab, the action popup and the side panel, and record whether it starts and completes in each. The design needs the created window (unlock) and the foreground options tab (enrolment).
- [ ] 1.5 Time the daily flow on one platform: toolbar icon, `Unlock with your device`, authenticator prompt, window closes, popup reopened — against typing the master password. Record both.
- [ ] 1.6 (Apple Passwords done; other classes open) Check what each authenticator class does when its credential has been deleted in the platform manager: an error, a timeout, or a prompt that cannot complete. This settles the "permanently unusable" definition in `design.md` Open Questions.
- [x] 1.7 Write everything into `openspec/changes/add-biometric-unlock/prf-platform-matrix.md`, following the `kdf-measurements.md` precedent.
- [x] 1.8 (verdict: proceed, Windows unmeasured — release-blocking row still open) Evaluate the result against the kill criterion and record the verdict in that file: proceed, proceed narrowed, or withdraw. If narrowed, draft the replacement SEC-009 sentence now, before any code is written.
- [x] 1.9 Write the failing lock-gate expectation naming all five new method names — `tests/security/lock-gate.test.ts` enumerates the RPC union from source and fails on an unclassified method.
- [x] 1.10 Write the failing build-output expectation: `unlock.html` present and clean in `.output/chrome-mv3`, absent from `.output/firefox-mv3`.

## 2. Land The Extension-Identifier Prerequisite

Separate change `pin-extension-id`, proposed and implemented 2026-11-25; not yet published. The public key is read off the Chrome Web Store listing.

- [x] 2.1 Propose `pin-extension-id` and read the assigned public key off the Chrome Web Store listing.
- [x] 2.2 Add it as manifest `key` inside `wxt.config.ts`'s manifest factory, branched so Firefox does not receive it — mirror the existing `env.browser === "firefox" ? {} : { use_dynamic_url: true }`. An unknown top-level key must not ship to AMO.
- [x] 2.3 Add per-target expectations to `tests/security/manifest-assertions.test.ts`: the Chromium manifest declares the key and its value is stable; the Firefox manifest declares none. Follow the `expectsSidePanelPermission` pattern.
- [x] 2.4 (unpacked production build and development build both showed `nhodljdjlljpapclgcjmhajpgodanchk` on 2026-11-25; the store build is confirmed when 2.6 ships) Confirm the built extension identifier is identical for `pnpm run build`, the dev build and the store build.
- [x] 2.5 Document in `docs/vault-storage-format.md` that an identifier change makes every biometric wrapping unrecoverable and the password becomes the only route.
- [ ] 2.6 Publish it. No enrolment path may ship before the pinned identifier is live.

## 3. Prepare The Vault Service

- [x] 3.1 Extract the per-record loop of `unlockNow` into `private async openVaultWithKek(kek, envelope, records, settings, password: string | null)` with no behaviour change. `discardUnlockedKeys` already zeroizes held keys before a re-unlock; keep it inside the extraction.
- [x] 3.2 Confirm every existing unlock, lock, auto-lock and `password-rotation-durability` test still passes.

## 4. Domain Layer: Types And AAD

- [x] 4.1 Add `BIOMETRIC_WRAPPER_VERSION`, `PASSWORD_REHEARSAL_DAYS = 30`, `BiometricFactor` and `VaultBiometricRecord` to `src/domain/types.ts`.
- [x] 4.2 Add `AAD_DOMAIN.bio = "ostrilo/vault-bio-wrap"` and `bioWrapAad(...)` to `src/domain/crypto/aad.ts`, reusing `kdfFields`, binding exactly the fields in `design.md` Decision 4.
- [x] 4.3 Extend the AAD encoder tests: fixed-vector output, a different byte for every single-field change including each KDF cost field, and a domain-separation assertion that a wrapped-KEK blob is not accepted where a wrapped DEK is expected.
- [x] 4.4 Add `src/domain/platform/build-target.ts` exporting `IS_CHROMIUM_BUILD` from `import.meta.env.BROWSER`.

## 5. Crypto Port And Adapter

- [x] 5.1 Add `CryptoHkdf.deriveAeadKey(ikm: SecretBytes, info: Uint8Array, usages): Promise<CryptoKey>` to `src/application/ports/crypto.ts`, with a documentation comment stating it returns a non-extractable key and never bytes, and why (`memory.ts` cannot zeroize a `CryptoKey`).
- [x] 5.2 Implement `VaultHkdf` in `src/infrastructure/crypto/adapters.ts` over `crypto.subtle` HKDF-SHA256 with an empty salt. Add RFC 5869 vectors.
- [x] 5.3 Add an AEAD port method that decrypts and encrypts under a supplied non-extractable `CryptoKey`, in the existing `crypto.subtle` adapter. No second AES-GCM implementation.
- [x] 5.4 Confirm `tests/security/crypto-single-implementation.test.ts` and `pnpm run lint` still pass, and that `package.json` gained no dependency.

## 6. WebAuthn Ceremony Port And Adapter

- [x] 6.1 Add `src/application/ports/webauthn.ts` declaring `WebAuthnCeremony` with `probe()`, `enroll(prfSalt)` and `assert(credentialId, transports, prfSalt)`.
- [x] 6.2 Implement `src/infrastructure/webauthn/webauthn-ceremony.adapter.ts`. Omit the RP ID entirely. `pubKeyCredParams: [-7, -257]` (nothing verifies the signature, so the algorithm list exists only to avoid refusing an authenticator; Windows Hello has historically offered RS256 only), `attestation: "none"`, `userVerification: "required"`, `residentKey: "discouraged"`. The challenge is random bytes the adapter generates and nothing checks; say so in a comment, so nobody later mistakes it for a replay defence. Never use `evalByCredential` at create.
- [x] 6.3 Implement enrolment as `create()` followed immediately by `get()`; fail unless the assertion returns exactly 32 PRF bytes. Never treat `prf.enabled` as proof of delivery. On failure, call `PublicKeyCredential.signalUnknownCredential` where it exists, and report that an entry may remain.
- [x] 6.4 Read the backup-eligible flag from byte 32 of `getAuthenticatorData()` with an explicit length check. No other field of authenticator data, client data or the attestation object is read.
- [x] 6.5 Return the PRF output as an owned byte buffer and zeroize the adapter's own view in a `finally`.
- [x] 6.6 Add a test asserting `navigator.credentials` appears in exactly one module under `src/`, that only the ceremony document and the options page import it, and that the background bundle contains no reference to it.

## 7. Biometric Factor Service

As built: the factor service owns the wrapping and the refusal reasons, and `KeyVaultService` orchestrates (`unlockWithFactor`, `enrollBiometric`, `forgetBiometric`), because the KEK, the envelope verifier and the write lock are private to the vault. `kekFromFactor` is `BiometricFactorService.unwrapKek` followed by the vault's verifier proof. The throttle check in 7.2 is applied at the RPC layer in 9.4.

- [x] 7.1 Create `src/application/services/biometric-factor.service.ts`, the only reader and writer of `vaultBiometric`. Static imports only.
- [x] 7.2 Implement `kekFromFactor(credentialId, prfOutput)` in this order: throttle check; refuse when a `vaultRotation` journal is present or any record is unversioned; refuse when rehearsal is due or this is the first unlock of the browser session; load the factor and compare the credential id in constant time; derive the wrapping key; unwrap; prove the recovered key against the envelope verifier. The first three refusals record no throttle failure; an unwrap or verifier failure records one.
- [x] 7.3 Implement `enroll(password, …)`: obtain the live KEK via `kekForWrite(password)`, derive the wrapping key, encrypt under `bioWrapAad`, then unwrap and byte-compare before writing anything. The background holds nothing between requests — one RPC carries the password and the output.
- [x] 7.4 Implement `forget()`, `status()`, `unlockRequest()` and `touchPasswordUnlock()`. `status()` returns usability, the enrolment date, the synced flag when unlocked, and the named reason an unlock cannot be attempted; never the credential id or label. Zeroize the PRF buffer, every intermediate and any candidate KEK in their own `finally` blocks.
- [x] 7.5 Delete the factor record inside `saveEnvelope`, before the envelope is written. Add a test for each caller: envelope creation in `kekForWrite` and `unlockNow`, `commitRotation`, and both branches of `recoverInterruptedRotation`. A completed password change leaves no factor record.
- [x] 7.6 Enforce at most one enrolled factor: a successful enrolment over an existing one replaces it in a single write, and a failed one leaves the existing record intact and still usable.
- [x] 7.7 Implement the first-unlock-after-restart rule: a session-storage marker set on the first successful password unlock of a browser session, absent after a restart or extension update, required by `kekFromFactor`.

## 8. Vault Service Integration

- [x] 8.1 Add `unlockWithFactor(...)` to `KeyVaultService`, run under `writeLock` like `unlock`, calling `openVaultWithKek(kek, …, password: null)` so the in-memory key map is repopulated before the session record is written.
- [x] 8.2 Add `authFactor?: "password" | "biometric"` to `LockState` and write it on both unlock paths. Read an **absent** value as `password` so a session opened by the previous build is not force-locked on upgrade; an unrecognised value reads as locked.
- [x] 8.3 In `unlockNow`, update `lastPasswordUnlockAt` only when a factor record exists, and set the browser-session marker from 7.7.
- [x] 8.4 Leave `kekForWrite`, `verifyPassword`, `revealKey` and `changePassword` untouched.

## 9. RPC Surface And Error Codes

As built: the handlers live in `handlers/biometric-rpc.ts`, called from `VaultRpcHandler`. A wrong password given to `vault.biometricEnroll` returns `invalid_password` under the shared throttle, as every other password check does; every biometric-specific refusal returns `biometric_rejected` with one fixed detail. On a build without the feature the methods exist and refuse, so a refusal does not distinguish the build.

- [x] 9.1 Add the five methods to the `RpcRequest` union in `src/infrastructure/messaging/rpc.ts` and handlers to `handlers/vault-rpc.ts`.
- [x] 9.2 Add zod schemas to `src/infrastructure/validation/schemas.ts`: bounded credential id, exactly-32-element byte arrays with 0–255 element bounds for the PRF output and salt, bounded transports. The unlock schema has no field by which a document reports that verification succeeded.
- [x] 9.3 Add `vault.biometricStatus`, `vault.biometricUnlockRequest`, `vault.biometricUnlock` and `vault.biometricForget` to `LOCKED_REACHABLE_METHODS`; leave `vault.biometricEnroll` lock-gated.
- [x] 9.4 Wire the throttle through the existing `withPasswordThrottle` shape: check before reading the factor; record success on a genuine unlock; record failure on an unwrap or verifier failure; never on a cancellation or a password-needed refusal.
- [x] 9.5 `BIOMETRIC_UNAVAILABLE` is returned only by `vault.biometricStatus`. Every unlock and enrolment refusal returns `BIOMETRIC_REJECTED` with one fixed detail string.
- [x] 9.6 Add `BIOMETRIC_UNAVAILABLE` (-32007) and `BIOMETRIC_REJECTED` (-32008) with the four-edit protocol: a documentation block immediately above each constant, a `RPC_NUMERIC_ERROR_CODES` entry, a `RPC_ERROR_MESSAGES` entry, and a section each in `docs/rpc-error-codes.md`. `tests/unit/infrastructure/error-code-coverage.test.ts` enforces three of the four.
- [x] 9.7 Add the client wrappers in `src/infrastructure/messaging/client.ts`.

## 10. The Ceremony Document And The Build Guards

- [x] 10.1 Create `src/extension/unlock/` with `index.html`, `main.tsx` and `UnlockCeremonyApp.tsx`: the mascot, one line of context, one ghost Cancel. Fetches the unlock request, runs the ceremony on load, closes itself when the RPC resolves.
- [x] 10.2 Hold the PRF output in a ref, never in component state, and zeroize it in a `finally` and on unmount.
- [x] 10.3 Handle a refusal or a vault that locked underneath an open window: the window says the password will unlock it, rather than hanging.
- [x] 10.4 Give the entrypoint a Chromium-only target filter so it is absent from the Firefox build.
- [x] 10.5 Make `KEY_HANDLING_DOCUMENTS` target-aware and add `unlock.html` as a Chromium-only entry, with a justification comment matching the style of the existing four.
- [x] 10.6 Update `tests/security/key-handling-bundle.test.ts` so a target-scoped document is asserted present and clean in its own target and asserted **absent** from the others, instead of read unconditionally from every target's output.

## 11. Lock Screen And Settings UI

As built: the lock screen keeps no ceremony state, because the popup that hosts it closes when the ceremony window opens. The cancelled, refused, paused and forget-offer states of 11.3 are rendered by the ceremony window; the lock screen renders the affordance and the three password-needed lines. Not built: a password pre-check, so a mistyped password at enrolment creates a passkey that the browser is then asked to discard.

- [x] 11.1 (not needed: the ceremony window reports its own outcome through `UnlockCeremonyOutcome`, so the password `UnlockResult` is unchanged) Widen `UnlockResult` in `src/ui/state/KeyManagerContext.tsx` with the biometric variants and extend the unlock-failure copy.
- [x] 11.2 Add the ghost `Unlock with your device` button to `LockScreen` between the notched `Unlock` primary and the closing trust line. Render it only when the build is Chromium and the status method reports a usable factor with no password-needed reason. `Unlock` stays the only notched primary. The button opens the ceremony window via `browser.windows.create`.
- [x] 11.3 Render the designed states: cancelled (no error text, focus returned to the password field); refused; rate-limited (existing countdown copy); rehearsal-due, restart-pending and password-needed-once (one explained line each, not styled as errors); permanently unusable (a no-credential `Forget biometric unlock` action); and the same action offered after two consecutive ceremonies that ended without an output, since a deleted passkey is indistinguishable from a cancel.
- [x] 11.4 Add the biometric section to `SecuritySettingsTab` using the existing `SettingsSection`, `SettingsRow` and `Switch` primitives. Enrolment goes through the existing `useReauth`/`ReauthDialog` pattern and then runs the ceremony **in this tab**, sending the password and the output in one `vault.biometricEnroll` request and clearing both when it settles. Forget is ungated. List the enrolled factor with the date it was added and whether it syncs. Render an explanatory non-interactive row when the capability check fails, and nothing at all on non-Chromium builds — never a disabled control.
- [x] 11.5 Add the designed state for an authenticator that completed the ceremony and returned no output: nothing enrolled, which kinds of authenticator work, and that a passkey entry may remain in the platform's credential manager.
- [x] 11.5a Add the retryable state for a ceremony that ended without a credential (cancelled, or refused by a provider such as 1Password): nothing enrolled, the providers `prf-platform-matrix.md` records as working, and a fresh password prompt on retry.
- [x] 11.6 Add the enable-time disclosure copy as part of the section body: the password remains required and cannot be removed; unlocking this way cannot reveal or export a key; deleting the credential loses only the shortcut; a credential that syncs makes this factor as strong as that account — stated first when the spike shows only synced providers answer on the platform; biometric unlock may be compelled where a password may not; and enrolment is per-browser-profile. Never name a biometric modality.
- [x] 11.7 Add the one explanatory line to `ReauthDialog` when the session was opened biometrically, and the re-enrol line to `ChangePasswordDialog`'s success panel, shown only when a factor was enrolled.
- [x] 11.8 Follow `docs/design/DESIGN_RULES.md`: tokens only, no emoji, no pill buttons, mint never decorative, 44px hit targets, focus drawn inside any clipped element, and any new shape utility declared with `@utility` in `tailwind.css`, never `@layer components`.

## 12. Tests

- [x] 12.1 `tests/security/biometric-password-boundary.test.ts`: drive the handlers, not the dialog — in a biometric session, `vault.reveal`, `vault.generate`, `vault.import`, `vault.deleteKey`, `vault.changePassword`, the two `REAUTH_SETTINGS_FIELDS` timeouts, the three password-gated policy cases and `vault.biometricEnroll` are all refused without the password and succeed with it. Record in the test that lowering a trust level, a deny or ask rule, disabling a grant and `policy.removeOrigin` are **not** password-gated in either session, so nobody later reads the suite as proving a property it does not test.
- [x] 12.2 `tests/security/biometric-wrapper.test.ts`: a wrong PRF output, a rewritten credential id, a rewritten PRF salt, a flipped backup-eligible flag, a rolled-back KDF cost and a swapped envelope each fail to yield a key; a rewritten wrapping yields a key that fails the envelope verifier; the password still opens the vault after enrol and after forget; a legacy record refuses both enrol and unlock; a rotation journal refuses unlock and is left byte-identical; every envelope write deletes the factor; a second enrolment replaces the first and the replaced credential no longer unlocks.
- [x] 12.3 `tests/security/biometric-zeroize.test.ts`: the PRF output buffer and any recovered KEK are zeroized after use on success and on every failure path, asserted by observing buffer contents rather than spying on the zeroize helper.
- [x] 12.4 Extend `tests/security/unlock-throttle.test.ts`: shared counter across both paths; a cancellation and a password-needed refusal record nothing; an unwrap failure records one.
- [x] 12.5 Unit tests for the AAD encoder, the HKDF adapter, the ceremony adapter's create-then-get contract and its flags-byte read, `LockScreen` and `SecuritySettingsTab`.
- [x] 12.6 `tests/e2e/fixtures/webauthn.ts` using `newCDPSession` and `WebAuthn.addVirtualAuthenticator({ hasPrf: true, hasUserVerification: true, isUserVerified: true })`, plus `tests/e2e/biometric-unlock.spec.ts` driving the control by accessible role. Write into the spec file the caveat that a virtual authenticator proves neither the production relying-party identifier nor any real provider.

## 13. Documentation And Design Review

- [x] 13.1 Document the `vaultBiometric` record, its AAD, and the no-version-bump rationale in `docs/vault-storage-format.md`, plus the rule that an envelope write deletes the wrapping, and the plain statement that a PRF output with a copy of extension storage yields the KEK.
- [x] 13.2 Add the five methods and their lock dispositions to the privilege table in `docs/rpc-architecture.md`, and the two codes to `docs/rpc-error-codes.md`.
- [x] 13.3 Rewrite SEC-009 in `docs/roadmap.md` with the platform matrix the spike actually produced.
- [x] 13.4 Add capture steps to `docs/design-review/capture-screenshots.mjs` for: the lock screen with the affordance, and in its cancelled, refused, rehearsal-due, restart-pending, password-needed and unusable-factor states; the Security tab enrolled, not enrolled, capability-failed and no-output; and the ceremony document itself.
- [x] 13.5 Run the review as two separate invocations, one per theme, against a **populated** vault, and record it in `docs/design-review/README.md`. A fresh vault has hidden a shipped layout bug before.

## 14. Verification

- [x] 14.1 `openspec validate add-biometric-unlock --strict`.
- [x] 14.2 `pnpm run compile`.
- [x] 14.3 `pnpm run lint` — no `@noble/*` or `@scure/*` import outside `src/infrastructure/crypto/`.
- [x] 14.4 `pnpm run test:coverage` — including `tests/security/lock-gate.test.ts`, `tests/security/reauth-boundary.test.ts`, `tests/security/reveal-requires-password.test.ts` (must still pass untouched), `tests/security/password-rotation-durability.test.ts`, `tests/security/crypto-single-implementation.test.ts` and `tests/unit/infrastructure/error-code-coverage.test.ts`.
- [x] 14.5 `pnpm run test:build-output` — no `host_permissions` on either target; the permission set is still exactly `storage`/`windows`/`alarms`/`idle` plus the build-tool side-panel entry; `unlock.html` present and clean in `.output/chrome-mv3` and **asserted absent** from `.output/firefox-mv3`.
- [x] 14.6 (2026-11-25: 168 passed; `session-keepalive.spec.ts:89` failed once inside the full run and passed when rerun on its own) `pnpm run test:e2e`.
- [x] 14.7 `pnpm run build` and `pnpm run build:firefox` — both succeed, and a grep of the Firefox output finds no `navigator.credentials`, no `PublicKeyCredential`, no `vaultBiometric` and no ceremony entrypoint. The five method names remain, because the methods are defined in every build and refuse there.
- [x] 14.8 `pnpm run doctor` — the pinned local binary, never `npx` or an unpinned specifier. Report the score; do not gate on it.
- [x] 14.9 `pnpm audit --prod` — unchanged, since no production dependency was added.
- [x] 14.10 `pnpm run slop:changes`, and `pnpm run slop:ci` to reproduce the gate.
- [ ] 14.11 (done: UI judged from the production build in both themes; a manual ceremony on macOS with Apple Passwords is recorded. Open: Windows) Judge the UI from `pnpm run agent:loop:prod`, then perform and record a manual ceremony on each target operating system in `prf-platform-matrix.md`. A green CI run does not prove the shipped surface.

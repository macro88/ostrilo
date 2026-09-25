## 1. Measure Before Committing To Anything

The kill criterion in `proposal.md` governs this group. If it fires, stop — do not start group 3.

- [ ] 1.1 Build a throwaway unpacked Chromium extension with a pinned manifest `key` and a page that calls `create()` with `rp` omitted, `pubKeyCredParams: [-7]`, `attestation: "none"`, `authenticatorSelection: { userVerification: "required", residentKey: "discouraged" }` and `extensions: { prf: {} }`.
- [ ] 1.2 Run it on macOS 15+, Windows 11 (24H2 26100.7840+ / 25H2 26200.7840+, Chrome 147+), Linux and ChromeOS, against both a platform authenticator and a CTAP2 security key. Record per platform: which authenticator chooser appears, whether `prf.enabled` is true at create, whether a following `get()` with `prf.eval.first` returns 32 real bytes, the BE and BS bits, and whether `getPublicKey()` and `getAuthenticatorData()` are populated.
- [ ] 1.3 Record the exact bytes of the registration `authenticatorData` rpIdHash and the exact `clientDataJSON.origin` string, and confirm an assertion's rpIdHash equals the registration's. This is what makes recording-rather-than-computing safe.
- [ ] 1.4 Start the same ceremony from a `windows.create` window, a foreground options tab, a **background** options tab and a side panel, and record whether it starts at all in each. Chrome requires `GetVisibility() == VISIBLE`.
- [ ] 1.5 Write everything into `openspec/changes/add-biometric-unlock/prf-platform-matrix.md`, following the `kdf-measurements.md` precedent.
- [ ] 1.6 Evaluate the result against the kill criterion and record the verdict in that file: proceed, proceed narrowed, or withdraw. If narrowed, draft the replacement SEC-009 sentence now, before any code is written.
- [ ] 1.7 Write the failing security test: a second `unlock()` over a live session zeroizes previously held private keys before the in-memory map is cleared. Fails today at `key-vault.service.ts:611`.
- [ ] 1.8 Write the failing lock-gate expectation naming all six new method names — `tests/security/lock-gate.test.ts` enumerates the RPC union from source and fails on an unclassified method.
- [ ] 1.9 Write the failing build-output expectation: `unlock.html` present and clean in `.output/chrome-mv3`, absent from `.output/firefox-mv3`.

## 2. Land The Extension-Identifier Prerequisite

Separate change `pin-extension-id`. The public key is read off the existing Chrome Web Store listing.

- [ ] 2.1 Read the assigned public key off the Chrome Web Store listing.
- [ ] 2.2 Add it as manifest `key` inside `wxt.config.ts`'s manifest factory, branched so Firefox does not receive it — mirror the existing `env.browser === "firefox" ? {} : { use_dynamic_url: true }` at `wxt.config.ts:155`. An unknown top-level key must not ship to AMO.
- [ ] 2.3 Add per-target expectations to `tests/security/manifest-assertions.test.ts`: the Chromium manifest declares the key and its value is stable; the Firefox manifest declares none. Follow the `expectsSidePanelPermission` pattern at `:345-356`.
- [ ] 2.4 Confirm the built extension identifier is identical for `pnpm run build`, the dev build and the store build.
- [ ] 2.5 Document in `docs/vault-storage-format.md` that an identifier change makes every biometric wrapping unrecoverable and the password becomes the only route.
- [ ] 2.6 Publish it. No enrolment path may ship before the pinned identifier is live.

## 3. Fix The Defect This Change Amplifies

- [ ] 3.1 Extract `key-vault.service.ts:611-665` into `private async openVaultWithKek(kek, envelope, records, settings, password: string | null)` with no behaviour change.
- [ ] 3.2 Inside the extraction, zeroize every buffer held in the in-memory key map before clearing it, mirroring `lock()` at `:765-767`.
- [ ] 3.3 Confirm the 1.7 test now passes and every existing unlock, lock and auto-lock test still does.

## 4. Domain Layer: Types, AAD And Wire Parsers

- [ ] 4.1 Add `BIOMETRIC_WRAPPER_VERSION`, `PASSWORD_REHEARSAL_DAYS = 30`, `BiometricFactor` and `VaultBiometricRecord` to `src/domain/types.ts`, and `authFactor?: "password" | "biometric"` to the session lock state type.
- [ ] 4.2 Add `AAD_DOMAIN.bio = "ostrilo/vault-bio-wrap"` and `bioWrapAad(...)` to `src/domain/crypto/aad.ts`, reusing `kdfFields`, and encoding the algorithm as the string `"ES256"` because `numField` throws on negative integers (`aad.ts:48-50`).
- [ ] 4.3 Extend the AAD encoder tests: fixed-vector output, a different byte for every single-field change including each KDF cost field, and a domain-separation assertion that a wrapped-KEK blob is not accepted where a wrapped DEK is expected.
- [ ] 4.4 Add `src/domain/webauthn/authenticator-data.ts`: minimum length 37, rpIdHash bytes 0–31, flags at byte 32 (UP `0x01`, UV `0x04`, BE `0x08`, BS `0x10`), signCount bytes 33–36. No attested-credential-data walk.
- [ ] 4.5 Add `src/domain/webauthn/client-data.ts`: strict JSON reader checking `type`, base64url `challenge`, `origin`, and that `crossOrigin` is not true. Reject anything else.
- [ ] 4.6 Add `src/domain/webauthn/spki-p256.ts`: constant 26-byte prefix match, 65-byte uncompressed point, reject trailing bytes.
- [ ] 4.7 Hostile-input tests for all three: truncation, over-length, wrong prefix, trailing bytes, wrong type strings.
- [ ] 4.8 Add `src/domain/platform/build-target.ts` exporting `IS_CHROMIUM_BUILD` from `import.meta.env.BROWSER`.

## 5. Crypto Ports And Adapters

- [ ] 5.1 Add `CryptoHkdf.deriveAeadKey(ikm: SecretBytes, info: SecretBytes, usages): Promise<CryptoKey>` to `src/application/ports/crypto.ts`, with a documentation comment stating it returns a non-extractable key and never bytes, and why (`memory.ts:10-21` cannot zeroize a `CryptoKey`).
- [ ] 5.2 Implement `VaultHkdf` in `src/infrastructure/crypto/adapters.ts` over `crypto.subtle` HKDF-SHA256 with an empty salt. Add RFC 5869 vectors.
- [ ] 5.3 Add an `EcdsaP256` verify-only port and a `NobleEcdsaP256` adapter over `@noble/curves` (already a dependency at `package.json:48`), with canonical DER length bounds. No signing, no key generation. Add WebAuthn-shaped vectors.
- [ ] 5.4 Confirm `tests/security/crypto-single-implementation.test.ts` and `pnpm run lint` still pass, and that `package.json` gained no dependency.

## 6. WebAuthn Ceremony Port And Adapter

- [ ] 6.1 Add `src/application/ports/webauthn.ts` declaring `WebAuthnCeremony` with `probe()`, `enroll(challenge, prfSalt)` and `assert(challenge, credentialId, transports, prfSalt)`.
- [ ] 6.2 Implement `src/infrastructure/webauthn/webauthn-ceremony.adapter.ts`. Omit `rp` entirely. `pubKeyCredParams: [-7]`, `attestation: "none"`, `userVerification: "required"`, `residentKey: "discouraged"`. Never use `evalByCredential`, which is a specification-level `NotSupportedError` at create.
- [ ] 6.3 Implement enrolment as `create()` followed immediately by `get()`; abort and discard the credential unless the assertion returns exactly 32 PRF bytes. Never treat `prf.enabled` as proof of delivery.
- [ ] 6.4 Return the PRF output as an owned byte buffer and zeroize the adapter's own view in a `finally`.
- [ ] 6.5 Add a test asserting `navigator.credentials` appears nowhere else under `src/`, and that the background bundle contains no reference to it.

## 7. Biometric Factor Service

- [ ] 7.1 Create `src/application/services/biometric-factor.service.ts`, the only writer of `vaultBiometric` (local) and the only reader of `biometricChallenge` (session). Static imports only — do not copy the dynamic `import("wxt/browser")` pattern at `key-vault.service.ts:788`.
- [ ] 7.2 Implement `beginUnlock()` and `beginEnroll()`: mint a 32-byte nonce with a 120-second lifetime and a purpose. Implement consume-on-read, before verification, regardless of outcome.
- [ ] 7.3 Implement the verification order exactly as `design.md` Decision 3 states it, in that order: throttle check; consume challenge; refuse on legacy records or missing envelope; refuse when rehearsal is due or this is the first unlock of the browser session; locate the factor by constant-time credential-id compare; parse and check client data; parse and check authenticator data flags, rpIdHash and BE bit; verify the signature; derive and unwrap; prove the recovered key against the envelope verifier.
- [ ] 7.4 Implement `enroll(...)`: obtain the live KEK via `kekForWrite(password)`, derive the wrapping key, encrypt under `bioWrapAad`, then unwrap and byte-compare before writing anything. Record the **observed** rpIdHash, origin, public key, algorithm and BE bit.
- [ ] 7.5 Implement `forget()`, `status()` and `touchPasswordUnlock()`. Zeroize the PRF buffer, every intermediate and any candidate KEK in their own `finally` blocks.
- [ ] 7.6 Implement the rule that any envelope write deletes the factor record, at `saveEnvelope`.
- [ ] 7.9 Enforce at most one enrolled factor: a successful enrolment over an existing one replaces it in a single write, and a failed one leaves the existing record intact and still usable.
- [ ] 7.7 Implement the first-unlock-after-restart rule: a session-storage marker set on the first successful password unlock of a browser session, absent after a restart or extension update, required by `biometricCompleteUnlock`.
- [ ] 7.8 Make the service re-entrancy safe: refuse a second in-flight ceremony of the same purpose, and confirm a challenge minted by one surface cannot be consumed by another.

## 8. Vault Service Integration

- [ ] 8.1 Add `unlockWithFactor(...)` to `KeyVaultService`, calling `openVaultWithKek(kek, …, password: null)` so the in-memory key map is repopulated before the session record is written.
- [ ] 8.2 Write `authFactor` into the session lock record on both unlock paths, and read an **absent** value as `password` so a session opened by the previous build is not force-locked on upgrade. An unrecognised value reads as locked.
- [ ] 8.3 In `unlock(password)`, update `lastPasswordUnlockAt` only when a factor record exists, and set the browser-session marker from 7.7.
- [ ] 8.4 Refuse biometric enrolment and biometric unlock when any stored key record carries no version field. Leave `kekForWrite`, `verifyPassword` and `revealKey` untouched.

## 9. RPC Surface And Error Codes

- [ ] 9.1 Add the six methods to the `RpcRequest` union in `src/infrastructure/messaging/rpc.ts` and handlers to `vault-rpc.ts`.
- [ ] 9.2 Add zod schemas to `src/infrastructure/validation/schemas.ts`: bounded credential id, exactly-32-element byte arrays with 0–255 element bounds for the PRF output and salt, and bounded `authenticatorData`, `clientDataJSON` and `signature`.
- [ ] 9.3 Add `vault.biometricStatus`, `vault.biometricBeginUnlock`, `vault.biometricCompleteUnlock` and `vault.biometricForget` to `LOCKED_REACHABLE_METHODS`; leave `vault.biometricBeginEnroll` and `vault.biometricEnroll` lock-gated.
- [ ] 9.4 Confirm `biometricStatus` returns usability only — never the credential id, the label, or anything that identifies the authenticator to a locked screen.
- [ ] 9.5 Wire the throttle: check before minting or consuming a challenge and before any derivation; record success on a genuine unlock; record failure on any background verification failure; never on a cancellation.
- [ ] 9.6 Confirm the code split does not become an enrolment oracle: `BIOMETRIC_UNAVAILABLE` is returned only by `vault.biometricStatus`, for a build without the feature or a device with no usable authenticator. Every unlock and enrolment refusal returns `BIOMETRIC_REJECTED`, including when no factor is enrolled.
- [ ] 9.7 Add `BIOMETRIC_UNAVAILABLE` (-32007) and `BIOMETRIC_REJECTED` (-32008) with the four-edit protocol: a documentation block immediately above each constant, a `RPC_NUMERIC_ERROR_CODES` entry, a `RPC_ERROR_MESSAGES` entry, and a section each in `docs/rpc-error-codes.md`. Three of the four are enforced by `tests/unit/infrastructure/error-code-coverage.test.ts:102-190`.
- [ ] 9.8 Collapse every biometric failure to the refusal code with one fixed detail string.
- [ ] 9.9 Add the client wrappers in `src/infrastructure/messaging/client.ts`.

## 10. The Ceremony Document And The Build Guards

- [ ] 10.1 Create `src/extension/unlock/` with `index.html`, `main.tsx` and `UnlockCeremonyApp.tsx`: the mascot, one line of context, one ghost Cancel. Runs the ceremony on load, closes itself when the RPC resolves.
- [ ] 10.2 Hold the PRF output in a ref, never in component state, and zeroize it in a `finally` and on unmount.
- [ ] 10.3 Handle the vault locking underneath an open ceremony window: the consumed challenge makes it fail closed, and the window says so rather than hanging.
- [ ] 10.4 Give the entrypoint a Chromium-only target filter so it is absent from the Firefox build.
- [ ] 10.5 Make `KEY_HANDLING_DOCUMENTS` target-aware and add `unlock.html` as a Chromium-only entry, with a justification comment matching the style of the existing four.
- [ ] 10.6 Update `tests/security/key-handling-bundle.test.ts` so a target-scoped document is asserted present and clean in its own target and asserted **absent** from the others, instead of read unconditionally from every target's output. It currently crashes with ENOENT at `:113`.

## 11. Lock Screen And Settings UI

- [ ] 11.1 Widen `UnlockResult` in `src/ui/state/KeyManagerContext.tsx` with the biometric variants and extend `UNLOCK_FAILURE_COPY` and `describeUnlockFailure`.
- [ ] 11.2 Add the ghost `Unlock with your device` button to `LockScreen` between the notched `Unlock` primary and the closing trust line. Render it only when the build is Chromium, a usable factor is enrolled, the rehearsal is not due, and this is not the first unlock of the browser session. `Unlock` stays the only notched primary. The button opens the ceremony window via `browser.windows.create`.
- [ ] 11.3 Render the designed states: cancelled (no error text, focus returned to the password field); refused; rate-limited (existing countdown copy); rehearsal-due and restart-pending (one explained line each, not styled as errors); permanently unusable (a no-credential `Forget biometric unlock` action).
- [ ] 11.4 Add the biometric section to `SecuritySettingsTab` using the existing `SettingsSection`, `SettingsRow` and `Switch` primitives, gated by the existing `useReauth`/`ReauthDialog` pattern for enrolment and ungated for forget. List the enrolled factor with the date it was added. Render an explanatory non-interactive row when the capability check fails, and nothing at all on non-Chromium builds — never a disabled control.
- [ ] 11.5 Add the enable-time disclosure copy as part of the section body: the password remains required and cannot be removed; a biometric session cannot reveal or export a key; deleting the credential loses only the shortcut; a credential that syncs makes this factor as strong as that account; biometric unlock may be compelled where a password may not; and the factor is per-device, so a second machine enrols separately. Never name a biometric modality.
- [ ] 11.6 Add the one explanatory line to `ReauthDialog` when the session was opened biometrically.
- [ ] 11.7 Follow `docs/design/DESIGN_RULES.md`: tokens only, no emoji, no pill buttons, mint never decorative, 44px hit targets, focus drawn inside any clipped element, and any new shape utility declared with `@utility` in `tailwind.css`, never `@layer components`.

## 12. Tests

- [ ] 12.1 `tests/security/biometric-authority.test.ts`: drive the handlers, not the dialog — a biometric session is refused by `vault.reveal`, `vault.generate`, `vault.import`, `vault.deleteKey`, the two `REAUTH_SETTINGS_FIELDS` timeouts, and the three password-gated policy cases (`trustLevel === "high"`, an allow kind rule, enabling a session grant). Assert the boundary honestly: the test SHALL also record that lowering a trust level, a deny or ask rule, disabling a grant and `policy.removeOrigin` are **not** password-gated today and therefore are not blocked, so nobody later reads the suite as proving a property it does not test.
- [ ] 12.2 `tests/security/biometric-wrapper.test.ts`: a tampered public key, a flipped BE bit, a rewritten credential id, a rolled-back KDF cost and a swapped envelope each fail to yield a key; a rewritten wrapping yields a key that fails the envelope verifier; the password still opens the vault after enrol and after forget; a legacy record refuses both enrol and unlock; an envelope write deletes the factor; a second enrolment replaces the first and the replaced credential no longer unlocks.
- [ ] 12.3 `tests/security/biometric-assertion.test.ts`: a valid PRF output with a replayed challenge, an absent challenge, an expired challenge, a cleared UV bit, a wrong rpIdHash, a wrong origin or an invalid signature is refused; a consumed challenge cannot be reused; a cancellation records no throttle failure; and an unlock against a vault with **no** enrolled factor is indistinguishable in code, message and detail from one against an enrolled vault with bad material.
- [ ] 12.4 `tests/security/biometric-zeroize.test.ts`: the PRF output buffer is zeroized after use, asserted by observing buffer contents rather than spying on the zeroize helper.
- [ ] 12.5 Unit tests for the AAD encoder, the HKDF and ECDSA adapters, all three parsers, the ceremony adapter's create-then-get contract, `LockScreen` and `SecuritySettingsTab`.
- [ ] 12.6 `tests/e2e/fixtures/webauthn.ts` using `newCDPSession` and `WebAuthn.addVirtualAuthenticator({ hasPrf: true, hasUserVerification: true, isUserVerified: true })`, plus `tests/e2e/biometric-unlock.spec.ts` driving the control by accessible role. Write into the spec file the caveat that it exercises neither the production relying-party identifier nor the popup focus-loss mode.

## 13. Documentation And Design Review

- [ ] 13.1 Document the `vaultBiometric` record, its AAD, and the no-version-bump rationale in `docs/vault-storage-format.md`, plus the rule that an envelope write deletes the wrapping.
- [ ] 13.2 Add the six methods and their lock dispositions to the privilege table in `docs/rpc-architecture.md`, and the two codes to `docs/rpc-error-codes.md`.
- [ ] 13.3 Rewrite SEC-009 in `docs/roadmap.md` with the platform matrix the spike actually produced, replacing "fingerprint, Face ID" with the honest sentence drafted in 1.6.
- [ ] 13.4 Add capture steps to `docs/design-review/capture-screenshots.mjs` for: the lock screen with the affordance, and in its cancelled, refused, rehearsal-due, restart-pending and unusable-factor states; the Security tab enrolled, not enrolled and capability-failed; and the ceremony document itself.
- [ ] 13.5 Run the review as two separate invocations, one per theme, against a **populated** vault, and record it in `docs/design-review/README.md`. A fresh vault has hidden a shipped layout bug before.
- [ ] 13.6 Rebase against `openspec/changes/add-auto-lock-countdown`, which targets the same Security tab, the same `session-auto-lock` spec and the same `ui-options-page` spec. Classify its `lockAt` disclosure and this change's `biometricStatus` in one pass.

## 14. Verification

- [ ] 14.1 `openspec validate add-biometric-unlock --strict`.
- [ ] 14.2 `pnpm run compile`.
- [ ] 14.3 `pnpm run lint` — no `@noble/*` or `@scure/*` import outside `src/infrastructure/crypto/`.
- [ ] 14.4 `pnpm exec vitest run` — including `tests/security/lock-gate.test.ts`, `tests/security/reauth-boundary.test.ts`, `tests/security/reveal-requires-password.test.ts` (must still pass untouched), `tests/security/crypto-single-implementation.test.ts` and `tests/unit/infrastructure/error-code-coverage.test.ts`.
- [ ] 14.5 `pnpm run test:build-output` — no `host_permissions` on either target; the permission set is still exactly `storage`/`windows`/`alarms` plus the build-tool side-panel entry; `unlock.html` present and clean in `.output/chrome-mv3` and **asserted absent** from `.output/firefox-mv3`.
- [ ] 14.6 `pnpm exec playwright test --project=chromium-extension`.
- [ ] 14.7 `pnpm run build` and `pnpm run build:firefox` — both succeed, and a grep of the Firefox output finds no `navigator.credentials`, no biometric method names and no ceremony entrypoint.
- [ ] 14.8 `pnpm run doctor` — the pinned local binary, never `npx` or an unpinned specifier. Report the score; do not gate on it.
- [ ] 14.9 `pnpm audit --prod` — unchanged, since no production dependency was added.
- [ ] 14.10 `pnpm run slop:changes`, and `pnpm run slop:ci` to reproduce the gate. This change adds several comment-heavy security modules, which is exactly the shape that moves that score.
- [ ] 14.11 Perform and record a manual ceremony on each target operating system in `prf-platform-matrix.md`. A green CI run does not prove the shipped surface.

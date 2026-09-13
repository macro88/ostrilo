## 1. Sensitive State Retention

- [ ] 1.1 Extend `clearSensitiveState` in `OnboardingCreateKey.tsx` to reset `password` and `confirmPassword` alongside the existing reveal flags.
- [ ] 1.2 Dispatch the reset and null `privateKeyRef` and `passwordBackupRef` on back navigation off the backup step, on reveal failure, and on unmount, not only in `handleFinish`.
- [ ] 1.3 Stop passing the nsec into `OnboardingCreateKeyBackupStep` as a prop; give the step a ref-backed accessor so the value does not sit in `memoizedProps`.
- [ ] 1.4 Clear the nsec `<Input>` value before the backup step unmounts.
- [ ] 1.5 Move the `LockScreen` password from `useState` to a ref so the lock screen satisfies the `Ephemeral Input State` requirement it currently violates.
- [ ] 1.6 Debounce the `evaluatePasswordStrength` call in `password-input.tsx` so the master password crosses the RPC boundary a handful of times per entry instead of once per keystroke.

## 2. Autofill And Password Manager Exclusion

- [ ] 2.1 Add `autoComplete="off"` and `spellCheck={false}` to the nsec display in `OnboardingCreateKeyBackupStep.tsx`.
- [ ] 2.2 Add `autoComplete="off"` and `spellCheck={false}` to the private key input in `OnboardingImportKeyStep.tsx`, matching `ImportKeyForm.tsx`.
- [ ] 2.3 Add `autoComplete="off"` and `spellCheck={false}` to the master password, confirmation, and key name inputs in `password-input.tsx` and `OnboardingCreateKeyInputStep.tsx`.
- [ ] 2.4 Add the third-party manager opt-out attributes (`data-1p-ignore`, `data-lpignore`, `data-bwignore`) to every key and password input.
- [ ] 2.5 Replace `type="password"` masking on the read-only nsec display with a text input masked via `-webkit-text-security`, keeping the eye toggle and its `aria-label` behaviour.
- [ ] 2.6 Verify no key or password input is wrapped in a `<form>` element.

## 3. Clipboard Expiry

- [ ] 3.1 Add a timed clipboard clear to `handleCopyKey` with a 45 second window, storing the timer id in a ref.
- [ ] 3.2 Cancel the timer and run the clear immediately on unmount, on `pagehide`, and when the user leaves the create-key flow.
- [ ] 3.3 State the interval in the copy control before the user clicks, and warn that anything copied during the window will also be replaced.
- [ ] 3.4 Add a mono countdown and a "Clear now" control per `DESIGN_RULES.md` §8, and indicate when the clear has run.
- [ ] 3.5 Replace the `console.error` in the copy failure path with a visible message plus a selectable grouped-mono transcription panel, and use the same panel when a clear fails.
- [ ] 3.6 Confirm the clear needs no clipboard read and that the manifest gains no `clipboardRead` permission.

## 4. Encrypted Backup Export

- [ ] 4.1 Delete `handleDownloadKey` and the plaintext JSON blob path from `OnboardingCreateKey.tsx`.
- [ ] 4.2 Define the versioned `v: 1` `ostrilo-key-backup` envelope described in design Decision 1, with the key name inside the ciphertext.
- [ ] 4.3 Implement export using the existing `ICrypto` KDF and AEAD adapters; add no new crypto dependency and no second crypto implementation.
- [ ] 4.4 Add the backup passphrase prompt with confirmation, strength checking through `evaluatePasswordStrength`, and copy stating that the passphrase is separate from the master password and unrecoverable.
- [ ] 4.5 Write files as `ostrilo-backup-<iso-date>.json` with no key name in the filename.
- [ ] 4.6 Drop the backup passphrase and the plaintext payload on export success, failure, and cancel.
- [ ] 4.7 Teach the import path to read the `v: 1` envelope and re-encrypt the recovered key under the current master password.
- [ ] 4.8 Make incorrect-passphrase import fail closed with a message that discloses nothing about the key or the passphrase.

## 5. Backup Verification And Key Loss Copy

- [ ] 5.1 Replace the acknowledgement checkbox gate with a verification step that must pass before Finish enables; reword the checkbox as a statement of understanding.
- [ ] 5.2 Implement the transcription route: re-enter the last 8 characters of the nsec, with paste disabled on that field.
- [ ] 5.3 Implement the file route: re-select the encrypted backup file, enter its passphrase, confirm it decrypts to the key just created, and discard the plaintext without displaying it.
- [ ] 5.4 Clear the verification input from component state when verification passes or the user leaves the step.
- [ ] 5.5 Allow another password-verified reveal and retry after a failed verification.
- [ ] 5.6 Add copy stating that losing both the password and the backup makes the identity permanently unrecoverable, and that no recovery service, support channel, or reset exists.
- [ ] 5.7 Show the nsec in grouped JetBrains Mono blocks per `DESIGN_RULES.md` §4 to reduce transcription error.

## 6. Realm Isolation

- [ ] 6.1 Convert `Logo.tsx` `mode === "model"` to `React.lazy` plus `Suspense`, restoring the static `ostriloPoster` image as the same-size fallback so there is no layout shift and no surfaced error.
- [ ] 6.2 Remove `three` from `optimizeDeps.include` in `wxt.config.ts`.
- [ ] 6.3 Switch `OnboardingWelcome.tsx` and `LockScreen.tsx` to `mode="static"` so no key-handling realm ever instantiates the model.
- [ ] 6.4 Declare the key-handling documents once as shared constants and have the UI read them rather than literal document names.
- [ ] 6.5 Add the `src/extension/welcome/` WXT entrypoint that hosts the 3D hero and the create-or-import choice, with no password or key input, handing off by full tab navigation.
- [ ] 6.6 Add the `src/extension/keyflow/` WXT entrypoint hosting create-key, backup and import, with a minimal dependency graph and no `three`, `qrcode.react`, or charting.
- [ ] 6.7 Replace in-popup onboarding with a static prompt that opens `keyflow.html` in a tab when no keys exist.
- [ ] 6.8 Move `MainApp` behind a lazy boundary so the locked popup loads only the shell and the lock screen.
- [ ] 6.9 Keep unlock in the popup and sidepanel, and confirm neither document loads three.js after 6.1 and 6.3.

## 7. Navigation And Build Guard

- [ ] 7.1 Route entry into and exit from the create-key, backup and unlock surfaces through `useAppNavigation`, and confirm no navigation state carries a key, master password, or backup passphrase.
- [ ] 7.2 Run key-material teardown in the navigation hook before the next surface renders.
- [ ] 7.3 Confirm no handoff between documents writes key material to a URL, hash fragment, broadcast message, `chrome.storage`, `localStorage`, or `sessionStorage`.
- [ ] 7.4 Add a post-build guard script that enumerates key-handling documents from the shared constants, walks each output document's module and `modulepreload` chunk graph, and fails on the `WebGLRenderer`, `GLTFLoader` and `three` markers.
- [ ] 7.5 Add a transitive byte ceiling per key-handling document to the guard so an unnamed heavy dependency also fails.
- [ ] 7.6 Run the guard against both `.output/chrome-mv3` and `.output/firefox-mv2`, and wire it into the build scripts.

## 8. Tests

- [ ] 8.1 Add unit tests proving `clearSensitiveState` clears `password` and `confirmPassword`, and that every exit path clears both refs.
- [ ] 8.2 Add unit tests for the clipboard timer: clear after the interval, immediate clear on unmount and flow exit, cancellation by "Clear now", and the transcription fallback on API rejection.
- [ ] 8.3 Add unit tests for the encrypted envelope: round-trip with the correct passphrase, closed failure on the wrong passphrase, rejection of weak or mismatched passphrases, and no key name in the filename.
- [ ] 8.4 Add security tests asserting no code path produces a file containing `privateKey` or `privateKeyHex` in plaintext.
- [ ] 8.5 Add security tests asserting `revealKey` still re-derives and re-verifies the password, rejects an empty or incorrect password, and zeroizes the buffers it owns.
- [ ] 8.6 Add tests asserting no QR code is rendered for private key material and that `Pubkey` still passes only the public key.
- [ ] 8.7 Add UI tests for `autoComplete="off"`, `spellCheck={false}`, the manager opt-out attributes, and the absence of `type="password"` on the nsec display.
- [ ] 8.8 Add UI tests for backup verification: Finish disabled until verification passes, correct and incorrect transcription, and the file round-trip route.
- [ ] 8.9 Add Playwright coverage replacing the skipped placeholder in `tests/e2e/onboarding-create.spec.ts`: create a key, reveal it, save an encrypted backup, pass verification, finish, and land on Home.
- [ ] 8.10 Update `tests/e2e/agent-smoke.spec.ts` and the screenshot steps for the new entrypoints and the changed backup step.
- [ ] 8.11 Add a bundle test proving three.js is absent from every document that can hold key material, in both browser builds.

## 9. Documentation

- [ ] 9.1 Update `docs/v2-prd.md` status notes for `SEC-011` and `SEC-003`, and leave `SYNC-004` untouched as an explicit non-goal.
- [ ] 9.2 Update `docs/ostrilo-onboarding-requirements.md` for the new step order, the encrypted backup, and the verification step.
- [ ] 9.3 Write the release note stating that plaintext key download is removed, that existing plaintext files should be deleted, and that a file which reached a synced folder means the identity is exposed.

## 10. Verification

- [ ] 10.1 Run `openspec validate secure-key-backup-flow --strict`.
- [ ] 10.2 Run `pnpm run compile`.
- [ ] 10.3 Run focused Vitest suites for the create-key reducer, the clipboard timer, the encrypted envelope, the key vault reveal path, and the onboarding input attributes.
- [ ] 10.4 Run `pnpm run test:security`.
- [ ] 10.5 Run the Playwright create-and-backup loop and the agent smoke spec.
- [ ] 10.6 Run the bundle guard and confirm no key-handling document in either build reaches three.js.
- [ ] 10.7 Run `pnpm run build` and `pnpm run build:firefox`.
- [ ] 10.8 Verify the flow in light and Deep Ink dark mode against the `DESIGN_RULES.md` §12 checklist, including one notched primary CTA per screen and visible focus on notched controls.
- [ ] 10.9 Defer `npx react-doctor@latest`: it currently fails to install because pnpm rejects it with `ERR_PNPM_TRUST_DOWNGRADE` on `semver@6.3.1`. Run it once `restore-security-test-assurance` pins React Doctor locally, and do not treat its absence as a pass.

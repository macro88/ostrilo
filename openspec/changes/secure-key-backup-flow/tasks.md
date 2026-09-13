## 1. Sensitive State Retention

- [x] 1.1 Extend `clearSensitiveState` in `OnboardingCreateKey.tsx` to reset `password` and `confirmPassword` alongside the existing reveal flags.
- [x] 1.2 Dispatch the reset and null `privateKeyRef` and `passwordBackupRef` on back navigation off the backup step, on reveal failure, and on unmount, not only in `handleFinish`.
- [x] 1.3 Stop passing the nsec into `OnboardingCreateKeyBackupStep` as a prop; give the step a ref-backed accessor so the value does not sit in `memoizedProps`.
- [x] 1.4 Clear the nsec `<Input>` value before the backup step unmounts.
- [~] 1.5 Move the `LockScreen` password from `useState` to a ref — `src/ui/features/authentication/components/LockScreen.tsx` is outside this agent's file ownership; the `Ephemeral Input State` violation there is unfixed and reported.
- [x] 1.6 Debounce the `evaluatePasswordStrength` call in `password-input.tsx` so the master password crosses the RPC boundary a handful of times per entry instead of once per keystroke.

## 2. Autofill And Password Manager Exclusion

- [x] 2.1 Add `autoComplete="off"` and `spellCheck={false}` to the nsec display in `OnboardingCreateKeyBackupStep.tsx`.
- [x] 2.2 Add `autoComplete="off"` and `spellCheck={false}` to the private key input in `OnboardingImportKeyStep.tsx`, matching `ImportKeyForm.tsx`.
- [x] 2.3 Add `autoComplete="off"` and `spellCheck={false}` to the master password, confirmation, and key name inputs in `password-input.tsx` and `OnboardingCreateKeyInputStep.tsx`.
- [x] 2.4 Add the third-party manager opt-out attributes (`data-1p-ignore`, `data-lpignore`, `data-bwignore`) to every key and password input. Declared once as `NO_AUTOFILL_PROPS` in `password-input.tsx`.
- [x] 2.5 Replace `type="password"` masking on the read-only nsec display with a text input masked via `-webkit-text-security`, keeping the eye toggle and its `aria-label` behaviour. Goes further than the design: while masked the DOM value is a run of bullets, so the key is absent from the document whatever the prefixed CSS property does. That also settles the design's open question about Firefox.
- [x] 2.6 Verify no key or password input is wrapped in a `<form>` element. Asserted, not merely inspected.

## 3. Clipboard Expiry

- [x] 3.1 Add a timed clipboard clear to `handleCopyKey` with a 45 second window, storing the timer id in a ref. Extracted as `useExpiringClipboard` so the timer is testable without the whole flow.
- [x] 3.2 Cancel the timer and run the clear immediately on unmount, on `pagehide`, and when the user leaves the create-key flow.
- [x] 3.3 State the interval in the copy control before the user clicks, and warn that anything copied during the window will also be replaced.
- [x] 3.4 Add a mono countdown and a "Clear now" control per `DESIGN_RULES.md` §8, and indicate when the clear has run.
- [x] 3.5 Replace the `console.error` in the copy failure path with a visible message plus a selectable grouped-mono transcription panel, and use the same panel when a clear fails.
- [x] 3.6 Confirm the clear needs no clipboard read and that the manifest gains no `clipboardRead` permission. `wxt.config.ts` is untouched by this change; the clipboard test asserts `readText` is never reached.

## 4. Encrypted Backup Export

- [x] 4.1 Delete `handleDownloadKey` and the plaintext JSON blob path from `OnboardingCreateKey.tsx`.
- [x] 4.2 Define the versioned `v: 1` `ostrilo-key-backup` envelope described in design Decision 1, with the key name inside the ciphertext. DEVIATION: the header records the vault's own `KdfParams` discriminated union (argon2id by default) rather than the literal `{name: "PBKDF2", iterations}` shape the design sketched. Recording the parameters the adapter actually consumes is what 4.3 asks for, it follows the vault's "parameters travel with the material" rule, and it inherits any work-factor raise from `harden-vault-key-derivation` for free. Recorded parameters are checked against `KDF_FLOORS` on read, because a backup file is attacker-supplied input.
- [x] 4.3 Implement export using the existing `ICrypto` KDF and AEAD adapters; add no new crypto dependency and no second crypto implementation.
- [x] 4.4 Add the backup passphrase prompt with confirmation, strength checking through `evaluatePasswordStrength`, and copy stating that the passphrase is separate from the master password and unrecoverable.
- [x] 4.5 Write files as `ostrilo-backup-<iso-date>.json` with no key name in the filename.
- [x] 4.6 Drop the backup passphrase and the plaintext payload on export success, failure, and cancel.
- [x] 4.7 Teach the import path to read the `v: 1` envelope and re-encrypt the recovered key under the current master password. The recovered key enters the same input a typed nsec does, so the existing import path does the re-encryption.
- [x] 4.8 Make incorrect-passphrase import fail closed with a message that discloses nothing about the key or the passphrase. One uniform message across wrong passphrase, tampered header and truncated ciphertext, because AES-GCM cannot distinguish them without leaking.

## 5. Backup Verification And Key Loss Copy

- [x] 5.1 Replace the acknowledgement checkbox gate with a verification step that must pass before Finish enables; reword the checkbox as a statement of understanding.
- [x] 5.2 Implement the transcription route: re-enter the last 8 characters of the nsec, with paste disabled on that field.
- [x] 5.3 Implement the file route: re-select the encrypted backup file, enter its passphrase, confirm it decrypts to the key just created, and discard the plaintext without displaying it.
- [x] 5.4 Clear the verification input from component state when verification passes or the user leaves the step.
- [x] 5.5 Allow another password-verified reveal and retry after a failed verification. A failed check leaves the reveal intact and retryable; leaving the step drops the reveal, and returning requires `revealKey` again.
- [x] 5.6 Add copy stating that losing both the password and the backup makes the identity permanently unrecoverable, and that no recovery service, support channel, or reset exists.
- [x] 5.7 Show the nsec in grouped JetBrains Mono blocks per `DESIGN_RULES.md` §4 to reduce transcription error.

## 6. Realm Isolation

- [x] 6.1 Convert `Logo.tsx` `mode === "model"` to `React.lazy` plus `Suspense`, restoring the static `ostriloPoster` image as the same-size fallback so there is no layout shift and no surfaced error. The lazy target is a new `LazyModel.tsx` rather than `ModelViewer` directly, so the `.glb` asset import sits on the far side of the boundary too; an error boundary keeps the poster when the chunk or asset fails.
- [~] 6.2 Remove `three` from `optimizeDeps.include` in `wxt.config.ts` — this agent may edit `wxt.config.ts` only to register a new entrypoint, and `harden-manifest-and-build` is editing it concurrently. Dev-prebundling only; no effect on output.
- [x] 6.3 Switch `OnboardingWelcome.tsx` and `LockScreen.tsx` to `mode="static"`. `OnboardingWelcome.tsx` is switched. `LockScreen.tsx` is outside this agent's file ownership, so the rule is enforced structurally instead: `Logo` consults `key-handling-documents.ts` and refuses `mode="model"` in any key-handling document, which today is all four. The lock screen therefore renders the static poster without its source changing.
- [x] 6.4 Declare the key-handling documents once as shared constants and have the UI read them rather than literal document names. LOCATION DEVIATION: the constants live in `src/ui/components/logo/key-handling-documents.ts`, not alongside `BROADCAST_EVENTS` in `src/infrastructure/messaging/events.ts`, because `src/infrastructure/**` is owned by a concurrent change. Moving the file is a rename plus two imports.
- [~] 6.5 Add the `src/extension/welcome/` WXT entrypoint — deferred. Opening it on install needs `background.ts`, which is outside this agent's file ownership, so the entrypoint would ship unreachable. The design's own Open Questions ask whether Steps B and C should land here or immediately after.
- [~] 6.6 Add the `src/extension/keyflow/` WXT entrypoint — deferred with 6.5 and 6.7: a key-flow document nothing navigates to is dead code, and the popup cannot be rewired from here.
- [~] 6.7 Replace in-popup onboarding with a static prompt that opens `keyflow.html` — `src/extension/popup/App.tsx` is outside this agent's file ownership.
- [~] 6.8 Move `MainApp` behind a lazy boundary — `src/ui/components/layout/MainApp.tsx` and `src/extension/popup/App.tsx` are outside this agent's file ownership. The popup's transitive JS is 636 KB after 6.1, down from 1.23 MB; this task is what would cut it further.
- [x] 6.9 Keep unlock in the popup and sidepanel, and confirm neither document loads three.js after 6.1 and 6.3. Confirmed against both built targets: the only chunk containing `WebGLRenderer` is `chunks/LazyModel-*.js`, reachable solely through a dynamic `import()`.

## 7. Navigation And Build Guard

- [~] 7.1 Route entry into and exit from the create-key, backup and unlock surfaces through `useAppNavigation` — `src/ui/hooks/useAppNavigation.ts` is outside this agent's file ownership, and onboarding does not route through it today (`OnboardingContainer` owns its own `useState` flow). The substantive half of the requirement is met where it is testable: no navigation or handoff carries key material (7.3).
- [~] 7.2 Run key-material teardown in the navigation hook before the next surface renders — same ownership boundary. Teardown runs in the flow itself, on every exit path, which is what the `secure-key-backup` delta actually requires.
- [x] 7.3 Confirm no handoff between documents writes key material to a URL, hash fragment, broadcast message, `chrome.storage`, `localStorage`, or `sessionStorage`. Asserted by source scan over the whole onboarding feature, not by inspection.
- [x] 7.4 Add a post-build guard that enumerates key-handling documents from the shared constants, walks each output document's module and `modulepreload` chunk graph, and fails on the `WebGLRenderer`, `GLTFLoader` and `three` markers. SHAPE DEVIATION: implemented as `tests/security/key-handling-bundle.test.ts` rather than a standalone script, so it runs in the existing security suite that CI already executes. It skips with a message naming the build command when a target is unbuilt, and the skip says it is not a pass.
- [x] 7.5 Add a transitive byte ceiling per key-handling document to the guard so an unnamed heavy dependency also fails. 800 KB; the largest document is currently 636 KB and the three.js chunk alone is 600 KB, so the ceiling cannot be satisfied with a 3D engine in the graph.
- [x] 7.6 Run the guard against both `.output/chrome-mv3` and `.output/firefox-mv3` (not `firefox-mv2` — Firefox is now MV3). Wiring a dedicated npm script is [~]: `package.json` is outside this agent's file ownership. `pnpm run test:security` picks the file up already.

## 8. Tests

- [x] 8.1 Unit tests proving `clearSensitiveState` clears `password` and `confirmPassword`, and that every exit path clears both refs (`create-key-sensitive-state.test.ts` for the reducer, `create-key-flow.test.tsx` for the refs, which are not reachable from a reducer test).
- [x] 8.2 Unit tests for the clipboard timer: clear after the interval, immediate clear on unmount, `pagehide` and flow exit, cancellation by "Clear now", and the transcription fallback on API rejection.
- [x] 8.3 Unit tests for the encrypted envelope: round-trip, closed failure on the wrong passphrase, rejection of an empty passphrase, a rolled-back KDF cost, a tampered header and a truncated ciphertext, fresh salt and IV per file, and no key name in the filename. Mismatched passphrases are rejected in the export component before any file is written.
- [x] 8.4 Security tests asserting no code path produces a file containing `privateKey` or `privateKeyHex` in plaintext — a source scan with a reviewed download allowlist, plus a behavioural check on what the export actually writes.
- [x] 8.5 Security tests asserting `revealKey` still re-derives and re-verifies the password, rejects an empty or incorrect password, refuses an incorrect password even with the vault unlocked, and leaks nothing in the failure message. Buffer zeroization on that path is already covered by `tests/security/memory-zeroization.test.ts`.
- [x] 8.6 Tests asserting no QR code is rendered for private key material and that `Pubkey` still passes only the public key, including a repo-wide scan for any QR caller handed something key-shaped.
- [x] 8.7 UI tests for `autoComplete="off"`, `spellCheck={false}`, the manager opt-out attributes, and the absence of `type="password"` on the nsec display.
- [x] 8.8 UI tests for backup verification: Finish disabled until verification passes (checkbox ticked or not), correct and incorrect transcription, paste refused on the verification field, and the file round-trip route including a wrong passphrase and a non-envelope file.
- [x] 8.9 Playwright coverage replacing the skipped placeholder in `tests/e2e/onboarding-create.spec.ts`.
- [x] 8.10 Update `tests/e2e/agent-smoke.spec.ts` and the screenshot steps for the new entrypoints and the changed backup step. Two more specs carried their own copy of the onboarding helper and were updated with it.
- [x] 8.11 Bundle test proving three.js is absent from every document that can hold key material, in both browser builds.

## 9. Documentation

- [x] 9.1 Update `docs/v2-prd.md` status notes for `SEC-011` and `SEC-003`, and leave `SYNC-004` untouched as an explicit non-goal.
- [x] 9.2 Update `docs/ostrilo-onboarding-requirements.md` for the new step order, the encrypted backup, and the verification step.
- [x] 9.3 Write the release note stating that plaintext key download is removed, that existing plaintext files should be deleted, and that a file which reached a synced folder means the identity is exposed. Written to `docs/release-notes-secure-key-backup.md`; `/CHANGELOG.md` is a root file outside this agent's ownership and is being edited concurrently, so the note names the section it belongs in.

## 10. Verification

- [x] 10.1 `openspec validate secure-key-backup-flow --strict --type change` — passes.
- [x] 10.2 `pnpm run compile` — clean.
- [x] 10.3 Focused Vitest suites for the create-key reducer, the create-key flow, the clipboard timer, the encrypted envelope, the key vault reveal path, the realm guard and the onboarding input attributes — all green.
- [x] 10.4 `pnpm run test:security` — green.
- [x] 10.5 Playwright create-and-backup loop and the agent smoke spec — `onboarding-create.spec.ts` passes; `agent-smoke.spec.ts` completes the whole onboarding flow and then fails on `policy.setKindRule`, which a concurrent change made password-gated. Reported, not this change's to fix.
- [x] 10.6 Bundle guard run against both builds; no key-handling document reaches three.js.
- [x] 10.7 `pnpm run build` and `pnpm run build:firefox` — both succeed.
- [~] 10.8 Verify the flow in light and Deep Ink dark mode against the `DESIGN_RULES.md` §12 checklist — not done: this agent cannot make a visual judgement. The structural rules were followed and are reviewable in the diff: exactly one notched primary CTA per screen (`Finish`; every in-panel action is `secondary`, `outline` or `ghost`), amber panels for warnings, mono for the nsec and the countdown, no new hard-coded colours. Needs a human pass.
- [x] 10.9 React Doctor — now pinned locally as `react-doctor@0.9.14`, so the `ERR_PNPM_TRUST_DOWNGRADE` blocker is gone. `node_modules/.bin/react-doctor --scope changed --no-score` reports no findings in any file this change touched. The pre-existing high-complexity warning on `password-input.tsx` was fixed while that file was open.

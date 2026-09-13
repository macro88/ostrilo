## Why

The create-key backup step is the one moment in Ostrilo where a plaintext private key exists inside a UI document, and today that moment is wider than it needs to be. "Download Backup" writes the nsec and its hex twin to disk as unencrypted JSON. "Copy Key" puts the nsec on the system clipboard with no expiry. `clearSensitiveState` never clears the master password out of reducer state, so the password survives in the React tree after onboarding finishes. And the same document that holds both the password and the revealed key also loads a decorative 892 KB three.js bundle for the ostrich model.

Each of these is small alone. Together they mean a cloud-synced Downloads folder, a background app reading the clipboard, or a single compromised npm publish in the `three` dependency tree is enough to take an identity that cannot be rotated. A Nostr key loss is permanent: there is no reset, no revocation, no support channel.

## What Changes

- **BREAKING** Remove the plaintext JSON key download. "Download Backup" no longer writes `{privateKey, privateKeyHex}` to disk in the clear.
- Replace it with an encrypted backup file sealed under a separate, user-supplied backup passphrase, labelled as encrypted and distinct from the master password.
- Clear the clipboard automatically 45 seconds after an nsec copy, tell the user before the copy that this will happen, and surface a manual-transcription fallback when the Clipboard API rejects.
- Complete `clearSensitiveState` so `password` and `confirmPassword` leave the reducer, and drop key and password references on every exit path from the create-key flow, not just `handleFinish`.
- Add `autoComplete="off"` and `spellCheck={false}` to every private-key and password input across onboarding, matching what `ImportKeyForm` already does.
- Verify the backup before letting the user past it: require re-entry of a checkable portion of the nsec instead of accepting a single unverified checkbox.
- Render the create-key, backup and unlock surfaces in a minimal document that excludes three.js and other decorative dependencies, and load the 3D ostrich behind a lazy boundary so it can never share a realm with key material.
- Preserve the properties the current code already gets right: the revealed key lives in a `useRef` and never in state, revealing re-verifies the password through `KeyVaultService.revealKey`, and QR rendering stays public-key-only.
- State key-loss consequences plainly in the flow: forgetting the master password with no backup means the identity is unrecoverable.

BIP-39 / NIP-06 seed phrases are explicitly out of scope. They are the right long-term answer to transcribing a 63-character nsec, but they change key generation itself and are already tracked as `SYNC-004` and `KEYMGMT-002` for v2.2.

## Capabilities

### New Capabilities

- `secure-key-backup`: How a newly generated private key is revealed, transcribed, copied, exported, verified and discarded during onboarding.
- `key-material-isolation`: The document and bundle boundary that keeps decorative and heavy third-party dependencies out of any realm that can hold a private key or master password.

### Modified Capabilities

- `ui-security`: `Ephemeral Input State` extends to cover reducer-held passwords and clipboard residue, not just React `useState`. `Secure Key Display` extends to cover export, clipboard and autofill exposure, and states honestly that dropping references is the achievable goal rather than memory erasure.
- `ui-architecture`: `Centralized Navigation Logic` extends so entering and leaving a key-handling surface routes through the centralized hook and teardown runs on exit. `Magic String Elimination` extends so the set of documents allowed to hold key material is declared once as shared constants consumed by both the UI and the build guard.

## Impact

- Onboarding UI: `OnboardingCreateKey.tsx`, `OnboardingCreateKeyBackupStep.tsx`, `OnboardingCreateKeyInputStep.tsx`, and `OnboardingImportKeyStep.tsx` change their reducer, handlers, copy and input attributes.
- Export path: `handleDownloadKey` is replaced by an encrypted export that needs a passphrase prompt and an AEAD envelope; the import side must be able to read what the export writes.
- Clipboard: a timed clear needs lifecycle handling so a pending timer does not outlive the document or clear a clipboard the user has since overwritten.
- Build and entrypoints: `Logo.tsx` gains a lazy boundary around `ModelViewer`, and WXT entrypoints under `src/extension/` gain a key-handling document. Today all four HTML entrypoints preload `chunks/useTheme-*.js`, which carries three.js.
- Shared architecture: `src/infrastructure/messaging/events.ts` and the navigation hook gain constants and transitions for the isolated realm.
- Design: all new surfaces must follow `docs/design/DESIGN_RULES.md`, including one notched primary CTA per screen, amber warning panels, and mono type for key material.
- Tests: unit coverage for the reducer reset and clipboard timer, security coverage for the absence of a plaintext export path, Playwright coverage for the create-and-backup loop that `tests/e2e/onboarding-create.spec.ts` currently skips, and a bundle assertion that three.js is absent from key-handling documents.
- PRD: `SEC-011` (Secure Backup & Recovery) and `SEC-003` (Secure UI Component Isolation) move forward; `SYNC-004` stays untouched.

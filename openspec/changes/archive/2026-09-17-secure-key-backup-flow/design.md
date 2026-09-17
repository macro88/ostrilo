## Context

The create-key flow is the only place in Ostrilo where a plaintext private key is rendered into a UI document. `OnboardingCreateKey.tsx` already gets several things right, and this design must not regress them:

- The revealed key is held in `privateKeyRef` (`useRef`, line 105), never in render state.
- Revealing calls `revealKey(passwordBackupRef.current)` (line 168), and `KeyVaultService.revealKey` (`src/application/services/key-vault.service.ts:473`) re-derives the KEK from the supplied password and the record salt, verifies it by decrypting, and zeroizes both the derived key and the decrypted secret in `finally`. It does not trust the unlocked session. This is the hardened alternative to `exportKey`, which does trust the session.
- QR rendering is public-key-only: `src/ui/components/common/pubkey.tsx:95` passes `value={pubkey}` to `QRCodeModal`, and no other caller passes key material.

Around those good properties sit four verified defects and one architectural problem.

**Plaintext export.** `handleDownloadKey` (`OnboardingCreateKey.tsx:202-225`) builds `{name, privateKey: nsec, privateKeyHex: hex, createdAt}`, wraps it in a `Blob`, and saves it through a synthetic anchor click. There is no encryption, no passphrase, no warning that the file is readable, and the filename embeds the key name (`ostrilo-key-<name>-<ts>.json`). The file lands in Downloads: routinely synced to iCloud, OneDrive or Dropbox, captured by Time Machine, indexed by Spotlight, and the first directory commodity infostealer malware reads.

**Unexpiring clipboard.** `handleCopyKey` (`OnboardingCreateKey.tsx:191`) calls `navigator.clipboard.writeText(privateKey.nsec)` with no timed clear, and on failure only `console.error`s. Every application on the machine can read the clipboard, and Universal Clipboard or Windows cloud clipboard syncs it to other devices.

**Incomplete state reset.** The `clearSensitiveState` reducer case (`OnboardingCreateKey.tsx:86-92`) resets `hasRevealedPrivateKey`, `showPrivateKey` and `copySuccess`. It never clears `password` or `confirmPassword`. `handleFinish` (line 227) nulls both refs and then dispatches this incomplete reset, so the master password survives in reducer state, and therefore in the React tree, after onboarding completes.

**Autofill exposure.** Only `src/ui/components/dialogs/ImportKeyForm.tsx:99` sets `autoComplete="off"`. The onboarding import input (`OnboardingImportKeyStep.tsx`, the `id="privateKey"` field) and the nsec display in `OnboardingCreateKeyBackupStep.tsx` do not, and both use `type="password"`, which is precisely the shape browser password managers capture.

**Shared realm with a 3D engine.** `OnboardingWelcome.tsx` and `LockScreen.tsx` both render `<Logo size="max" mode="model" />`. `src/ui/components/logo/Logo.tsx` statically imports `SceneSetup` from `./ModelViewer`, which statically imports `three` and `three/addons/loaders/GLTFLoader.js`. The built chunk `.output/chrome-mv3/chunks/useTheme-BTnaTevW.js` is 892,763 bytes and contains `WebGLRenderer`; every one of `popup.html`, `sidepanel.html`, `options.html` and `approval.html` references it. That is the same document in which `revealKey()` returns the nsec into a ref and the master password sits in reducer state. A compromised release of `three` or any of its transitives reads both straight off the heap. This is the concrete reason the companion `remove-key-exfiltration-surface` change is deleting the password-free `vault.export` RPC: the attack needs one bad npm publish, not a browser exploit.

Constraints this design works inside:

- WXT with `srcDir: "src"` and `entrypointsDir: "extension"`. Documents are `src/extension/{popup,sidepanel,options,approval}/`, each an `index.html` plus `main.tsx`.
- Minimal manifest permissions: `storage`, `sidePanel`, `windows`. `harden-manifest-and-build` is tightening this, so no new permission may be added casually.
- Crypto must come from the existing `ICrypto` ports and `@noble` / Web Crypto adapters. No new crypto dependency.
- All UI must follow `docs/design/DESIGN_RULES.md`.

## Goals / Non-Goals

**Goals:**

- Remove every path that writes a private key to disk in the clear.
- Give users a real backup artefact: an encrypted file they can restore from.
- Bound how long a copied private key sits on the system clipboard, and say so in the UI.
- Clear the master password, the confirmation, and the revealed key on every exit from the create-key flow.
- Keep key material out of browser autofill, password managers, and spell-check.
- Guarantee structurally, not by convention, that no document holding key material also loads a 3D engine.
- Make the flow check that a backup actually happened, instead of accepting a single unverified checkbox.
- Preserve the three properties the current code gets right: key in a ref, reveal re-verifies the password, QR is public-key-only.

**Non-Goals:**

- No BIP-39 / NIP-06 seed phrase generation or restoration. See Decision 7.
- No cloud or relay backup target. `SYNC-002` remains v2.2.
- No hardware key, HSM, or WebAuthn-backed storage.
- No claim of memory erasure for JavaScript strings. See Decision 4.
- No change to the vault's at-rest encryption parameters; `harden-vault-key-derivation` owns that.
- No change to `exportKey` itself; `remove-key-exfiltration-surface` owns removing that RPC.
- No new browser permission, in particular not `clipboardRead`.

## Decisions

### Decision 1: Delete the plaintext export; replace it with an encrypted file, with no plaintext escape hatch

`handleDownloadKey` is removed outright. "Download Backup" becomes "Save encrypted backup", which prompts for a backup passphrase and writes a versioned envelope:

```
{ "v": 1, "type": "ostrilo-key-backup",
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": <n>, "salt": "<b64>" },
  "cipher": { "name": "AES-GCM", "iv": "<b64>" },
  "ct": "<b64>", "createdAt": "<iso8601>" }
```

The key name goes inside the ciphertext, not the header, and the filename is `ostrilo-backup-<iso-date>.json` with no key name in it. Encryption reuses the existing `ICrypto` KDF and AEAD adapters, so no new dependency and no second crypto implementation to audit. The import side learns to read `v: 1` so a backup is actually restorable.

No plaintext path survives, not even behind a typed confirmation. **Rationale:** a plaintext key file is not a decision a user can take back. Once the file exists, the outcomes are governed by the machine's backup, sync and indexing behaviour, none of which the user is thinking about at that moment, and a Nostr identity cannot be rotated. A typed confirmation raises the click cost but does nothing about the consequence, and it establishes a supported feature that malware-adjacent "export your key" instructions can point at. The encrypted file serves the same recovery purpose without that outcome.

**Alternative considered:** keep the plaintext download behind a typed confirmation such as "I understand this file is unencrypted". Rejected because typed confirmations measure compliance, not comprehension, and the residual risk here is total and permanent.

**Alternative considered:** offer no file export at all and rely on transcription. Rejected because a 63-character nsec transcribed by hand is a real loss vector, and users who want a file will otherwise produce a worse one by pasting into a note-taking app that syncs.

### Decision 2: Encrypt the backup under a separate passphrase, not the master password

The export passphrase is supplied at export time, confirmed, and checked against the same strength floor as the master password via `evaluatePasswordStrength`.

**Rationale:** if the backup were sealed under the master password, then forgetting the master password would lose the vault and the backup together, and the backup would add no recovery value at all. A separate secret is also a separate compromise: a shoulder-surfed or keylogged master password does not open a backup file found in Downloads.

**Trade-off:** two secrets to remember, which is real added burden. Mitigation is honesty rather than cleverness: the prompt states plainly that this passphrase is only for this file, that Ostrilo cannot recover it, and that the file is useless without it. We do not offer "use my master password" as a convenience option, because that silently reintroduces the coupling the decision exists to avoid.

**Alternative considered:** derive the backup key from the master password with a distinct info/label. Rejected for the recovery-value reason above.

### Decision 3: Bound the clipboard at 45 seconds, announced, with a manual clear, and no read permission

`handleCopyKey` gains a timer stored in a ref. The copy control states the interval before the user clicks. A visible mono countdown, per `DESIGN_RULES.md` §8, runs while it is pending, alongside a "Clear now" control. The timer is cancelled and the clear run immediately on unmount, on `pagehide`, and when the flow is left, so a pending timer never outlives the document.

The clear overwrites the clipboard without reading it first. **Rationale:** reading the clipboard from an extension page needs the `clipboardRead` permission, which contradicts the minimal-manifest constraint and produces an install-time warning far scarier than the problem it solves. The cost of not reading is that we may replace something the user copied during the interval, so the UI says that will happen. Forty-five seconds sits inside the 30-60 second window: long enough to paste into a password manager, short enough that an intervening copy is unlikely.

When `navigator.clipboard.writeText` rejects, which happens when the document is not focused or the API is unavailable, the current code only logs. Instead the UI states that the copy did not happen and reveals a transcription panel: the nsec in JetBrains Mono, grouped into short blocks, selectable, with the same amber warning treatment. The same panel is the fallback when a clear fails.

**Alternative considered:** gate on `navigator.permissions.query({ name: "clipboard-read" })` and only compare-then-clear when granted. Rejected: two code paths, one of which is never exercised in a build that does not request the permission, is worse than one honest path.

### Decision 4: Complete the state reset, audit the rest of the tree, and be honest about what cannot be erased

`clearSensitiveState` also resets `password` and `confirmPassword` to `""`. The reset is dispatched not only from `handleFinish` but from the back navigation off the backup step, from reveal failure, and from an unmount cleanup effect.

The audit of what else survives in the React tree, all verified against the current code:

| Holder | Contents | Handling |
|---|---|---|
| `state.password`, `state.confirmPassword` | master password | cleared by the completed reset |
| `passwordBackupRef` | master password copy for the reveal | cleared on every exit, not just finish |
| `privateKeyRef` | nsec and hex | cleared on every exit, not just finish |
| `OnboardingCreateKeyBackupStep` props | nsec via `privateKey` prop | the step reads from a ref-backed accessor instead of receiving the value as a prop, so it does not sit in `memoizedProps` |
| the nsec `<Input value=...>` | nsec in a DOM node | value cleared before unmount, not left to GC |
| `PasswordInput` `value` prop | master password | unchanged shape, but the value is cleared with the reducer |
| `evaluatePasswordStrength` RPC | master password, once per keystroke | debounced so the password crosses the message boundary a handful of times instead of dozens |
| `LockScreen` `useState` password | master password | moved to a ref, which also brings the lock screen into line with the existing `Ephemeral Input State` requirement it currently violates |

What this design does not claim: JavaScript strings are immutable, so none of this zeroizes anything. Every value above may persist in the heap until the collector runs, and the RPC boundary makes a structured-clone copy in both the UI and background realms that we cannot reach. `KeyVaultService.revealKey` zeroizes the `Uint8Array` buffers it owns, which is meaningful; the bech32 string it returns is not zeroizable. The achievable goal is a short, bounded retention window with no long-lived references, and that is what is specified. Anything stronger would require moving the string out of JS entirely, which is out of scope here.

### Decision 5: Realm isolation in two steps, lazy boundary first, then a dedicated key-flow document

**Step A, the lazy boundary.** `Logo.tsx` stops importing `ModelViewer` statically. `mode === "model"` renders `React.lazy(() => import("./ModelViewer"))` inside a `Suspense` whose fallback is the static `ostriloPoster` image at the same size, so there is no layout shift and no error surfaced if the chunk or the `.glb` fails to load. Note that the current working tree has just removed that poster overlay from `Logo.tsx`; it needs to come back as the `Suspense` fallback. `three` is also dropped from `optimizeDeps.include` in `wxt.config.ts`, which is dev-prebundling only and cosmetic here, but leaving it in advertises the wrong intent.

This alone moves `three` out of every document's synchronous graph. It is necessary and not sufficient: `OnboardingWelcome` and `OnboardingCreateKey` render in the *same* document, so once the welcome screen has instantiated the model, three.js is resident in the realm that then holds the password. The same is true of `LockScreen`.

**Step B, no model in a key-handling realm.** The hero mascot is removed from `OnboardingWelcome` and `LockScreen`, which both switch to `mode="static"`. `DESIGN_RULES.md` §9 already says the 3D model is for hero moments and "never appears in header chrome or popup critical paths"; this extends that rule with a security reason. The 3D hero survives in a new `src/extension/welcome/` entrypoint, a full-tab document opened on install whose only job is the mascot, the trust line, and the two choices. It has no password or key input at all, and choosing an option navigates the tab, so the realm and its three.js are discarded by the page load.

**Step C, the key-flow document.** A new WXT entrypoint `src/extension/keyflow/` (`index.html` + `main.tsx` + `KeyFlowApp.tsx`) hosts create-key, backup, and import. Its graph is React, the shared UI primitives those steps actually use, the messaging client, and nothing else: no `three`, no `qrcode.react`, no charting. This makes the guarantee structural. The popup and sidepanel keep a small static prompt that opens `keyflow.html` in a tab when no keys exist, which is also better than running a 63-character transcription step inside a 390px popup that closes when it loses focus.

**Unlock stays in the popup and sidepanel**, deliberately. Unlock must be one click from the toolbar, and moving it to another document would add a window per unlock while still requiring the popup document to exist. It is minimised differently: with the model gone the popup no longer pulls three.js at all, and `MainApp` moves behind a lazy boundary so the locked popup loads only the shell plus the lock screen. Today `popup.html` preloads `MainApp` (105 KB), `ApprovalPrompt` (18 KB), `LoadingSpinner` (130 KB) and `useTheme` (892 KB); after this change the locked popup should load the shell and lock screen only.

**The guard.** A post-build Node script enumerates the key-handling documents from the shared constants, parses each output HTML for its module and `modulepreload` graph, walks the transitive chunk set, and fails if any chunk matches a denylist of markers (`WebGLRenderer`, `GLTFLoader`, the `three` package marker). It runs against both `.output/chrome-mv3` and `.output/firefox-mv2`. Without this, Step A and Step B are one careless `mode="model"` away from silent regression.

**Alternative considered:** lazy boundary only, no new entrypoints. Cheapest, and it does remove the 892 KB from initial load, but it leaves the welcome-then-create path in one realm and relies on nobody re-adding a model to a key surface. The whole point is to stop relying on that.

**Alternative considered:** an iframe or sandboxed page for the key steps. Rejected: MV3 sandboxed pages cannot use extension APIs, so the flow could not reach the messaging client, and a same-origin iframe shares the realm anyway.

### Decision 6: Verify the backup with a transcription check or a file round-trip, and say what the check can and cannot prove

The single "I have safely backed up my private key" checkbox is not evidence. It is replaced by a verification step with two routes:

- **Transcription route.** Re-enter the last 8 characters of the nsec. Paste is disabled on that field. Full 63-character re-entry is rejected as disproportionate: users would paste, which proves nothing, or give up.
- **File route.** Re-select the encrypted backup file just saved and enter its passphrase. The extension confirms it decrypts to the same key and discards the plaintext without displaying it. This is the stronger proof, because it establishes that the file exists, is readable, and that the user knows the passphrase, which is exactly what recovery needs.

The acknowledgement checkbox stays, reworded, as an explicit statement of understanding rather than as the gate.

Stated plainly, because the design should not oversell itself: no in-browser check can prove a key was written on paper. Within 45 seconds of a copy the transcription route can be satisfied from the clipboard. The goal is to defeat accidental click-through, which is the common failure, not a determined bypass, which is the user's own risk to take.

### Decision 7: BIP-39 / NIP-06 is an explicit non-goal

A 12-word mnemonic is genuinely easier to transcribe correctly than `nsec1...` and a checksum catches errors. It is still out of scope, because it changes key *generation*, not key *backup*: it requires choosing a derivation path, deciding whether existing non-derived keys can ever be represented, setting cross-client restore expectations, and versioning the key record. That is a separate change with its own migration story, already tracked as `SYNC-004` and `KEYMGMT-002` for v2.2, and folding it in here would delay fixing a plaintext key file that ships today.

The transcription problem is mitigated within this scope instead: the nsec is shown in grouped mono blocks per `DESIGN_RULES.md` §4, the encrypted file route removes the need to transcribe at all, and the verification step catches transcription errors before the user leaves the flow.

### Decision 8: Autofill and password-manager opt-out is layered and admitted to be heuristic

Every key and password input gets `autoComplete="off"` and `spellCheck={false}`, plus the opt-out attributes third-party managers respect (`data-1p-ignore`, `data-lpignore`, `data-bwignore`). The read-only nsec display stops using `type="password"` for masking, because that attribute is the primary signal managers key off; it becomes a text input masked with `-webkit-text-security`, with the eye toggle unchanged. Key inputs are not wrapped in a `<form>`.

None of this is enforcement. `autoComplete="off"` is advisory and managers routinely ignore it; the attributes above are vendor conventions. Layering them reduces the chance of capture and costs nothing, and the masking change removes the one signal that is close to a guarantee of capture. The `-webkit-text-security` masking must be checked in both the Chrome and Firefox builds, since it is a prefixed property; if it does not hold up in Firefox MV2, the fallback is a rendered mask over a value the input does not hold.

## Risks / Trade-offs

- [Risk] Users who want a plaintext key file will work around its removal by revealing the key and pasting it into Notes, Obsidian, or a chat with themselves, all of which sync. -> Mitigation: make the encrypted file the obvious, low-friction default on the same step, state in copy that a pasted-into-notes key is the thing to avoid, and make the file route the easiest way to satisfy verification.
- [Risk] Some users already downloaded a plaintext file from the current build. -> Mitigation: the release note should say plainly that any such file should be deleted, and that if it reached a synced folder the identity should be treated as exposed. There is no rotation for a Nostr identity, so this cannot be softened.
- [Risk] Added onboarding friction. The flow gains a passphrase prompt and a verification step at the exact moment a new user is least invested. -> Mitigation: the passphrase prompt is optional (transcription remains a valid route), verification asks for 8 characters not 63, and the step ordering keeps a single notched primary CTA per screen so the path forward is never ambiguous.
- [Risk] Two secrets to remember, and a user who forgets the backup passphrase has a file that is now landfill. -> Mitigation: state it at the prompt, and keep the transcription route available for users who do not want a second secret.
- [Risk] Splitting the key-handling document costs two new entrypoints, two more HTML files in the build, and duplicated shell and theme setup. -> Mitigation: share the shell through existing components rather than copying, and accept the cost: it converts a review convention into a build-time assertion.
- [Risk] Opening a tab for onboarding is a behaviour change that E2E fixtures and the screenshot runner assume otherwise. -> Mitigation: `tests/e2e/onboarding-create.spec.ts` is currently a skipped placeholder, and `agent-smoke.spec.ts` drives onboarding through the popup, so its navigation and the screenshot steps both need updating in this change rather than afterwards.
- [Risk] The clipboard clear can wipe something the user copied during the interval. -> Mitigation: warn before the copy, show the countdown, and offer "Clear now" so the user can end the window early.
- [Risk] The bundle guard is a denylist, so it catches three.js and not the next heavy dependency someone adds. -> Mitigation: pair the marker denylist with a byte ceiling on the transitive chunk set of each key-handling document, so an unnamed 800 KB addition also fails.
- [Risk] Lazy-loading the model changes first paint on the welcome surface. -> Mitigation: the static poster is the `Suspense` fallback at identical size, so the swap is invisible apart from the model appearing, and the poster remains the permanent state if the chunk fails.
- [Risk] `react-doctor` cannot currently run: `npx react-doctor@latest` fails to install because pnpm rejects it with `ERR_PNPM_TRUST_DOWNGRADE` on `semver@6.3.1`. -> Mitigation: defer that gate to the `restore-security-test-assurance` change, which pins React Doctor locally, and do not treat its absence as a passing signal here.

## Migration Plan

1. No stored-data migration. Key records, salts, IVs and settings are untouched.
2. Ship the lazy boundary and the completed state reset first. Both are self-contained, and the reset is the cheapest fix with the clearest security value.
3. Ship the encrypted export together with the import side that reads `v: 1`. Never ship an export format nothing can read.
4. Ship the entrypoint split with the guard in the same commit, so the guarantee and its enforcement land together.
5. Release notes must call out that plaintext key download is gone, that existing plaintext files should be deleted, and that a file which reached a synced folder means the identity is exposed.
6. Rollback: the lazy boundary, state reset, clipboard timer and autofill attributes revert independently and safely. The entrypoint split reverts by pointing the popup back at the in-popup onboarding container. Reverting the encrypted export would leave already-written `v: 1` files unreadable, so the import-side reader is the one piece that should stay even on rollback.

## Open Questions

- Should the entrypoint split (Decision 5, Steps B and C) land in this change or immediately after it, given that the lazy boundary plus removing `mode="model"` from key surfaces already gets three.js out of every key-handling realm?
- Should `keyflow.html` also host the settings-side add-key and import dialogs, which today live in the options page alongside `ImportKeyForm` and its password input?
- Does `-webkit-text-security` masking hold up in the Firefox MV2 build, or is a rendered mask needed there?
- Should the byte ceiling in the bundle guard be a fixed number or a ratchet recorded in the repo, given the background bundle budget in `openspec/project.md` is already an aspiration rather than a fact?
- Should the encrypted backup envelope carry the public key in the clear so a user can identify which identity a file belongs to without decrypting it, trading a little privacy for a lot of usability?

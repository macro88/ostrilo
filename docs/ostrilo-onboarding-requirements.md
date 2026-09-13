# Ostrilo Extension — First-Time Setup Requirements (Onboarding)

## Scope
Covers first-run flow when no keys or settings exist. User must generate or import a key, set a password, and establish encrypted storage.

---

## Functional requirements (extensions of NS-F-003, NS-F-004, NS-F-005, NS-D-003)

| ID | Title | Priority | Description | Rationale | Acceptance Criteria | Verification |
|---|---|---|---|---|---|---|
| NS-F-003a | Key import (bech32 + hex) | Must | Support importing an existing private key in either bech32 (`nsec1…`) or raw hex. Normalize and validate input. | Users may have different export formats. | Both input types decode to identical 32-byte secret; incorrect formats rejected with clear error. | Unit tests with known vectors. |
| NS-F-003b | Key import password setup | Must | On first import, require the user to define a password. Use Argon2id/PBKDF2 to derive an AES-GCM key. Encrypt the 32-byte secret with fresh salt + iv. | Security at rest. | Encrypted blob stored; no plaintext in storage; login requires password. | Storage inspection + E2E. |
| NS-F-004a | Key generation first run | Must | If no key present, show option to generate new key. Generate cryptographically random 32-byte secret, derive pubkey, and display backup string (`nsec1…`). | Support onboarding without existing keys. | Generated key round-trips to valid pubkey; user can copy/export seed. | Unit tests + UI snapshot. |
| NS-F-004b | Backup verification on generation | Must | After generation, reveal the nsec only on a password-verified `revealKey`, masked by default and shown in grouped mono blocks on request. Require positive evidence the key was recorded before Finish enables: re-enter the last 8 characters of the nsec (paste disabled), or re-open the encrypted backup file with its passphrase. The acknowledgement checkbox is reworded as a statement of understanding and is NOT the gate. | An unverified checkbox is not evidence of a backup; click-through is the common failure. | Finish stays disabled until verification passes, checkbox ticked or not; a wrong answer explains what to do and allows another reveal. | UI test + Playwright `onboarding-create.spec.ts`. |
| NS-F-004c | Encrypted backup export | Must | "Save encrypted backup" writes a versioned `ostrilo-key-backup` envelope (Argon2id KDF + AES-GCM, header bound as AAD) under a passphrase supplied at export time. The key name goes inside the ciphertext; the filename is `ostrilo-backup-<iso-date>.json`. There is NO plaintext export path, not behind a typed confirmation. | A plaintext key file in Downloads is synced, indexed, and read first by infostealers, and a Nostr identity cannot be rotated. | The written file contains no `nsec1`, no hex key and no key name; an incorrect passphrase fails closed with a message that discloses neither. | `tests/security/no-plaintext-key-export.test.ts`. |
| NS-F-004d | Backup passphrase is separate | Must | The backup passphrase is checked against the same strength floor as the master password, is confirmed, and is stated in copy to be separate from the master password and unrecoverable. It is dropped on export success, failure and cancel. | Sealing the backup under the master password would lose vault and backup together, so the backup would add no recovery value. | The flow never offers "use my master password"; the passphrase is not stored, logged, or reused. | UI test. |
| NS-F-004e | Clipboard copies expire | Must | Copying the nsec arms a 45-second clipboard clear, announced before the click with a mono countdown and a "Clear now" control. The clear runs immediately on unmount, on `pagehide`, and on leaving the flow. It overwrites without reading, so the manifest needs no `clipboardRead`. A rejected copy says so and reveals a selectable grouped-mono transcription panel instead of failing silently. | Every application on the machine can read the clipboard, and Universal Clipboard syncs it to other devices. | Clipboard no longer holds the nsec after the interval; nothing copied in the window survives, which the UI warns about first. | `tests/unit/ui/features/onboarding/expiring-clipboard.test.tsx`. |
| NS-F-004f | Key loss is stated plainly | Must | The backup step states that losing both the master password and the backup makes the identity permanently unrecoverable, and that no recovery service, support channel or reset exists. | Honesty is the only available mitigation for an unrotatable identity. | Copy is present on the backup step before Finish. | UI test. |
| NS-F-003c | Encrypted backup import | Must | The onboarding import step recognises a `v: 1` `ostrilo-key-backup` file, asks for its passphrase, decrypts it into the key input, and lets the normal import path re-encrypt the key under the new master password. Legacy plaintext export files remain readable. | Never ship an export format nothing can read. | Correct passphrase recovers the exported key; an incorrect one fails closed. | Unit tests. |
| NS-F-005a | Initial lock state | Must | Immediately after import/gen + password setup, extension is “unlocked” in memory. Lock state resets after auto-lock/close. | Consistent with NS-F-005. | Lock button visible; auto-lock works per settings. | E2E. |
| NS-F-007a | Multi-key onboarding | Must | Even on first run, allow creation/import of multiple keys; one is selected as active. | Multi-profile usage. | Adding second key updates list; header shows selected key. | UI test. |

---

## Non-functional & security (extensions of NS-N-001..003)

| ID | Title | Priority | Description | Rationale | Acceptance Criteria | Verification |
|---|---|---|---|---|---|---|
| NS-N-001a | Input validation | Must | Strict validation of bech32/hex input; reject invalid checksums or length. | Prevent corrupted keys. | Invalid input fails gracefully. | Unit tests. |
| NS-N-002a | Encrypted at rest | Must | Keys always stored encrypted (AES-GCM). Salt + iv random per key. | Confidentiality. | Storage contains only ciphertext. | Storage dump. |
| NS-N-003a | Zeroization on setup | Must | Plaintext secret wiped from memory once encrypted and in storage. | Reduce attack surface. | Buffers zeroized. | Memory tests. |

---

## UI specifics (extensions of NS-U-001, NS-U-004)

| ID | Title | Priority | Description | Acceptance Criteria |
|---|---|---|---|
| NS-U-005 | First-run screen | Must | If no settings/keys: show welcome screen with “Generate new key” and “Import existing key” options. | UI appears only on fresh install; correct flow triggered. |
| NS-U-006 | Import UI | Must | Input accepts bech32 string or hex string; validates; password entry with confirm. | Valid inputs proceed; invalid rejected with clear inline message. |
| NS-U-007 | Generate UI | Must | Generates key; reveals the nsec only after a password-verified reveal, masked by default with an eye toggle; offers a timed copy, a grouped-mono transcription panel, and an encrypted backup file. No `type="password"` on the nsec display and no QR affordance for private key material. | Finish enables only after backup verification passes. |
| NS-U-010 | Autofill exclusion | Must | Every key and password input sets `autoComplete="off"`, `spellCheck={false}` and the manager opt-out attributes (`data-1p-ignore`, `data-lpignore`, `data-bwignore`), and no key input is wrapped in a `<form>`. | Layered and admittedly heuristic; the masking change removes the one signal that is close to a guarantee of capture. |
| NS-U-011 | No 3D model in key surfaces | Must | Onboarding, the backup step and the lock screen render the static mascot. `Logo` refuses `mode="model"` in any document declared key-handling. | No key-handling document instantiates WebGL; the build guard fails if one reaches three.js. |
| NS-U-008 | Password setup | Must | Password entry, confirm field, error if mismatch. Strength meter (basic). | Cannot continue with mismatch or weak password. |
| NS-U-009 | Success transition | Must | After import/gen + password: extension enters normal Home tab (NS-U-001). | Pubkey visible in header; lock state visible. |

---

## Data and storage (extensions of NS-D-001..003)

- **Schema additions:**  
  - `keys[]` must support multiple entries, each with encrypted private key, iv, salt, createdAt.  
  - `selectedKeyId` points to active key.  
- **Backup hints:** NS-D-003 extended — after gen/import, force the user through the backup flow and require verification, not a confirm checkbox.  
- **Sensitive state:** the master password, its confirmation, and the revealed key are cleared on every exit from the create-key flow — completion, back navigation, reveal failure and unmount — not only on Finish. JavaScript strings cannot be zeroized; the goal is a short, bounded retention window with no long-lived references, and nothing here claims more.  

---

## Acceptance tests

1. **Fresh install generate flow:** Open extension → welcome screen → choose generate → new key created, backup shown, password set → Home shows header with pubkey.  
2. **Fresh install import (bech32):** Input valid `nsec1…`, password → Home shows correct pubkey.  
3. **Fresh install import (hex):** Input 64-char hex, password → Home shows correct pubkey.  
4. **Invalid import:** Input bad string → inline error; cannot continue.  
5. **Backup verification required:** Finish stays disabled until the user re-enters the last 8 characters of the nsec or re-opens the encrypted backup file; ticking the acknowledgement checkbox alone does not enable it.  
8. **Encrypted backup round-trip:** Save an encrypted backup, then import it on a fresh install with its passphrase → the same key is recovered and re-encrypted under the new master password. Wrong passphrase fails closed.  
9. **No plaintext export:** No control on any onboarding surface produces a file containing `privateKey` or `privateKeyHex` in the clear.  
6. **Password mismatch/weak:** UI blocks continue; shows message.  
7. **Persistence:** After reload, settings + encrypted key remain; extension requires unlock password.  

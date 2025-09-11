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
| NS-F-004b | Backup hints on generation | Must | After generation, show backup instructions (nsec string) and require user to confirm they copied it. | Reduce key loss risk. | User cannot continue until they check confirmation. | UI test. |
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
| NS-U-007 | Generate UI | Must | Generates key; shows pubkey + nsec backup; backup instructions and confirm checkbox before continue. | User must check confirm before proceed. |
| NS-U-008 | Password setup | Must | Password entry, confirm field, error if mismatch. Strength meter (basic). | Cannot continue with mismatch or weak password. |
| NS-U-009 | Success transition | Must | After import/gen + password: extension enters normal Home tab (NS-U-001). | Pubkey visible in header; lock state visible. |

---

## Data and storage (extensions of NS-D-001..003)

- **Schema additions:**  
  - `keys[]` must support multiple entries, each with encrypted private key, iv, salt, createdAt.  
  - `selectedKeyId` points to active key.  
- **Backup hints:** NS-D-003 extended — after gen/import, force user through backup flow with confirm.  

---

## Acceptance tests

1. **Fresh install generate flow:** Open extension → welcome screen → choose generate → new key created, backup shown, password set → Home shows header with pubkey.  
2. **Fresh install import (bech32):** Input valid `nsec1…`, password → Home shows correct pubkey.  
3. **Fresh install import (hex):** Input 64-char hex, password → Home shows correct pubkey.  
4. **Invalid import:** Input bad string → inline error; cannot continue.  
5. **Backup confirm required:** User cannot continue until backup confirm checked.  
6. **Password mismatch/weak:** UI blocks continue; shows message.  
7. **Persistence:** After reload, settings + encrypted key remain; extension requires unlock password.  

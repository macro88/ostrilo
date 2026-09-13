# Ostrilo Signer Extension Requirements

Traceable requirements table for the WXT + React + shadcn Nostr signer extension.

## Functional requirements

| ID | Title | Priority | Description | Rationale | Acceptance Criteria | Verification |
|---|---|---|---|---|---|---|
| NS-F-001 | NIP-07 provider | Must | PV exposes `window.nostr.getPublicKey` and `signEvent`, proxied to BG | dApps need a standard signer | A dApp calling those methods receives valid responses when unlocked and clear errors when locked | Unit test PV bridge; E2E with sample dApp |
| NS-F-002 | Background-only signing | Must | All signing and key ops run in BG only | Reduce attack surface | PV and CS never access plaintext key; source scan confirms no export | Static analysis; unit tests |
| NS-F-003 | Key import (nsec) | Must | Import `nsec1…` and store encrypted bytes in `chrome.storage.local` | Onboarding | After import and unlock, `getPublicKey` returns correct pubkey | Unit test nsec decode |
| NS-F-004 | Key generation | Should | Create new 32-byte secret and show nsec + backup flow | Users without keys | New key produces deterministic pubkey; user can copy nsec | Unit test RNG length |
| NS-F-005 | Lock/unlock | Must | Passphrase-derived key decrypts secret into memory; auto-lock timer | Security | Locked state blocks signing; timer re-locks; manual lock works | E2E across popup reload |
| NS-F-006 | Per-origin approvals | Must | User must approve first signEvent from origin. Supports Allow/Once/Deny. User can set trust policy per origin+event kind: Deny/Prompt/Allow. Trust levels allow automatic signing of specific kinds while unlocked. | Phishing control + convenience | Requests queue visible; trust policy persists; automatic signing occurs only for allowed kinds; override available | E2E simulate origins with different trust levels |
| NS-F-007 | Multiple key support | Must | Extension manages multiple keys. User can select active key in header. | Required for multi-profile usage | User can add/import multiple nsec keys; switch active key in UI; header updates | UI + functional test |
| NS-F-008 | Activity log | Should | Show last 50 sign approvals/denials with timestamp and origin | Audit | Entries appear immediately and survive popup reload | Unit test persistence |
| NS-F-009 | Header status | Must | Header shows selected key (truncated) and avatar placeholder | UX | Truncated hex visible; copy-to-clipboard works | UI test |
| NS-F-010 | Bottom tabs | Must | Tabs: Home, Profile, Activity, Settings with large icons | UX parity | Tabs switch views; state persists last selected tab | UI test |
| NS-F-011 | Profile hydrate (kind:0) | Could | Fetch user metadata and display picture/name if available | Nice UX | Valid picture updates avatar; errors don’t crash | Mock relay feed test |
| NS-F-012 | DM crypto (nip04/nip44) | Should | Expose encrypt/decrypt via PV when enabled | Interop | Encrypt/decrypt round-trips with vectors | Crypto unit tests |
| NS-F-013 | Options page | Should | Full options for key mgmt, permissions, export, about | Manageability | Options page reachable; settings persist | UI test |
| NS-F-014 | Export and wipe | Should | Export nsec after re-auth; wipe securely | Recovery | Export blocked when locked; wipe zeroizes memory and clears storage | E2E |
| NS-F-015 | Error surfacing | Must | Uniform error codes: `locked`, `needs_approval`, `denied`, `invalid_event` | DX | dApps receive stable error strings | Contract test |
| NS-F-016 | Minimal permissions | Must | Manifest has only `storage`, `scripting`; no host permissions | Least privilege | Linter check passes; store review safe | Manifest lint |

## Non-functional and security

| ID | Title | Priority | Description | Rationale | Acceptance Criteria | Verification |
|---|---|---|---|---|---|---|
| NS-N-001 | Crypto suite | Must | Noble secp256k1 schnorr + SHA-256; WebCrypto AES-GCM with AAD; **Argon2id (m=19456 KiB, t=2, p=1, dkLen=32)** as shipped in vault format `v:1`. Parameters are recorded per vault, never implied by code, and validated against a floor on read. PBKDF2-HMAC-SHA256 is a supported recorded variant (floor 600,000 iterations, native WebCrypto); pure-JS PBKDF2 at 100,000 iterations is retained read-only for pre-`v:1` material. | Correctness | BIP-340 and NIP-01 vectors pass; envelope/AAD/migration suite passes | Unit + security tests |
| NS-N-002 | Key encryption at rest | Must | AES-GCM ciphertext only in storage with random salt+iv | Security | No plaintext key or passphrase in storage | Storage dump |
| NS-N-003 | Zeroization | Must | Overwrite Uint8Array secrets on lock/unload | Defense in depth | Buffers are zeroed after lock | Unit test |
| NS-N-004 | Auto-lock | Must | Lock on idle and on BG suspend | Risk control | After idle minutes or suspend, state is locked | Simulated idle test |
| NS-N-005 | No remote code | Must | CSP avoids eval; no remote scripts | Supply chain | Build/runtime scans show none | CI |
| NS-N-006 | Bundle hygiene | Should | Background bundle ≤150KB gz; no `nostr-tools` in BG | Footprint | Size check passes | CI |
| NS-N-007 | Telemetry | Must | Disabled by default | Privacy | No network calls except explicit profile fetch | Proxy test |
| NS-N-008 | Multi-browser | Should | Chrome/Edge/Firefox via WXT; Safari via export | Reach | Builds for multiple targets | Build matrix |
| NS-N-009 | Performance | Should | Sign ≤5 ms median | UX | Bench in CI | Bench job |
| NS-N-010 | Accessibility | Could | Focus order, keyboard nav, ARIA | Usability | A11y audit ≥90 | Lighthouse |

## UI specifics

| ID | Title | Priority | Description | Rationale | Acceptance Criteria | Verification |
|---|---|---|---|---|---|---|
| NS-U-001 | Home view | Must | Shows lock state, pubkey, quick actions | First-run clarity | Lock/unlock visible; errors inline | UI test |
| NS-U-002 | Profile view | Should | Fields for name, picture preview, about | Roadmap | Render metadata if present | Mock test |
| NS-U-003 | Activity view | Should | List approvals/denials with filters | Transparency | Filter by origin/result | UI test |
| NS-U-004 | Settings view | Must | Passphrase change, auto-lock, DM toggles, per-origin trust | Control | Changes take effect immediately | E2E |

## Protocol roadmap

| ID | Title | Priority | Description | Rationale | Acceptance Criteria | Verification |
|---|---|---|---|---|---|---|
| NS-P-001 | NIP-07 core | Must | Ship `getPublicKey`, `signEvent` | MVP interop | Works with popular dApps | Manual interop |
| NS-P-002 | NIP-46 pairing | Could | Remote signer support | Mobile pairing | Pair via QR, approve remote requests | Later E2E |
| NS-P-003 | NIP-26 delegated keys | Could | Delegation creation and use | Advanced users | Create delegation; sign with delegate | Unit tests |

## Build, test, ops

| ID | Title | Priority | Description | Rationale | Acceptance Criteria | Verification |
|---|---|---|---|---|---|---|
| NS-B-001 | Tooling | Must | WXT + TS + React + shadcn; no `nostr-tools` in BG | Reproducible builds | `pnpm run build` outputs bundles | CI |
| NS-B-002 | Tests | Must | Vitest unit; Playwright E2E with extension | Quality | CI runs both | CI |
| NS-B-003 | Lint + type | Must | ESLint, TS strict | Safety | No lint or type errors | CI |
| NS-B-004 | Secrets scanning | Should | Check repo for key material | Safety | CI fails on matches | CI |
| NS-B-005 | Versioning | Should | Semver + changelog | Traceability | CHANGELOG updated per release | Review |

## Data and storage

| ID | Title | Priority | Description | Rationale | Acceptance Criteria | Verification |
|---|---|---|---|---|---|---|
| NS-D-001 | Storage schema | Must | `salt`, `iv`, `ct`, settings, approvals, activity, keys[] | Orderly data | Keys documented and validated on load | Unit test |
| NS-D-002 | Migration | Should | Versioned schema with migrate steps | Durability | Upgrades don’t lose keys | Migration tests |
| NS-D-003 | Backup hints | Should | Show recovery instructions after import/gen | Support | Users see backup info | UI snapshot |

## Constraints and out-of-scope (MVP)

- No relay management UI in MVP  
- No telemetry or crash reporting in MVP  
- Safari build optional  

# Ostrilo Product Requirements Document

## Overview

Ostrilo is a secure browser extension that provides Nostr key management and signing operations. It acts as a NIP-07 compliant signer, enabling web applications to interact with the Nostr protocol without exposing private keys.

## Requirements Traceability Matrix

Status legend:
- ✅ **Done** - Fully implemented and tested
- 🔄 **In Progress** - Partially implemented
- ⬜ **Not Started** - No implementation exists
- ❌ **Removed** - Removed from scope

---

## Functional Requirements

| ID | Title | Priority | Status | Notes | OpenSpec Proposal Prompt |
|----|-------|----------|--------|-------|--------------------------|
| NS-F-001 | NIP-07 provider | Must | ⬜ Not Started | Content script is a stub; `window.nostr.getPublicKey` and `signEvent` not implemented | "Create a proposal to implement NIP-07 provider in the content script that exposes `window.nostr.getPublicKey` and `signEvent` methods, proxying requests to the background script via message passing" |
| NS-F-002 | Background-only signing | Must | ✅ Done | All signing ops run in KeyVaultService via background RPC | |
| NS-F-003 | Key import (nsec) | Must | ✅ Done | Supports nsec1 and hex formats in OnboardingImportKey | |
| NS-F-003a | Key import (bech32 + hex) | Must | ✅ Done | parsePrivateKey handles both formats | |
| NS-F-003b | Key import password setup | Must | ✅ Done | Password validation, PBKDF2 KDF, AES-GCM encryption | |
| NS-F-004 | Key generation | Should | ✅ Done | generateKey creates 32-byte secret, derives pubkey | |
| NS-F-004a | Key generation first run | Must | ✅ Done | OnboardingCreateKey flow complete | |
| NS-F-004b | Backup hints on generation | Must | ✅ Done | Backup step with checkbox confirmation | |
| NS-F-005 | Lock/unlock | Must | ✅ Done | KeyVaultService.unlock/lock with session storage | |
| NS-F-005a | Initial lock state | Must | ✅ Done | Post-onboarding unlock state works | |
| NS-F-006 | Per-origin approvals | Must | ✅ Done | PolicyService with evaluatePolicy, trust levels | |
| NS-F-006a | Per-origin per-kind policy | Must | ✅ Done | setPerKindRule in PolicyService | |
| NS-F-006b | Origin trust level | Must | ✅ Done | TrustLevel enum with low/medium/high | |
| NS-F-006c | Session Allow-ALL | Must | ✅ Done | sessionGrantAll flag, cleared on lock | |
| NS-F-006d | Explicit deny precedence | Must | ✅ Done | evaluatePolicy checks deny first | |
| NS-F-006e | Policy preview | Should | ✅ Done | SettingsView shows origin policies | |
| NS-F-007 | Multiple key support | Must | ✅ Done | KeyVaultService manages array of KeyRecord | |
| NS-F-007a | Multi-key onboarding | Must | ✅ Done | First key selection logic implemented | |
| NS-F-008 | Activity log | Should | 🔄 In Progress | ActivityView exists but shows static placeholder data | "Create a proposal to implement persistent activity logging that records sign approvals/denials with timestamp, origin, event kind, and result, storing the last 50 entries and displaying them in ActivityView with filters" |
| NS-F-009 | Header status | Must | ✅ Done | Header shows pubkey via Pubkey component | |
| NS-F-010 | Bottom tabs | Must | ✅ Done | Home, Profile, Activity, Settings tabs implemented | |
| NS-F-011 | Profile hydrate (kind:0) | Could | ⬜ Not Started | ProfileView is placeholder, no relay fetch | "Create a proposal to implement profile metadata fetching (NIP-01 kind:0) from configured relays, caching results in profileCache storage, and displaying name/picture/about in ProfileView" |
| NS-F-012 | DM crypto (nip04/nip44) | Should | ⬜ Not Started | No encrypt/decrypt methods exposed | "Create a proposal to implement NIP-04 and NIP-44 encryption/decryption methods in the crypto layer, exposing them via window.nostr.nip04 and window.nostr.nip44 APIs when enabled in settings" |
| NS-F-013 | Options page | Should | ✅ Done | SettingsView provides full options UI | |
| NS-F-014 | Export and wipe | Should | ⬜ Not Started | No export nsec or wipe functionality | "Create a proposal to implement secure key export (requiring re-authentication) and secure wipe functionality that zeroizes memory and clears all storage" |
| NS-F-015 | Error surfacing | Must | 🔄 In Progress | RPC uses error strings but no uniform error codes | "Create a proposal to standardize error codes across the RPC layer with uniform error codes: `locked`, `needs_approval`, `denied`, `invalid_event`, ensuring dApps receive stable error strings" |
| NS-F-016 | Minimal permissions | Must | ✅ Done | Manifest has only `storage`, `sidePanel` | |

---

## Non-Functional & Security Requirements

| ID | Title | Priority | Status | Notes | OpenSpec Proposal Prompt |
|----|-------|----------|--------|-------|--------------------------|
| NS-N-001 | Crypto suite | Must | ✅ Done | Noble secp256k1 schnorr, SHA-256, WebCrypto AES-GCM, PBKDF2 | |
| NS-N-001a | Input validation | Must | ✅ Done | Zod schemas validate RPC inputs | |
| NS-N-002 | Key encryption at rest | Must | ✅ Done | AES-GCM with random salt+iv per key | |
| NS-N-002a | Encrypted at rest | Must | ✅ Done | KeyRecord stores ct/iv/salt arrays | |
| NS-N-003 | Zeroization | Must | ✅ Done | zeroize utility, used in KeyVaultService | |
| NS-N-003a | Zeroization on setup | Must | ✅ Done | Private key zeroed after encryption | |
| NS-N-004 | Auto-lock | Must | 🔄 In Progress | autoLockMinutes setting exists but timer not implemented | "Create a proposal to implement auto-lock timer in the background script that monitors idle time and triggers vault.lock after the configured autoLockMinutes, including handling browser suspend events" |
| NS-N-005 | No remote code | Must | ⬜ Not Started | No CSP validation in CI | "Create a proposal to add CI validation that scans build output for eval, remote scripts, and validates CSP headers in manifest.json" |
| NS-N-006 | Bundle hygiene | Should | ⬜ Not Started | No size check in CI | "Create a proposal to add bundle size monitoring to CI that fails if background bundle exceeds 150KB gzipped and verifies nostr-tools is not included in the background bundle" |
| NS-N-007 | Telemetry | Must | ✅ Done | No telemetry/network calls in extension | |
| NS-N-008 | Multi-browser | Should | 🔄 In Progress | Build scripts exist but not verified in CI | "Create a proposal to add multi-browser build verification to CI that builds and validates Chrome MV3, Firefox MV2, and optionally Safari targets" |
| NS-N-009 | Performance | Should | ⬜ Not Started | No benchmark tests | "Create a proposal to add performance benchmarks that measure sign operation latency (target ≤5ms median) and run in CI" |
| NS-N-010 | Accessibility | Could | ⬜ Not Started | No a11y audit configured | "Create a proposal to add accessibility testing with Lighthouse a11y audit targeting ≥90 score, including focus order and keyboard navigation" |
| NS-N-011 | Atomic writes | Must | ✅ Done | Settings writes are atomic via storage.set | |
| NS-N-012 | Session isolation | Must | ✅ Done | Session grants in session storage, cleared on lock | |
| NS-N-013 | Privacy | Must | ✅ Done | Policy evaluation is offline | |

---

## UI Requirements

| ID | Title | Priority | Status | Notes | OpenSpec Proposal Prompt |
|----|-------|----------|--------|-------|--------------------------|
| NS-U-001 | Home view | Must | ✅ Done | HomeView shows status cards, settings summary | |
| NS-U-002 | Profile view | Should | 🔄 In Progress | ProfileView placeholder, no metadata display | "Create a proposal to implement profile metadata display in ProfileView, showing name, picture, about, and website from cached kind:0 events, with an Edit Profile button for future NIP-07 publishing" |
| NS-U-003 | Activity view | Should | 🔄 In Progress | ActivityView shows static data, not connected to storage | "Create a proposal to connect ActivityView to persistent activity log storage, displaying real sign events with origin/kind filters and pagination" |
| NS-U-004 | Settings view | Must | ✅ Done | SettingsView has theme, auto-lock, relays, origins | |
| NS-U-005 | First-run screen | Must | ✅ Done | OnboardingWelcome with Generate/Import options | |
| NS-U-006 | Import UI | Must | ✅ Done | OnboardingImportKey with validation | |
| NS-U-007 | Generate UI | Must | ✅ Done | OnboardingCreateKey with backup step | |
| NS-U-008 | Password setup | Must | ✅ Done | Password strength validation | |
| NS-U-009 | Success transition | Must | ✅ Done | Onboarding completes to HomeView | |

---

## Protocol Roadmap

| ID | Title | Priority | Status | Notes | OpenSpec Proposal Prompt |
|----|-------|----------|--------|-------|--------------------------|
| NS-P-001 | NIP-07 core | Must | ⬜ Not Started | Content script stub, no window.nostr | "Create a proposal to implement NIP-07 core functionality with getPublicKey and signEvent methods, including content script injection, message passing to background, and approval prompt UI" |
| NS-P-002 | NIP-46 pairing | Could | ⬜ Not Started | Not implemented | "Create a proposal to implement NIP-46 remote signer support with QR code pairing and remote request approval flow" |
| NS-P-003 | NIP-26 delegated keys | Could | ⬜ Not Started | Not implemented | "Create a proposal to implement NIP-26 delegation token creation and verification for delegated signing" |

---

## Build, Test & Ops Requirements

| ID | Title | Priority | Status | Notes | OpenSpec Proposal Prompt |
|----|-------|----------|--------|-------|--------------------------|
| NS-B-001 | Tooling | Must | ✅ Done | WXT + TS + React + shadcn; no nostr-tools in BG | |
| NS-B-002 | Tests | Must | ✅ Done | Vitest unit (190 tests), Playwright E2E scaffolded | |
| NS-B-003 | Lint + type | Must | ✅ Done | ESLint, TS strict pass | |
| NS-B-004 | Secrets scanning | Should | ⬜ Not Started | No CI secret scanning | "Create a proposal to add secret scanning to CI that checks repository for private key material and fails on matches" |
| NS-B-005 | Versioning | Should | ⬜ Not Started | No CHANGELOG or semver process | "Create a proposal to establish semver versioning with automated CHANGELOG generation on release" |

---

## Data & Storage Requirements

| ID | Title | Priority | Status | Notes | OpenSpec Proposal Prompt |
|----|-------|----------|--------|-------|--------------------------|
| NS-D-001 | Storage schema | Must | ✅ Done | AppSettingsV1, KeyRecord types defined | |
| NS-D-002 | Migration | Should | 🔄 In Progress | __version guard exists, no migration functions | "Create a proposal to implement storage schema migration system with versioned upgrade functions and rollback capability" |
| NS-D-003 | Backup hints | Should | ✅ Done | Backup flow in onboarding with confirm checkbox | |

---

## Summary Statistics

| Status | Count |
|--------|-------|
| ✅ Done | 37 |
| 🔄 In Progress | 8 |
| ⬜ Not Started | 15 |
| ❌ Removed | 0 |

**Total Requirements:** 60

---

## Next Priority Items

Based on MVP requirements (Must priority, Not Started):

1. **NS-F-001 / NS-P-001** - NIP-07 Provider (Core MVP functionality)
2. **NS-F-015** - Error Surfacing (Developer experience)
3. **NS-N-005** - No Remote Code Validation (Security)
4. **NS-N-004** - Auto-lock Timer (Security)

## Constraints & Out-of-Scope (MVP)

- No relay management UI in MVP
- No telemetry or crash reporting in MVP
- Safari build optional
- NIP-46 and NIP-26 are post-MVP features

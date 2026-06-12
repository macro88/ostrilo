# Ostrilo v2 Product Requirements Document
## The World's Best Nostr Signing Extension

- **Document Version:** 2.1
- **Created:** 2025-12-09
- **Original Target Release:** Q2 2025
- **Last Status Reconciliation:** 2026-06-12
- **Document Status:** Roadmap Status Draft

---

## Executive Summary

Ostrilo v2 aims to become the **world's best Nostr signing extension** by delivering unparalleled security, exceptional user experience, comprehensive protocol support, and outstanding developer ergonomics. Building on the solid foundation of v1, this PRD outlines a strategic roadmap to position Ostrilo as the definitive choice for Nostr users across all skill levels.

### Vision Statement

**"Ostrilo: Your fortress for Nostr identity—secure by default, delightful by design, and trusted by everyone."**

### Strategic Goals

1. **Security First:** Industry-leading cryptographic practices with defense-in-depth
2. **Universal Accessibility:** Support all major Nostr use cases and protocols
3. **Developer Delight:** Best-in-class APIs and integration experience
4. **User Empowerment:** Intuitive controls for complete sovereignty
5. **Performance Excellence:** Sub-5ms signing, instant UI responses
6. **Cross-Platform Leadership:** Seamless experience across all browsers and devices

---

## Table of Contents

- [Requirements Traceability Matrix](#requirements-traceability-matrix)
- [Epic 1: Security & Privacy Hardening](#epic-1-security--privacy-hardening)
- [Epic 2: Advanced Protocol Support](#epic-2-advanced-protocol-support)
- [Epic 3: Enhanced User Experience](#epic-3-enhanced-user-experience)
- [Epic 4: Developer Experience & Integration](#epic-4-developer-experience--integration)
- [Epic 5: Performance & Reliability](#epic-5-performance--reliability)
- [Epic 6: Multi-Device & Sync](#epic-6-multi-device--sync)
- [Epic 7: Privacy-Preserving Features](#epic-7-privacy-preserving-features)
- [Epic 8: Advanced Key Management](#epic-8-advanced-key-management)
- [Epic 9: Social & Discovery Features](#epic-9-social--discovery-features)
- [Epic 10: Monitoring & Analytics](#epic-10-monitoring--analytics)
- [Implementation Roadmap](#implementation-roadmap)
- [Success Metrics](#success-metrics)

---

## Requirements Traceability Matrix

**Legend:**
- **Priority:** M=Must, S=Should, C=Could, W=Won't (MoSCoW)
- **Status:** ✅ Done | 🔄 In Progress | ⬜ Not Started | ❌ Removed
- **Version:** Target semantic version for delivery

### Summary Statistics

| Priority | Total | v1.x | v2.0 | v2.1 | v2.2+ |
|----------|-------|------|------|------|-------|
| Must     | 62    | 38   | 18   | 6    | 0     |
| Should   | 48    | 10   | 22   | 12   | 4     |
| Could    | 35    | 2    | 8    | 15   | 10    |
| Won't    | 8     | 0    | 0    | 0    | 8     |
| **Total**| **153** | **50** | **48** | **33** | **22** |

### Current Implementation Snapshot

- **Status date:** 2026-06-12
- **Source of truth:** current `src/`, `tests/`, `openspec/specs/`, archived OpenSpec changes, and project docs in this repository.

The original release dates are now historical planning targets. The status markers in this document describe the current codebase, not the original plan.

**Implemented in the current codebase:**

- NIP-07 core provider: `window.nostr.getPublicKey()` and `window.nostr.signEvent()` are injected at document start and route through content/background messaging.
- Background-only key operations, encrypted local key storage, multi-key management, active-key selector, add/import/rename/delete flows, and guarded last-key deletion.
- Per-origin trust policy evaluation, medium-trust event kind defaults, explicit per-kind rules, session grants, managed approval queue/window, event de-duplication, batch approval actions, and Activity-page pending approval access.
- Persistent activity log with real signing decisions, origin/kind filters, pagination, clear action, configurable retention up to 500 entries, and local JSON export.
- Profile metadata management for NIP-01 kind:0 profile fetch/cache/display/edit/publish, relay settings, multi-relay querying, and relay publish support.
- Full Options Page with General, Keys & Identities, Security, Permissions, Activity Log, Relays, and Advanced tabs plus local cross-context settings sync.
- Structured JSON-RPC-compatible error responses with canonical machine codes, numeric mappings, and developer docs.
- Light/dark/system theme selection with live system-preference updates across popup, side panel, approval window, and options page.
- WXT Chrome/Firefox build targets, Playwright extension E2E tests, smoke screenshot flow, and React Doctor CI.

**Partially implemented or narrower than the PRD wording:**

- Memory zeroization exists for `Uint8Array` key material and derived keys, but some password fields still pass through React state and JavaScript strings, so the "complete zeroization" and "secure UI isolation" goals are not fully met.
- Approval prompts show event kind, content, tags, signer, event hash, and raw details, but they do not yet include risk scoring or NIP-specific semantic warnings.
- Key reveal/export APIs and onboarding backup exist, but there is no encrypted backup/recovery workflow, cloud/user-controlled backup target, or full wipe-on-uninstall behavior.
- Activity filtering covers origin and event kind; it does not yet include full-text search, date-range filtering, result filtering, or saved presets.
- Accessibility has meaningful keyboard/ARIA coverage for key management and Radix-based controls, but no repo-wide WCAG 2.1 AA audit has been completed.
- Relay/profile infrastructure exists, but NIP-specific protocol flows such as NIP-04, NIP-44, NIP-42, NIP-57 validation, NIP-65 publish workflows, and NIP-05 DNS verification remain unimplemented.
- Settings use browser sync storage and synchronize between local extension contexts, but cross-device sync, conflict handling, and NIP-78/decentralized sync are deferred.

---

## Epic 1: Security & Privacy Hardening
**Strategic Importance:** CRITICAL  
**Target Version:** v2.0  
**Owner:** Security Team

### Rationale
Security is the foundation of trust in a signing extension. Users entrust Ostrilo with their digital identity's most sensitive credentials. Any security vulnerability could lead to catastrophic loss of funds, reputation, and privacy.

### Requirements

| ID | Title | Priority | Status | Version | Epic | OpenSpec Proposal Prompt |
|----|-------|----------|--------|---------|------|--------------------------|
| SEC-001 | Complete Memory Zeroization | M | 🔄 | v2.0 | 1 | "Create a proposal to implement comprehensive memory zeroization for all sensitive data including private keys, passwords, derived keys, and decrypted plaintext throughout the application lifecycle, ensuring buffers are zeroed immediately after use in try-finally blocks" |
| SEC-002 | Hardware Security Module Support | S | ⬜ | v2.1 | 1 | "Create a proposal to add optional hardware security module (HSM) integration via WebAuthn for private key storage, allowing users to store keys on YubiKey, Ledger, or similar devices" |
| SEC-003 | Secure UI Component Isolation | M | 🔄 | v2.0 | 1 | "Create a proposal to refactor UI components to never store private keys or passwords in React state, using refs and immediate RPC forwarding instead, with secure memory handling" |
| SEC-004 | Content Security Policy Enforcement | M | ⬜ | v2.0 | 1 | "Create a proposal to add CI validation that scans build output for eval, inline scripts, and unsafe-inline directives, ensuring strict CSP compliance in manifest.json" |
| SEC-005 | Secrets Scanning in CI/CD | M | ⬜ | v2.0 | 1 | "Create a proposal to integrate automated secrets scanning in CI/CD pipeline using tools like TruffleHog or git-secrets to detect accidentally committed private keys, API tokens, or passwords" |
| SEC-006 | Rate Limiting for Signing Operations | S | ⬜ | v2.0 | 1 | "Create a proposal to implement rate limiting on signing operations per origin to prevent abuse, with configurable thresholds (e.g., 100 signs/minute) and temporary blocks for suspicious activity" |
| SEC-007 | Phishing Protection with Domain Verification | M | ⬜ | v2.0 | 1 | "Create a proposal to implement domain verification against known phishing sites using community-maintained blocklists, warning users before signing on suspicious domains" |
| SEC-008 | Event Content Preview with Risk Analysis | M | 🔄 | v2.0 | 1 | "Create a proposal to enhance approval prompts with intelligent event content preview, detecting potential risks like large zap amounts, sensitive DM content, or malicious relay instructions" |
| SEC-009 | Biometric Authentication Support | S | ⬜ | v2.1 | 1 | "Create a proposal to integrate WebAuthn for biometric unlock (fingerprint, Face ID) as an alternative or supplement to password-based unlock" |
| SEC-010 | Multi-Factor Authentication | S | ⬜ | v2.1 | 1 | "Create a proposal to add optional 2FA/MFA support for high-value operations like key export, settings changes, or large zap approvals" |
| SEC-011 | Secure Backup & Recovery | M | 🔄 | v2.0 | 1 | "Create a proposal to implement secure encrypted backup export with optional cloud storage integration (user-controlled), using strong encryption and requiring re-authentication" |
| SEC-012 | Session Timeout with Gradual Lock | S | 🔄 | v2.0 | 1 | "Create a proposal to implement intelligent session timeout that gradually restricts permissions (e.g., first lock auto-signing, then require password) based on inactivity patterns" |
| SEC-013 | Audit Log with Tamper Detection | S | 🔄 | v2.1 | 1 | "Create a proposal to implement comprehensive audit logging with cryptographic tamper detection, recording all security-relevant events with timestamps and integrity checks" |
| SEC-014 | Secure Wipe on Extension Removal | M | ⬜ | v2.0 | 1 | "Create a proposal to implement secure data wipe on extension uninstall, ensuring all keys and sensitive data are cryptographically erased from storage" |
| SEC-015 | Key Derivation Hardening (Argon2id) | M | ⬜ | v2.0 | 1 | "Create a proposal to upgrade key derivation from PBKDF2 to Argon2id with tunable parameters (memory-hard, GPU-resistant) for stronger password-based encryption" |
| SEC-016 | Sandboxed Crypto Operations | S | ⬜ | v2.1 | 1 | "Create a proposal to isolate cryptographic operations in dedicated Web Workers or separate contexts to minimize attack surface and prevent side-channel attacks" |
| SEC-017 | Supply Chain Security Verification | M | ⬜ | v2.0 | 1 | "Create a proposal to implement dependency verification with lock file integrity checks, automated security audits (npm audit), and reproducible builds" |
| SEC-018 | Deterministic Event Signing Detection | S | ⬜ | v2.0 | 1 | "Create a proposal to detect and warn users about requests for deterministic signatures (replay attacks) versus standard randomized Schnorr signatures" |

---

## Epic 2: Advanced Protocol Support
**Strategic Importance:** HIGH  
**Target Version:** v2.0-v2.1  
**Owner:** Protocol Team

### Rationale
Nostr is rapidly evolving with new NIPs. Supporting advanced protocols positions Ostrilo as the most capable and future-proof extension, enabling users to participate in all Nostr use cases.

### Requirements

| ID | Title | Priority | Status | Version | Epic | OpenSpec Proposal Prompt |
|----|-------|----------|--------|---------|------|--------------------------|
| PROTO-001 | NIP-04 Encrypted Direct Messages | S | ⬜ | v2.0 | 2 | "Create a proposal to implement NIP-04 encryption/decryption methods for direct messages, exposing window.nostr.nip04.encrypt and nip04.decrypt with proper ECDH key agreement and AES-CBC" |
| PROTO-002 | NIP-44 Versioned Encryption | S | ⬜ | v2.0 | 2 | "Create a proposal to implement NIP-44 versioned encryption/decryption with improved security over NIP-04, including conversation key caching and proper padding" |
| PROTO-003 | NIP-46 Nostr Connect (Remote Signing) | C | ⬜ | v2.1 | 2 | "Create a proposal to implement NIP-46 remote signer support allowing mobile apps to connect via QR code pairing and send remote signing requests over Nostr" |
| PROTO-004 | NIP-26 Event Delegation | C | ⬜ | v2.1 | 2 | "Create a proposal to implement NIP-26 delegation token creation and verification, enabling temporary or scoped signing authority for specific event kinds" |
| PROTO-005 | NIP-59 Gift Wrap (Sealed Sender) | S | ⬜ | v2.1 | 2 | "Create a proposal to implement NIP-59 gift wrap for anonymous/sealed sender DMs, providing sender anonymity with ephemeral keys and gift-wrapped events" |
| PROTO-006 | NIP-51 Lists (Bookmarks, Pinned, Mute) | S | ⬜ | v2.1 | 2 | "Create a proposal to implement NIP-51 list management for bookmarks, pinned notes, muted users, and custom categorized lists with local caching" |
| PROTO-007 | NIP-57 Lightning Zaps | S | ⬜ | v2.0 | 2 | "Create a proposal to implement NIP-57 zap request signing with amount validation, recipient verification, and zap receipt tracking in activity log" |
| PROTO-008 | NIP-42 Client Authentication | S | ⬜ | v2.0 | 2 | "Create a proposal to implement NIP-42 relay authentication allowing clients to prove identity to relays for access control or enhanced features" |
| PROTO-009 | NIP-65 Relay List Metadata | S | 🔄 | v2.0 | 2 | "Create a proposal to implement NIP-65 relay list metadata (kind 10002) for managing read/write relay preferences with UI for relay management" |
| PROTO-010 | NIP-98 HTTP Auth | C | ⬜ | v2.2 | 2 | "Create a proposal to implement NIP-98 HTTP authentication allowing websites to request signed authentication tokens for API access" |
| PROTO-011 | NIP-05 Verification | S | ⬜ | v2.0 | 2 | "Create a proposal to display NIP-05 verification status (DNS-based identity) in profile views with caching and periodic re-verification" |
| PROTO-012 | NIP-13 Proof of Work | C | ⬜ | v2.2 | 2 | "Create a proposal to implement optional NIP-13 proof-of-work mining for events with configurable difficulty, helping with spam prevention" |
| PROTO-013 | NIP-25 Reactions | M | ✅ | v1.0 | 2 | "Already supported via generic event signing" |
| PROTO-014 | NIP-28 Public Chat | C | ⬜ | v2.2 | 2 | "Create a proposal to add public chat channel support (kind 40-42) with channel metadata and message signing" |
| PROTO-015 | NIP-72 Moderated Communities | C | ⬜ | v2.2 | 2 | "Create a proposal to implement NIP-72 community support for creating and managing moderated communities with approval workflows" |
| PROTO-016 | NIP-90 Data Vending Machines | C | ⬜ | v2.3 | 2 | "Create a proposal to support NIP-90 DVM job requests and responses, enabling AI/service integrations" |

---

## Epic 3: Enhanced User Experience
**Strategic Importance:** HIGH  
**Target Version:** v2.0-v2.1  
**Owner:** UX Team

### Rationale
A world-class signing extension must be both powerful and delightful to use. Reducing friction, improving clarity, and providing intelligent defaults will drive adoption and satisfaction.

### Requirements

| ID | Title | Priority | Status | Version | Epic | OpenSpec Proposal Prompt |
|----|-------|----------|--------|---------|------|--------------------------|
| UX-001 | Persistent Activity Log with Real Data | M | 🔄 | v2.0 | 3 | "Create a proposal to implement persistent activity logging that records all sign approvals/denials with timestamp, origin, event kind, event content preview, and result, storing configurable last N entries (default 500) and displaying them in ActivityView with filters by origin, kind, date range, and result" |
| UX-002 | Profile Metadata Fetching & Display | S | ✅ | v2.0 | 3 | "Create a proposal to implement profile metadata fetching (NIP-01 kind:0) from configured relays, caching results locally with TTL, and displaying name/picture/about/website in ProfileView with ability to publish profile updates" |
| UX-003 | Smart Event Preview in Approvals | M | 🔄 | v2.0 | 3 | "Create a proposal to enhance approval prompts with intelligent event content parsing and preview, showing human-readable summaries for notes, reactions, zaps, DMs, and other common event types" |
| UX-004 | One-Click Common Actions | S | 🔄 | v2.0 | 3 | "Create a proposal to add quick action buttons in HomeView for common tasks: copy pubkey, view on nostr.band, create new key, export keys, view activity, with keyboard shortcuts" |
| UX-005 | Contextual Help & Tooltips | S | ⬜ | v2.0 | 3 | "Create a proposal to add contextual help tooltips throughout the UI explaining trust levels, event kinds, permissions, and security settings with learn more links to documentation" |
| UX-006 | Search & Filter Activity | S | 🔄 | v2.0 | 3 | "Create a proposal to add comprehensive search and filtering in ActivityView supporting full-text search of event content, filtering by multiple criteria, and saved filter presets" |
| UX-007 | Theme Customization | S | 🔄 | v2.0 | 3 | "Create a proposal to enhance theme system with multiple built-in themes (dark, light, purple, high-contrast), custom color picker, and font size adjustment for accessibility" |
| UX-008 | Onboarding Tutorial & Tips | S | 🔄 | v2.0 | 3 | "Create a proposal to add interactive onboarding tutorial with progressive disclosure, explaining key concepts (trust levels, signing, permissions) with dismissible tips throughout the UI" |
| UX-009 | Bulk Permission Management | S | ⬜ | v2.1 | 3 | "Create a proposal to add bulk operations in SettingsView for managing multiple origin permissions: bulk trust level changes, bulk rule application, import/export permission templates" |
| UX-010 | Smart Notifications | S | ⬜ | v2.1 | 3 | "Create a proposal to implement configurable browser notifications for important events: new approval requests, security warnings, failed sign attempts, with Do Not Disturb mode" |
| UX-011 | Accessibility Improvements | M | 🔄 | v2.0 | 3 | "Create a proposal to achieve WCAG 2.1 Level AA compliance with focus indicators, ARIA labels, keyboard navigation for all features, screen reader support, and minimum contrast ratios" |
| UX-012 | Mobile-Optimized UI | S | ⬜ | v2.1 | 3 | "Create a proposal to optimize UI for mobile browsers (Firefox for Android, Kiwi Browser) with responsive layouts, touch-friendly targets, and simplified navigation" |
| UX-013 | Export Activity Reports | S | 🔄 | v2.1 | 3 | "Create a proposal to add activity export functionality generating CSV/JSON reports of signing activity for personal auditing or tax reporting" |
| UX-014 | Multiple Language Support (i18n) | C | ⬜ | v2.2 | 3 | "Create a proposal to implement internationalization with initial support for English, Spanish, Portuguese, Japanese, Chinese, with community-contributed translations" |
| UX-015 | Dark/Light Mode Auto-Switch | S | ✅ | v2.0 | 3 | "Create a proposal to implement automatic theme switching based on system preferences, time of day, or custom schedule" |
| UX-016 | Compact View Mode | C | ⬜ | v2.1 | 3 | "Create a proposal to add compact view mode for power users with denser layouts, reduced padding, and more information per screen" |
| UX-017 | Drag-and-Drop Key Import | S | ⬜ | v2.1 | 3 | "Create a proposal to support drag-and-drop import of key files (encrypted JSON, nsec files) with validation and secure handling" |

---

## Epic 4: Developer Experience & Integration
**Strategic Importance:** HIGH  
**Target Version:** v2.0-v2.1  
**Owner:** DevRel Team

### Rationale
Developers are our key partners in ecosystem growth. Providing excellent APIs, debugging tools, and documentation will accelerate adoption and integration quality.

### Requirements

| ID | Title | Priority | Status | Version | Epic | OpenSpec Proposal Prompt |
|----|-------|----------|--------|---------|------|--------------------------|
| DEV-001 | Standardized Error Codes | M | ✅ | v2.0 | 4 | "Create a proposal to standardize all RPC error responses with uniform error codes (LOCKED, NEEDS_APPROVAL, DENIED, INVALID_EVENT, RATE_LIMITED, NETWORK_ERROR), error messages, and optional debug context following JSON-RPC 2.0 error object format" |
| DEV-002 | TypeScript Type Definitions Export | M | ⬜ | v2.0 | 4 | "Create a proposal to publish @types/ostrilo npm package containing TypeScript definitions for window.nostr API, making it easy for dApps to get proper type safety and autocomplete" |
| DEV-003 | Developer Console with Debugging | S | ⬜ | v2.1 | 4 | "Create a proposal to add developer console accessible from extension with real-time logs of RPC calls, policy evaluations, signing operations, and message passing for debugging integrations" |
| DEV-004 | Test Mode with Mock Signatures | S | ⬜ | v2.1 | 4 | "Create a proposal to add developer test mode that allows mock signing without real keys, deterministic signatures for testing, and simulation of various scenarios (locked, denied, etc.)" |
| DEV-005 | Integration Testing Helpers | S | ⬜ | v2.1 | 4 | "Create a proposal to provide integration testing utilities for dApp developers: mock Ostrilo provider, test fixtures, and example test suites demonstrating proper integration patterns" |
| DEV-006 | API Documentation Website | M | 🔄 | v2.0 | 4 | "Create a proposal to build comprehensive API documentation website with interactive examples, code snippets in multiple frameworks, migration guides, and best practices" |
| DEV-007 | SDK for Common Frameworks | S | ⬜ | v2.1 | 4 | "Create a proposal to develop official SDKs/adapters for popular frameworks (React, Vue, Svelte, Angular) providing hooks, components, and utilities for seamless Ostrilo integration" |
| DEV-008 | Webhook Support for Events | C | ⬜ | v2.2 | 4 | "Create a proposal to implement webhook notifications for local development allowing dApps to receive events when signing occurs, permissions change, or user locks/unlocks" |
| DEV-009 | Browser DevTools Integration | C | ⬜ | v2.2 | 4 | "Create a proposal to create custom browser DevTools panel for inspecting Ostrilo state, viewing policies, testing signing, and debugging permission issues" |
| DEV-010 | API Versioning & Deprecation Policy | M | ⬜ | v2.0 | 4 | "Create a proposal to implement clear API versioning with semantic version negotiation, deprecation warnings, and migration path documentation ensuring backward compatibility" |
| DEV-011 | Performance Profiling Tools | C | ⬜ | v2.2 | 4 | "Create a proposal to add performance profiling showing signing latency, policy evaluation time, and RPC message overhead to help developers optimize integrations" |
| DEV-012 | Batch Signing API | S | ⬜ | v2.1 | 4 | "Create a proposal to implement batch signing API allowing dApps to submit multiple events for approval in a single flow, reducing prompt fatigue for bulk operations" |
| DEV-013 | Capability Detection API | M | ⬜ | v2.0 | 4 | "Create a proposal to add capability detection API (window.nostr.capabilities) returning list of supported NIPs, features, and API versions for progressive enhancement" |

---

## Epic 5: Performance & Reliability
**Strategic Importance:** HIGH  
**Target Version:** v2.0  
**Owner:** Performance Team

### Rationale
Performance and reliability are non-negotiable for a signing extension. Slow or unreliable operations frustrate users and harm the Nostr ecosystem's reputation.

### Requirements

| ID | Title | Priority | Status | Version | Epic | OpenSpec Proposal Prompt |
|----|-------|----------|--------|---------|------|--------------------------|
| PERF-001 | Sub-5ms Signing Operations | S | ⬜ | v2.0 | 5 | "Create a proposal to optimize signing performance targeting ≤5ms P50 latency and ≤10ms P99 latency with benchmarks in CI measuring schnorr signature generation and event serialization" |
| PERF-002 | Lazy Loading & Code Splitting | S | ⬜ | v2.0 | 5 | "Create a proposal to implement code splitting and lazy loading for UI routes reducing initial bundle size, loading components on-demand, and improving extension startup time" |
| PERF-003 | Background Script Optimization | M | ⬜ | v2.0 | 5 | "Create a proposal to optimize background script bundle size to ≤150KB gzipped through tree-shaking, dependency optimization, and removing unused code, with CI size checks" |
| PERF-004 | Memory Leak Detection | M | ⬜ | v2.0 | 5 | "Create a proposal to add automated memory leak detection in CI/CD using heap snapshots, monitoring for leaked event listeners, retained closures, and unbounded caches" |
| PERF-005 | Efficient Storage Patterns | S | 🔄 | v2.0 | 5 | "Create a proposal to optimize storage access patterns with batching, debouncing, and strategic caching reducing chrome.storage API calls and improving responsiveness" |
| PERF-006 | Connection Pooling for Relays | S | 🔄 | v2.1 | 5 | "Create a proposal to implement relay connection pooling and reuse for profile fetching and list operations, maintaining persistent WebSocket connections with automatic reconnection" |
| PERF-007 | Signature Caching | S | ⬜ | v2.1 | 5 | "Create a proposal to implement intelligent signature caching for idempotent events (kind 0 profile updates) with cache invalidation and TTL to avoid redundant signing" |
| PERF-008 | Service Worker Lifecycle Management | M | 🔄 | v2.0 | 5 | "Create a proposal to properly manage service worker lifecycle in Chrome MV3 with persistence strategies for critical state, ensuring vault remains unlocked during service worker restarts" |
| PERF-009 | Bundle Analysis Dashboard | S | ⬜ | v2.0 | 5 | "Create a proposal to integrate bundle analysis tools (webpack-bundle-analyzer) in CI generating reports on bundle composition, detecting bloat, and tracking size trends over time" |
| PERF-010 | Startup Time Optimization | M | ⬜ | v2.0 | 5 | "Create a proposal to optimize extension startup time measuring time-to-interactive, deferring non-critical initialization, and reducing synchronous storage reads" |
| PERF-011 | Policy Evaluation Caching | S | ⬜ | v2.0 | 5 | "Create a proposal to implement policy evaluation result caching with cache warming and invalidation on policy changes, reducing repeated policy computations" |

---

## Epic 6: Multi-Device & Sync
**Strategic Importance:** MEDIUM  
**Target Version:** v2.1-v2.2  
**Owner:** Platform Team

### Rationale
Users increasingly work across multiple devices. Seamless sync of settings, trusted origins, and (optionally) encrypted keys dramatically improves the multi-device experience.

### Requirements

| ID | Title | Priority | Status | Version | Epic | OpenSpec Proposal Prompt |
|----|-------|----------|--------|---------|------|--------------------------|
| SYNC-001 | Settings & Policy Sync | S | 🔄 | v2.1 | 6 | "Create a proposal to implement cross-device settings sync using browser sync storage (chrome.storage.sync) for theme, auto-lock settings, and origin policies (excluding private keys)" |
| SYNC-002 | Encrypted Key Backup to Cloud | C | ⬜ | v2.2 | 6 | "Create a proposal to add optional encrypted key backup to user-controlled cloud storage (Nostr events, IPFS, user's server) with strong encryption and master password" |
| SYNC-003 | QR Code Key Transfer | S | ⬜ | v2.1 | 6 | "Create a proposal to implement secure QR code-based key transfer between devices using ephemeral encryption, time-limited tokens, and visual confirmation" |
| SYNC-004 | Key Restoration from Seed Phrase | C | ⬜ | v2.2 | 6 | "Create a proposal to add optional BIP39 seed phrase support for key generation and restoration enabling familiar backup/restore flow for crypto users" |
| SYNC-005 | Profile Sync via Nostr Events | C | ⬜ | v2.2 | 6 | "Create a proposal to store extension settings as encrypted Nostr events (private relay or user's relays) enabling true decentralized sync across devices without browser vendor dependency" |
| SYNC-006 | Conflict Resolution Strategy | S | 🔄 | v2.1 | 6 | "Create a proposal to implement conflict resolution for synced settings using last-write-wins with timestamps, merge strategies for policies, and user notification for conflicts" |

---

## Epic 7: Privacy-Preserving Features
**Strategic Importance:** MEDIUM  
**Target Version:** v2.1-v2.2  
**Owner:** Privacy Team

### Rationale
Privacy is a core Nostr value. Advanced privacy features differentiate Ostrilo and enable use cases where anonymity and metadata protection are critical.

### Requirements

| ID | Title | Priority | Status | Version | Epic | OpenSpec Proposal Prompt |
|----|-------|----------|--------|---------|------|--------------------------|
| PRIV-001 | Anonymous Event Signing | C | ⬜ | v2.2 | 7 | "Create a proposal to implement anonymous event signing with ephemeral keys (single-use, not linked to main identity) for posting without identity attribution" |
| PRIV-002 | Tor/I2P Relay Support | C | ⬜ | v2.3 | 7 | "Create a proposal to add support for connecting to relays via Tor (.onion addresses) or I2P for enhanced privacy and censorship resistance" |
| PRIV-003 | Metadata Minimization Mode | S | ⬜ | v2.1 | 7 | "Create a proposal to add privacy mode that strips optional metadata from events (client tags, geotags) and randomizes timing of submissions to reduce fingerprinting" |
| PRIV-004 | Origin Cloaking for Sensitive Sites | C | ⬜ | v2.2 | 7 | "Create a proposal to allow users to mask origin in signed events (generic client tag) when using privacy-sensitive applications to prevent usage pattern analysis" |
| PRIV-005 | Local-Only Mode | S | ⬜ | v2.1 | 7 | "Create a proposal to add airplane/offline mode disabling all network operations (relay connections, profile fetching) for complete airgapped signing" |
| PRIV-006 | Decoy Traffic Generation | C | ⬜ | v2.3 | 7 | "Create a proposal to optionally generate decoy relay traffic (cover traffic) to obscure real usage patterns from network observers" |

---

## Epic 8: Advanced Key Management
**Strategic Importance:** MEDIUM  
**Target Version:** v2.1-v2.2  
**Owner:** Security Team

### Rationale
Sophisticated users need advanced key management features like hierarchical keys, rotation policies, and emergency access to maintain security hygiene and prepare for key compromise.

### Requirements

| ID | Title | Priority | Status | Version | Epic | OpenSpec Proposal Prompt |
|----|-------|----------|--------|---------|------|--------------------------|
| KEYMGMT-001 | Key Rotation & Migration | S | ⬜ | v2.1 | 8 | "Create a proposal to implement key rotation workflow allowing users to migrate followers and data to new key, publishing rotation event (proposed NIP), and deprecating old key" |
| KEYMGMT-002 | Hierarchical Deterministic Keys | C | ⬜ | v2.2 | 8 | "Create a proposal to support BIP32-style HD key derivation from master seed, generating multiple Nostr identities from single backup" |
| KEYMGMT-003 | Sub-Keys for Specific Purposes | C | ⬜ | v2.2 | 8 | "Create a proposal to implement sub-key system where master key can delegate limited signing authority to sub-keys (e.g., posting-only key, reaction-only key)" |
| KEYMGMT-004 | Key Compromise & Revocation | S | ⬜ | v2.1 | 8 | "Create a proposal to add key revocation flow publishing revocation event, notifying followers, providing guidance for key compromise scenarios" |
| KEYMGMT-005 | Emergency Access & Dead Man's Switch | C | ⬜ | v2.3 | 8 | "Create a proposal to implement emergency access system allowing trusted contact to recover account after specified inactivity period (Shamir's Secret Sharing)" |
| KEYMGMT-006 | Key Strength Indicator | S | ⬜ | v2.1 | 8 | "Create a proposal to display key security strength in UI showing encryption algorithm, key length, last rotation date, and recommendations for upgrades" |
| KEYMGMT-007 | Master Password Change | M | ⬜ | v2.0 | 8 | "Create a proposal to implement secure master password change requiring current password, re-encrypting all stored keys with new password-derived key" |
| KEYMGMT-008 | Import/Export with Standard Formats | S | 🔄 | v2.1 | 8 | "Create a proposal to support standard import/export formats: nsec, hex, encrypted JSON, NIP-XX key export format for interoperability with other clients" |

---

## Epic 9: Social & Discovery Features
**Strategic Importance:** MEDIUM  
**Target Version:** v2.2+  
**Owner:** Product Team

### Rationale
While primarily a signing extension, integrating lightweight social features enhances utility and helps users discover and manage their Nostr identity without leaving the extension.

### Requirements

| ID | Title | Priority | Status | Version | Epic | OpenSpec Proposal Prompt |
|----|-------|----------|--------|---------|------|--------------------------|
| SOCIAL-001 | Contact List Management | C | ⬜ | v2.2 | 9 | "Create a proposal to display and manage contact list (kind 3) within extension, showing following count, recent follows, with ability to follow/unfollow" |
| SOCIAL-002 | Relay Recommendations | C | ⬜ | v2.2 | 9 | "Create a proposal to provide intelligent relay recommendations based on user's network, geographic location, relay performance metrics, and community ratings" |
| SOCIAL-003 | Identity Verification Status | S | ⬜ | v2.1 | 9 | "Create a proposal to display comprehensive identity verification status showing NIP-05 verification, domain ownership, web of trust score, and badges" |
| SOCIAL-004 | Web of Trust Integration | C | ⬜ | v2.2 | 9 | "Create a proposal to integrate web of trust calculations showing trust scores for origins based on who vouches for them, warning when signing for low-trust entities" |
| SOCIAL-005 | Notification Preferences | C | ⬜ | v2.2 | 9 | "Create a proposal to add notification filtering allowing users to configure which events trigger browser notifications, with mute/unmute per origin" |
| SOCIAL-006 | Profile QR Code Display | S | 🔄 | v2.1 | 9 | "Create a proposal to generate and display profile QR codes encoding pubkey and recommended relays for easy sharing at events or with new connections" |
| SOCIAL-007 | Recent Activity Feed | C | ⬜ | v2.2 | 9 | "Create a proposal to add lightweight activity feed showing recent posts, reactions, and replies across configured relays, accessible from HomeView" |

---

## Epic 10: Monitoring & Analytics
**Strategic Importance:** LOW  
**Target Version:** v2.2+  
**Owner:** Operations Team

### Rationale
Understanding extension health, usage patterns, and error rates enables data-driven improvements while respecting user privacy. All analytics must be privacy-preserving and opt-in.

### Requirements

| ID | Title | Priority | Status | Version | Epic | OpenSpec Proposal Prompt |
|----|-------|----------|--------|---------|------|--------------------------|
| MON-001 | Privacy-Preserving Telemetry | C | ⬜ | v2.2 | 10 | "Create a proposal to implement opt-in privacy-preserving telemetry collecting aggregated usage metrics (feature usage, performance) without PII, using differential privacy" |
| MON-002 | Error Reporting & Crash Analytics | S | ⬜ | v2.1 | 10 | "Create a proposal to add opt-in error reporting sending anonymized stack traces and error context to Sentry or similar service for debugging production issues" |
| MON-003 | Performance Monitoring | C | ⬜ | v2.2 | 10 | "Create a proposal to implement performance monitoring tracking real-user metrics (signing latency, UI responsiveness) with percentile aggregations and alerting" |
| MON-004 | Health Check Dashboard | C | ⬜ | v2.3 | 10 | "Create a proposal to create public health dashboard showing extension uptime, relay connectivity status, known issues, and incident history" |
| MON-005 | A/B Testing Framework | C | ⬜ | v2.3 | 10 | "Create a proposal to implement privacy-preserving A/B testing framework enabling feature experiments and UX optimizations with statistical analysis" |

---

## Implementation Roadmap

For multi-session execution workflow and build order, use `docs/session-workflow.md`.

Treat this PRD as the progress ledger: every completed OpenSpec slice must update affected requirement statuses, the Current Implementation Snapshot, and roadmap gap lists before archival. Mark a requirement `✅` only when the full row wording is satisfied and verified; use `🔄` for narrower shipped slices.

### Status Legend

- ✅ Implemented in the current repository
- 🔄 Implemented partially or narrower than the PRD wording
- ⬜ Planned, deferred, or not started
- ❌ Removed or explicitly out of scope

### Implemented Foundation

The current codebase has delivered a strong signer foundation rather than the full original v2.0 scope.

- ✅ **Core signer:** NIP-07 `getPublicKey` and `signEvent`, background-only signing, event validation, policy evaluation, and standard RPC error responses.
- ✅ **Approval workflow:** managed approval window, pending queue, event de-duplication, full event detail view, batch approval actions, timeouts, and Activity-page re-entry.
- ✅ **Identity management:** multiple encrypted keys, active key selector, create/import/add-key flows, rename/delete/set-active actions, profile-aware key display, and last-key deletion guard.
- ✅ **Profile and relays:** NIP-01 kind:0 profile fetch/cache/display/edit/publish, relay list settings, multi-relay query/publish handling, and local profile cache.
- ✅ **Settings surfaces:** popup Basic Settings, full Options Page, tab navigation, URL hash deep links, local settings sync between popup/options, relay settings, policy settings, and activity-log controls.
- ✅ **Theme:** light/dark/system theme selection with live system-preference updates across extension UI surfaces.
- ✅ **Testing and tooling:** Vitest coverage across domain/application/infrastructure/UI, Playwright extension E2E tests, smoke screenshots, WXT Chrome/Firefox build targets, and React Doctor CI.

### Foundation Gaps

These items should be treated as the next hardening priority before claiming the original v2.0 foundation complete.

- 🔄 **Security hardening:** finish secure UI input isolation, complete zeroization coverage for sensitive UI paths, add wipe/export recovery flows, and confirm auto-lock/session behavior at runtime.
- ⬜ **Security automation:** add CSP/build-output validation, secrets scanning, dependency/security audit automation, bundle-size checks, and memory-leak detection.
- 🔄 **Approval intelligence:** keep the current detail-first approval UI, then add NIP-specific previews and risk analysis for zaps, DMs, relay changes, and high-risk event kinds.
- 🔄 **Activity experience:** extend current origin/kind filters with full-text search, result filtering, date ranges, and CSV export.
- 🔄 **Accessibility:** broaden existing keyboard/ARIA coverage into a repo-wide WCAG 2.1 AA audit and remediation pass.
- ⬜ **Protocol depth:** implement explicit NIP-04, NIP-44, NIP-42, NIP-57 validation, NIP-65 relay-list publishing, and NIP-05 DNS verification instead of relying on generic event signing.
- ⬜ **Developer surface:** publish formal TypeScript definitions, capability detection, API versioning/deprecation policy, and a real documentation site.

### Advanced Roadmap

The original v2.1+ epics remain mostly future work.

- 🔄 **Sync:** settings are stored through browser sync storage and local contexts update live, but cross-device conflict handling and NIP-78/decentralized sync are deferred.
- 🔄 **Relay performance:** relay adapters maintain WebSocket connections and reconnect, but full connection-pool policy, metrics, and lifecycle hardening remain open.
- 🔄 **Import/export:** nsec/hex import and export/reveal APIs exist, but encrypted JSON, standard export packages, and polished export UI remain open.
- 🔄 **Profile QR:** public-key QR display exists in shared pubkey UI, but a profile-sharing QR flow with recommended relays is not complete.
- ⬜ **Advanced security:** HSM/WebAuthn key storage, biometric unlock, MFA, sandboxed crypto workers, phishing blocklists, and tamper-evident audit logs remain future work.
- ⬜ **Advanced protocol/social/privacy/monitoring:** NIP-46, NIP-26, NIP-59, NIP-51, NIP-98, NIP-13, social discovery, Tor/I2P, privacy modes, telemetry, crash analytics, and public health dashboards are not implemented.

#### Won't Have (Out of Scope)
- Built-in wallet functionality (use external Lightning wallets)
- Full Nostr client (focus on signing, not social features)
- Relay hosting or infrastructure
- Centralized user authentication
- Blockchain integration beyond Nostr protocol
- AI content generation (moderation detection OK)
- Video/audio media hosting
- Marketplace or commerce features

---

## Success Metrics

### Adoption Metrics
- **Monthly Active Users (MAU):** 10K by v2.0, 25K by v2.1, 50K by v2.2
- **Daily Active Users (DAU):** 3K by v2.0, 8K by v2.1, 15K by v2.2
- **User Retention:** 60% 30-day retention, 40% 90-day retention
- **Integration Count:** 25 dApps by v2.0, 50 by v2.1, 100 by v2.2

### Quality Metrics
- **Security Audit Score:** 95%+ pass rate on external audit
- **Test Coverage:** 85%+ line coverage, 95%+ critical path coverage
- **Bug Density:** <0.5 critical bugs per 1K lines of code
- **Performance:** 95% of signs < 5ms, 99% < 10ms
- **Accessibility:** WCAG 2.1 AA compliance, Lighthouse a11y > 90

### User Satisfaction
- **Net Promoter Score (NPS):** >50 by v2.0, >60 by v2.2
- **Support Ticket Volume:** <1 ticket per 100 MAU
- **Average Rating:** 4.5+ stars on browser extension stores
- **Feature Request Implementation:** 30% of top-voted requests addressed per quarter

### Developer Experience
- **API Uptime:** 99.9% availability of signing services
- **Integration Time:** <2 hours for basic integration with docs
- **Developer Satisfaction:** >80% satisfaction in quarterly survey
- **Documentation Coverage:** 100% of public APIs documented with examples

---

## OpenSpec Proposal Prompts Summary

All requirements include specific OpenSpec prompts in their respective tables above. When implementing any feature:

1. Use the exact prompt provided in the "OpenSpec Proposal Prompt" column
2. Follow the OpenSpec workflow:
   - Stage 1: Create proposal with `proposal.md`, `tasks.md`, and spec deltas
   - Stage 2: Implement tasks sequentially after approval
   - Stage 3: Update this PRD, then archive after deployment
3. Ensure all proposals include:
   - Comprehensive requirements with scenarios
   - Security considerations
   - Performance implications
   - Testing strategy
   - Migration plan (if breaking changes)
   - Documentation updates

---

## Risk Assessment & Mitigation

### High Risk Items
| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Security vulnerability discovered | Critical | Medium | Regular security audits, bug bounty program, rapid response plan |
| Browser API changes breaking extension | High | Medium | Track browser release channels, maintain compatibility layer |
| Key loss during migration | Critical | Low | Extensive backup warnings, dry-run migration tools, recovery procedures |
| Performance regression in updates | Medium | Medium | Mandatory performance benchmarks in CI, canary releases |

### Medium Risk Items
| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Protocol changes (NIPs updated) | Medium | High | Active NIP monitoring, flexible implementation, version negotiation |
| Competitor features ahead | Medium | Medium | Community feedback loop, rapid iteration, unique differentiators |
| User confusion with advanced features | Medium | Medium | Progressive disclosure, excellent documentation, onboarding |

---

## Appendix A: Competitor Analysis

### Current Nostr Signers
- **nos2x:** Simple, minimal, but lacks advanced features and mobile support
- **Alby:** Bitcoin/Lightning focused, good UX but less Nostr-native
- **Flamingo:** Basic NIP-07, limited protocol support
- **Horse:** Experimental, not production-ready

### Ostrilo Differentiators
1. **Local-first signer foundation:** NIP-07 provider, background-only signing, encrypted key storage, and no telemetry.
2. **Approval clarity:** Managed queue, full event details, batch controls, and persistent activity history.
3. **Multi-identity workflow:** Multiple keys, active-key switching, profile-aware display, and guarded key deletion.
4. **Operator-grade settings:** Full Options Page for keys, security, permissions, relays, activity retention, and advanced policy controls.
5. **Developer reliability:** Structured RPC error responses, typed internal RPC contracts, Playwright extension E2E tests, and React Doctor CI.
6. **Future differentiators:** HSM/WebAuthn, biometrics, broader NIP support, mobile optimization, and cross-device sync remain roadmap items, not current claims.

---

## Appendix B: Glossary

- **NIP:** Nostr Implementation Possibilities - protocol specifications
- **HSM:** Hardware Security Module - secure key storage device
- **KDF:** Key Derivation Function - derives encryption keys from passwords
- **ECDH:** Elliptic Curve Diffie-Hellman - key agreement protocol
- **Schnorr:** Signature algorithm used in Nostr
- **NIP-07:** Window.nostr browser provider specification
- **MV3:** Manifest Version 3 - Chrome extension platform
- **WCAG:** Web Content Accessibility Guidelines
- **P50/P99:** 50th/99th percentile performance metrics

---

## Appendix C: References

1. Nostr Protocol Specification: https://github.com/nostr-protocol/nips
2. Web Extension APIs: https://developer.chrome.com/docs/extensions/
3. WCAG 2.1 Guidelines: https://www.w3.org/WAI/WCAG21/quickref/
4. OWASP Browser Security: https://owasp.org/www-project-web-security-testing-guide/
5. Noble Cryptography: https://github.com/paulmillr/noble-curves
6. OpenSpec Project Context: openspec/project.md

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 2.0 | 2025-12-09 | Copilot Agent | Initial v2 PRD with comprehensive requirements, RTM, MoSCoW, Epics, and roadmap |
| 2.1 | 2026-06-12 | Codex | Reconciled roadmap and requirement statuses against the current implementation; added multi-session progress workflow |

---

**End of Document**

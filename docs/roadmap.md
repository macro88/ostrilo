# Ostrilo Roadmap

What Ostrilo is working toward, and how far the code has got. For what the current
release ships, the README and `CHANGELOG.md` are the authority.

**Status as of 2026-10-09 (0.9.0).** ✅ means the row's purpose is met and verified in
the code. 🔄 means a real slice ships and something specific is missing. Both say what.

| Symbol | Meaning |
|--------|---------|
| ✅ | Done |
| 🔄 | Partly done |
| ⬜ | Not started |
| ❌ | Out of scope or removed |

Priority is MoSCoW: **M**ust, **S**hould, **C**ould, **W**on't.

## Summary

| Priority | Total | ✅ | 🔄 | ⬜ | ❌ |
|----------|-------|----|----|----|----|
| Must     | 33 | 16 | 8 | 9 | 0 |
| Should   | 54 | 5 | 10 | 38 | 1 |
| Could    | 31 | 0 | 0 | 31 | 0 |
| Won't    | 1 | 0 | 0 | 0 | 1 |
| **Total**| **119** | **21** | **18** | **78** | **2** |

## What ships today

- **Signer:** NIP-07 `getPublicKey` and `signEvent`, HTTPS-only, with signing and key
  operations confined to the background.
- **Vault:** Argon2id-encrypted keys, multiple identities, import, encrypted backup at
  onboarding, and master-password change.
- **Approvals:** a managed approval window and queue, three trust levels, protected kinds
  that always prompt, remembered per-site rules, identity-disclosure consent.
- **Session lock:** fail-closed lock with a sliding 1-60 minute auto-lock and a countdown.
- **Profiles and relays:** kind:0 fetch, edit and publish; relay settings; untrusted relay
  data validated at the boundary.
- **Activity log:** persistent, filterable, exportable (see Known issues).
- **Settings:** device-local, in an options page with light, dark and system themes.
- **Quality gates:** typecheck, lint, coverage thresholds, both builds with manifest and
  bundle assertions, dependency audit, secret scan, Playwright journeys, aislop.
  See `docs/ci-verification.md`.

## Known issues

Defects in shipped code. Each belongs to the row named.

| Issue | Row |
|-------|-----|
| Activity export fails when retention is above 100 entries: the export asks for up to 500 and the RPC caps `limit` at 100. | UX-013 |
| `content.ts` sends pages three non-canonical error strings ("Invalid event parameter", "Unknown method", a raw exception message). `docs/rpc-error-codes.md` shows an old response shape. | DEV-001 |
| Requests that policy auto-signs never enter the queue, so no rate limit applies to them. | SEC-006 |
| Any `appSettings` write, a theme change included, drops every relay socket. | PERF-006 |
| The approval queue and rate-limit counters are lost when the service worker is evicted. | PERF-008 |
| Activity log: the origin filter lists only origins on the loaded page; the kind filter can't reach kinds 5, 22242 and 27235; denials don't record why; the preview doesn't escape hidden characters. | UX-001 |

## Decisions needed

These rows conflict with a shipped decision or with what a browser extension can do.

- **SEC-014** asks for cryptographic erasure on uninstall. Extensions can't run code at uninstall; the browser deletes their storage. An in-app "erase all data" is the implementable form. Otherwise ❌.
- **SEC-018** asks to detect deterministic-signature requests. Signing always uses fresh randomness and a page can't request otherwise, so there is nothing to detect.
- **MON-001 to MON-003** conflict with `PRIVACY.md`, which promises no analytics, telemetry or crash reports.
- **DEV-012** (batch signing) conflicts with the deliberate removal of bulk approve.

---

## 1. Security and Privacy

| ID | Title | Pri | Status | Notes |
|----|-------|-----|--------|-------|
| SEC-001 | Memory zeroization | M | ✅ | Key bytes and derived keys are wiped in `finally` blocks, verified by reading the buffers back. Strings and `CryptoKey`s can't be wiped from JavaScript. Passwords in React state are SEC-003. |
| SEC-002 | Hardware key storage (WebAuthn) | S | ⬜ | Keys on a YubiKey, Ledger or similar. |
| SEC-003 | Secure UI isolation | M | 🔄 | The revealed key lives in a ref, passwords clear on every exit, secret inputs opt out of autofill. Left: dedicated `keyflow.html` and `welcome.html` documents, so onboarding and unlock stop sharing a realm with the main app. |
| SEC-004 | CSP enforcement in CI | M | ✅ | Manifest CSP and bundle hygiene (no source maps, no `console`) asserted against fresh Chrome and Firefox builds. |
| SEC-005 | Secret scanning in CI | M | ✅ | gitleaks on every PR and push. |
| SEC-006 | Rate limiting | S | 🔄 | Approval queue: 10 per minute and 5 pending per origin, 20 globally. `getPublicKey`: 6 per minute. Left: meter auto-signed requests, make limits configurable, persist counters. |
| SEC-007 | Phishing blocklist | M | ⬜ | Warn before signing on known-bad domains. |
| SEC-008 | Risk analysis in approvals | M | 🔄 | Display integrity ships: full origin, non-HTTPS chip, byte lengths, hidden characters escaped, protected-kind notice. Left: zap amounts, DM content, relay-list changes, a risk score. |
| SEC-009 | Biometric unlock | S | ⬜ | WebAuthn PRF. Proposal open at `openspec/changes/add-biometric-unlock`. |
| SEC-010 | Multi-factor authentication | S | ⬜ | For key export, settings changes and large zaps. |
| SEC-011 | Backup and recovery | M | 🔄 | Encrypted backup file (Argon2id + AES-GCM, separate passphrase) at first-key onboarding, restored on import. Left: back up keys added later from Settings behind re-auth; optional remote target. |
| SEC-012 | Gradual session lock | S | 🔄 | Flat fail-closed lock with a sliding 1-60 minute deadline, presence-gated postponement and a countdown. Left: an intermediate tier that stops auto-signing before asking for the password. |
| SEC-013 | Tamper-evident audit log | S | ⬜ | The activity log is user-facing, with no hash chain and no lock, unlock or settings events. |
| SEC-014 | Wipe on uninstall | M | ⬜ | See Decisions needed. |
| SEC-015 | Argon2id key derivation | M | ✅ | Tunable parameters; KDF costs bounded above and below on stored and imported data. |
| SEC-016 | Sandboxed crypto | S | ⬜ | Crypto in a worker or separate context. |
| SEC-017 | Supply-chain verification | M | 🔄 | Frozen lockfile, release-age and no-downgrade policy, audit blocking on high and critical, SHA-pinned actions, Renovate. Left: reproducible-build check and published digests. |
| SEC-018 | Deterministic-signature detection | S | ⬜ | See Decisions needed. |
| SEC-019 | RPC privilege separation | M | ✅ | Page-reachable and UI-only namespaces, requests bound to the browser-attested sender origin, no payload logging, no passwordless key export. |
| SEC-020 | Relay input validation | M | ✅ | Frames size-bounded and schema-checked; event ID and signature verified; `wss://` only; bounded reconnects. |
| SEC-021 | Remote media and egress policy | M | ✅ | `https:` allowlist; extension pages never load relay-chosen images. |
| SEC-022 | Consent scope and trust allowlists | M | ✅ | Trust levels are allowlists, not denylists. Kinds 1, 5, 9734, 22242 and 27235 always prompt. |
| SEC-023 | Bounded session grants | M | ✅ | Every session grant has an absolute expiry. |
| SEC-024 | Identity-disclosure consent | M | ✅ | `getPublicKey` needs per-origin consent that is remembered, revocable and logged. Residual: a third-party script inside a consented page inherits the grant, and the rate limiter resets on worker eviction. |
| SEC-025 | Contact-list replacement guard | S | ⬜ | Confirm before a kind 3 wipes most of the user's follows. |
| SEC-026 | Per-key consent scope | S | ⬜ | Today a site allowed for key A also gets key B's public key after a switch. |
| SEC-027 | Encrypted activity log | S | ⬜ | Entries keep 100 characters of signed content in plaintext. |

## 2. Protocol Support

| ID | Title | Pri | Status | Notes |
|----|-------|-----|--------|-------|
| PROTO-001 | NIP-04 DMs | W | ❌ | Deliberately not added: unauthenticated AES-CBC. NIP-44 is the path. |
| PROTO-002 | NIP-44 encryption | M | ⬜ | Behind its own per-origin decrypt permission. Build the scheme list crypto-agile so PROTO-017 can add a post-quantum scheme without breaking the API. |
| PROTO-003 | NIP-46 remote signing | C | ⬜ | |
| PROTO-004 | NIP-26 delegation | C | ⬜ | |
| PROTO-005 | NIP-59 gift wrap | S | ⬜ | |
| PROTO-006 | NIP-51 lists | S | ⬜ | |
| PROTO-007 | NIP-57 zaps | S | ⬜ | Kind 9734 always prompts, but nothing validates amounts or recipients. |
| PROTO-008 | NIP-42 relay auth | S | ⬜ | The relay adapter drops `AUTH` challenges. |
| PROTO-009 | NIP-65 relay lists | S | ⬜ | Relays are a flat list with no read/write markers. |
| PROTO-010 | NIP-98 HTTP auth | C | ⬜ | Kind 27235 always prompts, nothing more. |
| PROTO-011 | NIP-05 verification | S | ⬜ | Needs a reviewed widening of the CSP `connect-src`. |
| PROTO-012 | NIP-13 proof of work | C | ⬜ | |
| PROTO-013 | NIP-25 reactions | M | ✅ | Sign through generic event signing. |
| PROTO-014 | NIP-28 public chat | C | ⬜ | |
| PROTO-015 | NIP-72 communities | C | ⬜ | |
| PROTO-016 | NIP-90 DVMs | C | ⬜ | |
| PROTO-017 | Post-quantum hybrid encryption | M | ⬜ | ML-KEM combined with ECDH. Blocked on an interoperable specification. |

## 3. User Experience

| ID | Title | Pri | Status | Notes |
|----|-------|-----|--------|-------|
| UX-001 | Persistent activity log | M | ✅ | Time, origin, kind, 100-character preview, result and key. Retention 10-500 (default 50), origin and kind filters, pagination. Gaps are in Known issues and UX-006. |
| UX-002 | Profile fetch and display | S | ✅ | kind:0 fetch, one-hour cache, name, about and website, edit and publish. The picture shows as a URL and is never loaded, by design (SEC-021). |
| UX-003 | Smart event preview | M | 🔄 | A consequence sentence for 13 kinds, trust and non-HTTPS chips, raw content, tags and JSON. Left: summaries parsed from the event (reply and zap targets, DM recipient, list diffs). |
| UX-004 | One-click common actions | S | 🔄 | Copy public key and QR on Home, links to Keys, Relays, Permissions, Profile and Activity, Add Key in the header. Left: external profile link, export, keyboard shortcuts. |
| UX-005 | Contextual help | S | 🔄 | Inline copy for trust levels, protected kinds and remember scope. Left: tooltips, help for event kinds, learn-more links. |
| UX-006 | Activity search and filters | S | 🔄 | Combinable origin and kind filters. Left: full-text search, date and result filters, saved presets. |
| UX-007 | Theme customization | S | 🔄 | Light, dark and system. Left: more themes (including high-contrast), colour picker, font size. |
| UX-008 | Onboarding tutorial | S | 🔄 | Setup wizard: create or import, password, verified backup. Left: a concepts tutorial and dismissible tips. |
| UX-009 | Bulk permission management | S | ⬜ | |
| UX-010 | Notifications | S | ⬜ | With a Do Not Disturb mode. |
| UX-011 | Accessibility (WCAG 2.1 AA) | M | 🔄 | Keyboard and ARIA coverage on key management and Radix controls, AA token contrast, labelled and keyboard-operable sliders. Left: a repo-wide audit, automated axe checks, remediation. |
| UX-012 | Mobile UI | S | ⬜ | |
| UX-013 | Activity export | S | 🔄 | JSON export from the Activity Log settings. Left: fix the over-100 failure (Known issues), add CSV. |
| UX-014 | Internationalization | C | ⬜ | |
| UX-015 | Automatic dark/light switching | S | ✅ | Follows the system preference live across all surfaces. Time-of-day and scheduled switching were dropped from the row. |
| UX-016 | Compact view | C | ⬜ | |
| UX-017 | Drag-and-drop key import | S | ⬜ | |
| UX-018 | Durable per-site permissions | M | ✅ | Remembered allow and deny rules save per origin and kind, auto-sign unprotected requests, can be revoked in Settings. |

## 4. Developer Experience

| ID | Title | Pri | Status | Notes |
|----|-------|-----|--------|-------|
| DEV-001 | Standard error codes | M | 🔄 | Canonical codes with JSON-RPC numeric mapping inside the extension, plus a test that fails on hard-coded error strings. Left: fix the page boundary and rewrite `docs/rpc-error-codes.md` (Known issues). |
| DEV-002 | TypeScript definitions package | M | ⬜ | `window.nostr` types for dApps. |
| DEV-003 | Developer console | S | ⬜ | |
| DEV-004 | Test mode with mock signatures | S | ⬜ | |
| DEV-005 | Integration testing helpers | S | ⬜ | |
| DEV-006 | API documentation | M | 🔄 | Markdown docs for the NIP-07 API, error codes and local HTTPS development. Left: a docs site, framework snippets, migration guides, and fixing the stale dApp docs. |
| DEV-007 | Framework SDKs | S | ⬜ | |
| DEV-008 | Webhooks for local development | C | ⬜ | |
| DEV-009 | Browser DevTools panel | C | ⬜ | |
| DEV-010 | API versioning and deprecation policy | M | ⬜ | |
| DEV-011 | Performance profiling tools | C | ⬜ | |
| DEV-012 | Batch signing | S | ⬜ | See Decisions needed. |
| DEV-013 | Capability detection API | M | ⬜ | The provider advertises only the methods it implements, but there is no `capabilities` API. |

## 5. Performance and Reliability

| ID | Title | Pri | Status | Notes |
|----|-------|-----|--------|-------|
| PERF-001 | Signing latency target | S | ⬜ | ≤5ms P50 with CI benchmarks. |
| PERF-002 | Code splitting | S | ⬜ | No route loads on demand. |
| PERF-003 | Background bundle size | M | ✅ | 74 KB gzipped against a 150 KB target. A CI size gate is PERF-009. |
| PERF-004 | Memory-leak detection in CI | M | ⬜ | |
| PERF-005 | Efficient storage access | S | 🔄 | A 5-second settings cache in the UI client, debounced docked-panel writes, parallel policy reads. Left: a background settings cache and stop rewriting the whole `appSettings` object on every change. |
| PERF-006 | Relay connection reuse | S | ✅ | One shared `RelayManager`; sockets are reused and reconnect with jittered backoff. A settings write currently drops them (Known issues). |
| PERF-007 | Signature caching | S | ⬜ | |
| PERF-008 | Service-worker lifecycle | M | ✅ | Lock state and grants in `storage.session`, the lock deadline in `chrome.alarms`, the unlock throttle in `storage.local`. Key material is deliberately gone after eviction, so the vault re-locks rather than staying open. The original wording asked for the opposite. |
| PERF-009 | Bundle analysis and size gate | S | ⬜ | Include a gzip gate on `background.js` and size trends. |
| PERF-010 | Startup time | M | ⬜ | |
| PERF-011 | Policy evaluation caching | S | ⬜ | |

## 6. Sync

Settings are device-local on purpose: a grant approved under one browser's password
must not apply to another browser without it. Sync waits for a mechanism that
authenticates its author.

| ID | Title | Pri | Status | Notes |
|----|-------|-----|--------|-------|
| SYNC-001 | Device-local settings | S | ✅ | Everything lives in extension local storage, and a synced value has no effect. A test fails on any use of synced storage. |
| SYNC-002 | Encrypted cloud key backup | C | ⬜ | |
| SYNC-003 | QR key transfer | S | ⬜ | |
| SYNC-004 | Seed-phrase restore (BIP-39) | C | ⬜ | Changes key generation, not backup. |
| SYNC-005 | Settings sync via Nostr events | C | ⬜ | |
| SYNC-006 | Conflict resolution | S | ❌ | Moot: nothing syncs. |

## 7. Privacy Features

| ID | Title | Pri | Status | Notes |
|----|-------|-----|--------|-------|
| PRIV-001 | Anonymous signing with ephemeral keys | C | ⬜ | |
| PRIV-002 | Tor and I2P relays | C | ⬜ | |
| PRIV-003 | Metadata minimization mode | S | ⬜ | |
| PRIV-004 | Origin cloaking | C | ⬜ | |
| PRIV-005 | Local-only mode | S | ⬜ | |
| PRIV-006 | Decoy traffic | C | ⬜ | |

## 8. Key Management

| ID | Title | Pri | Status | Notes |
|----|-------|-----|--------|-------|
| KEYMGMT-001 | Key rotation and migration | S | ⬜ | |
| KEYMGMT-002 | HD keys | C | ⬜ | |
| KEYMGMT-003 | Sub-keys | C | ⬜ | |
| KEYMGMT-004 | Compromise and revocation flow | S | ⬜ | |
| KEYMGMT-005 | Emergency access | C | ⬜ | |
| KEYMGMT-006 | Key strength indicator | S | ⬜ | |
| KEYMGMT-007 | Master password change | M | ✅ | Settings → Security. Throttled like unlock; re-wraps every key through a journal that recovers from an interrupted change. |
| KEYMGMT-008 | Standard import and export formats | S | 🔄 | nsec, hex and `0x` hex import; encrypted backup export and import inside onboarding. Left: export from Settings for any key, hex export, NIP-49. |
| KEYMGMT-009 | NIP-49 `ncryptsec` import | S | ⬜ | Needs scrypt and XChaCha20-Poly1305 behind crypto ports. |

## 9. Social and Discovery

| ID | Title | Pri | Status | Notes |
|----|-------|-----|--------|-------|
| SOCIAL-001 | Contact list management | C | ⬜ | |
| SOCIAL-002 | Relay recommendations | C | ⬜ | |
| SOCIAL-003 | Identity verification status | S | ⬜ | |
| SOCIAL-004 | Web of trust | C | ⬜ | |
| SOCIAL-005 | Notification preferences | C | ⬜ | |
| SOCIAL-006 | Profile QR code | S | ✅ | A QR of the `npub` on Home and the profile. A `nostr:nprofile` QR with relay hints would be a refinement. |
| SOCIAL-007 | Activity feed | C | ⬜ | |

## 10. Monitoring

| ID | Title | Pri | Status | Notes |
|----|-------|-----|--------|-------|
| MON-001 | Privacy-preserving telemetry | C | ⬜ | See Decisions needed. |
| MON-002 | Error reporting | S | ⬜ | See Decisions needed. |
| MON-003 | Performance monitoring | C | ⬜ | See Decisions needed. |
| MON-004 | Public health dashboard | C | ⬜ | |
| MON-005 | A/B testing | C | ⬜ | |

## Out of scope

Built-in wallet, a full Nostr client, relay hosting, centralized authentication,
blockchain integration beyond Nostr, AI content generation, media hosting, and
commerce features.

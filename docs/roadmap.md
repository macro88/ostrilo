# Ostrilo Roadmap and Requirements

What Ostrilo is working toward, and which of those requirements the current code
satisfies. For what the current release actually ships, the README and
`CHANGELOG.md` are the authority; this document tracks the rest.

The **Version** column holds planning tiers written before the first public
release (`v1.x` for the signer foundation, `v2.0` onward for later work). They
are not release numbers and not commitments: 0.8.0 is the first public release,
and a tier says only roughly where an item sat in the original ordering.

---

## Executive Summary

Ostrilo aims to be a Nostr signing extension that a security-conscious user can reasonably trust by default, that stays straightforward to use as its protocol coverage grows, and that is pleasant to build against as a developer. Building on the current implementation, this document lays out the roadmap toward that goal. It is a target, not a scorecard - the traceability matrix and status notes below are what track what has actually shipped.

### Vision Statement

Ostrilo is working toward being a dependable home for a Nostr identity - secure by default, considerate of the person using it, and worth the trust it asks for. That trust has to be earned through verifiable behavior; this statement is a goal, not a claim that the goal has been met.

### Strategic Goals

1. **Security first:** Work toward defense-in-depth cryptographic practices that are verified, not just asserted.
2. **Broad protocol coverage:** Support the Nostr use cases and NIPs that matter in practice, expanding coverage deliberately rather than all at once.
3. **Developer-friendly integration:** Aim for clear, well-documented APIs and a straightforward integration experience.
4. **User control:** Give people intuitive controls over their own keys and decisions.
5. **Responsive performance:** Keep signing latency and UI responsiveness low enough to stay out of the user's way, and measure that rather than assert it.
6. **Cross-platform reach:** Support the major browsers well, and extend further only where coverage can be verified.

---

## Table of Contents

- [Requirements Traceability Matrix](#requirements-traceability-matrix)
- [Status Reconciliation (2026-09-25)](#status-reconciliation-2026-09-25)
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

---

## Requirements Traceability Matrix

**Legend:**
- **Priority:** M=Must, S=Should, C=Could, W=Won't (MoSCoW)
- **Status:** ✅ Done | 🔄 In Progress | ⬜ Not Started | ❌ Removed
- **Version:** Target semantic version for delivery

### Summary Statistics

Counted from the requirement tables below. The previous version of this table
reported 154 requirements that the tables never contained; these figures are
the rows as they stand.

| Priority | Total | ✅ | 🔄 | ⬜ | ❌ |
|----------|-------|----|----|----|----|
| Must     | 33    | 11 | 12 | 10 | 0  |
| Should   | 54    | 0  | 15 | 39 | 0  |
| Could    | 31    | 0  | 0  | 31 | 0  |
| Won't    | 1     | 0  | 0  | 0  | 1  |
| **Total**| **119** | **11** | **27** | **80** | **1** |

### Current Implementation Snapshot

- **Status date:** 2026-09-25. Every row was re-verified against the code at commit `71b53d1`; see [Status Reconciliation](#status-reconciliation-2026-09-25) for what changed and what each 🔄 row still needs. Updated 2026-09-26 as `harden-origin-and-password-boundaries` landed; no row changed status.
- **Source of truth:** current `src/`, `tests/`, `openspec/specs/`, archived OpenSpec changes, and project docs in this repository.

The original release dates are now historical planning targets. The status markers in this document describe the current codebase, not the original plan.

**On memory zeroization (SEC-001), stated precisely.** Byte buffers holding key material are overwritten in `finally` blocks and that is now verified by reading the bytes back, not by counting calls to `zeroize`. Three things remain outside what any JavaScript implementation can guarantee, and the requirement should not be read as covering them: string secrets such as the master password are immutable and cannot be erased; `crypto.subtle.importKey` copies key bytes into an opaque `CryptoKey` that script cannot clear; and dropping a reference is permission for the garbage collector to erase, not erasure. The testable property for strings is narrower - no unnecessary copy is created and nothing retains the value - and that is what `tests/security/memory-zeroization.test.ts` asserts.

**Implemented in the current codebase:**

- NIP-07 core provider: `window.nostr.getPublicKey()` and `window.nostr.signEvent()` are injected at document start and route through content/background messaging.
- Background-only key operations, encrypted local key storage, multi-key management, active-key selector, add/import/rename/delete flows, and guarded last-key deletion.
- Per-origin trust policy evaluation, medium-trust event kind defaults, explicit per-kind rules, session grants, remembered allow/deny decisions from approval prompts, managed approval queue/window, event de-duplication, bulk deny (bulk approve was removed deliberately), and Activity-page pending approval access.
- Verification automation: `verify.yml` runs on every pull request and every push to `main`. Its jobs run typecheck and lint, the unit/integration/security suites under enforced coverage thresholds (80% lines/functions/statements overall, 90% in `src/domain`, `src/application` and `src/infrastructure`), both extension builds with the built-output security assertions, a dependency audit that blocks on high and critical, and a gitleaks secret scan. `e2e.yml` runs Playwright against Chromium nightly, on every push to `main`, on demand, and on a `run-e2e` label. `aislop.yml` gates changed files on pull requests and the whole project on `main`; `react-doctor.yml` reports without gating; `badges.yml` publishes coverage, aislop and React Doctor badges from `main`. See `docs/ci-verification.md`.
- Supply-chain gates: `pnpm install --frozen-lockfile` everywhere (which also runs the `minimumReleaseAge` / `trustPolicy: no-downgrade` policy in `pnpm-workspace.yaml`), React Doctor pinned as an exact devDependency rather than fetched with `npx ... @latest`, and reviewed `overrides` replacing packages that lost provenance attestation instead of relaxing the policy.
- Memory zeroization is verified against real buffer contents rather than mock call counts. The adapter no longer clones key material into unreachable `ArrayBuffer` copies, and `unlock()` no longer creates a second copy of the password to zeroize. See the honest-limits note below.
- Trust policy hardening centralizes protected-kind definitions - Short Text Note (1), Event Deletion Request (5), Zap Request (9734), Client Authentication (22242) and HTTP Auth (27235), chosen because signing them is irreversible or the signature functions as a credential outside the user's own Nostr content. Domain policy evaluation and the `nostr.signEvent` RPC handler force protected kinds through approval before session grants, explicit allow rules, Medium Trust, or High Trust can auto-sign them, and Medium Trust settings/UI filter protected kinds out of auto-allow controls.
- Trust levels are allowlists, not denylists. High Trust auto-signs only `HIGH_TRUST_ALLOW_KINDS` - reposts (6, 16), reactions (7), the user's own replaceable lists (10000, 10001, 10002, 10003) and application data (30078). Medium Trust may permit a subset of that list and can never exceed it; Low Trust asks for everything. Any kind outside the allowlist - profile metadata, contacts, DMs, long-form content, and every kind the protocol registers in future - requires approval unless the user writes an explicit per-kind `allow` rule, so a new NIP never ships as silently signable.
- Persistent activity log recording signing decisions, identity disclosures and profile publishes, with origin/kind filters, pagination, a clear action, configurable retention of 10-500 entries (default 50), and local JSON export. The export is currently broken above 100 entries; see UX-013.
- Profile metadata management for NIP-01 kind:0 profile fetch/cache/display/edit/publish, relay settings, multi-relay querying, and publishing the kind:0 profile to relays. The profile cache lives in `storage.session`, and profile lookups are partitioned across relays with a random salt so no single relay is asked about every managed key.
- Full Options Page with General, Keys & Identities, Security, Permissions, Activity Log, Relays, and Advanced tabs plus local cross-context settings sync.
- Structured JSON-RPC-compatible error responses with canonical machine codes and numeric mappings inside the extension. The page boundary and `docs/rpc-error-codes.md` lag behind; see DEV-001.
- Light/dark/system theme selection with live system-preference updates across popup, side panel, approval window, and options page.
- WXT Chrome/Firefox build targets, Playwright extension E2E tests (Chromium only; Firefox is checked by the manifest and bundle assertions, not a browser-runtime suite), smoke screenshot flow, the aislop quality gate, and React Doctor CI.
- A privacy policy (`PRIVACY.md`) covering what the extension stores, what it sends to relays, and which settings browser sync copies.
- Unlock throttling lives in the background and persists in `storage.local`, so reopening the popup does not reset it; a failed unlock reports its reason. Every master-password check shares that one counter - unlock, re-authentication, reveal, and adding a key to an existing vault - so no path is an unthrottled guessing oracle, and the re-authentication dialog shows a backoff as a wait rather than as a wrong password. Pending approvals are denied and the badge cleared when the vault locks, even when the settings write during lock fails.
- The background binds every `nostr.*` request to the browser-attested sender: the origin handlers see is derived from `sender.url` for this extension's top-frame content script, and a claimed origin that disagrees is refused with `invalid_origin` before any service is reached. `policy.setOrigin` accepts only `name`, `trustLevel` and `identityDisclosure`, and asks for the password for `high` trust or a disclosure `allow`; per-kind rules and session grants have their own password-gated methods. KDF parameters read from storage or a backup file are bounded above as well as below.
- Explicit manifest policy on both build targets: a declared `content_security_policy.extension_pages` (closed `default-src`, `script-src 'self'` with no `unsafe-eval`, no plaintext `http:`/`ws:` source), a reviewed permission set of `storage`, `windows`, `alarms` and `idle` plus Chrome's `sidePanel`, `use_dynamic_url` on the injected NIP-07 provider so pages cannot probe a fixed extension URL, the Firefox target moved from MV2 to MV3 so no target keeps a persistent background page holding decrypted keys, and `console` output stripped from production bundles. `tests/security/manifest-assertions.test.ts` asserts all of it against the generated manifests, which is what caught — and now fences — the placeholder `sidebar_action` block Firefox had been shipping. SEC-004 is now ✅: `verify.yml`'s `build` job runs `manifest-assertions.test.ts` and `key-handling-bundle.test.ts` against freshly built Chrome and Firefox output with `OSTRILO_REQUIRE_BUILD_OUTPUT=1`, so an absent `.output/` fails the job instead of skipping the suite. Stated precisely, the gate asserts the shipped manifests' CSP - no `unsafe-eval` or `wasm-unsafe-eval`, no `unsafe-inline` in `script-src`, no remote script origin, no plaintext transport, a closed `default-src` - plus build-output hygiene: no source-map files, no inline source-map comments, no `console` call in any production bundle. It does not grep bundle text for `eval(`; the asserted CSP is what forbids evaluation at runtime. See `docs/extension-manifest.md` and `docs/ci-verification.md`.
- Encrypted key backup replaces the plaintext key download. The create-key backup
  step no longer writes `{privateKey, privateKeyHex}` to disk in the clear: it
  writes a versioned `ostrilo-key-backup` envelope sealed with the vault's own
  Argon2id KDF and AES-GCM adapters under a passphrase supplied at export time and
  deliberately separate from the master password, with the key name inside the
  ciphertext and no key name in the filename. The same step bounds a copied nsec to
  a 45-second clipboard window that is announced before the copy and cleared on
  unmount and `pagehide`, drops the master password and the revealed key on every
  exit rather than only on Finish, keeps key fields out of autofill and password
  managers, and requires the user to re-enter the last 8 characters of the nsec — or
  re-open the encrypted file — before Finish enables. The onboarding import path
  reads the envelope back. See `docs/ostrilo-onboarding-requirements.md`.
- No document that can hold key material loads a 3D engine: the three.js mascot
  has been removed entirely. `tests/security/key-handling-bundle.test.ts` walks the
  module and `modulepreload` graph of every document named in
  `src/infrastructure/messaging/key-handling-documents.ts` and fails on WebGL
  markers or a transitive byte ceiling, so it cannot come back unnoticed.
- Playwright now covers the Tier-1 journeys the coverage audit named, rather than
  asserting that a page rendered: onboarding create and import, backup round-trip
  (the product reads back the file it writes) and backing out of the backup step,
  approval flow and timeout and withdrawal, protected-kind policy, remembered
  site-signing policy, identity disclosure, vault lock, activity retention, relays,
  security and general and advanced settings, the public-key surface including QR.
  Five approval specs that asserted nothing were replaced. The suite no longer calls
  a public relay; it serves its own fixtures over TLS. Test counts are deliberately
  absent here and in `docs/TESTING.md` - run the runners.
- An agent-driven E2E loop: a scratch project and template, shared driving helpers,
  page and service-worker console captured to a file, build selected by mode with the
  artifact's provenance asserted, and the build skipped when `src/` is unchanged.
  See `docs/agent-loop.md`.
- The design-review runner captures every surface in both themes and in populated
  state as well as fresh-vault state - a renamed key, a second key, a cached profile,
  three relays, three sites at three trust levels, real signed and denied activity,
  and a two-site approval queue. That populated pass is what exposed a layout bug the
  empty-vault set could not show. The runner's own defects (a run that died at the
  backup step, approvals never captured after the content script moved to
  `https://*/*`, the Approve button photographed inside its 500ms cooldown) were
  fixed as part of the review. No capture contains an nsec. See
  `docs/design-review/README.md`.
- The polish round of 2026-09-17 closed every finding in that review, including three
  token pairs that failed WCAG AA - among them the amber carrying *"There is no
  recovery"* on the backup step, now 5.90:1 - and rewrote the design rules' contrast
  section to state what the tokens actually guarantee.
- Defects that only driving the real UI surfaced, now fixed: both timeout sliders were
  unlabelled to a screen reader and inoperable from the keyboard (the options page
  swallowed arrow keys to switch tabs); Reset All Settings answered a destructive
  confirm and then silently reset nothing, because the background password-gates the
  timeout fields and the patch carried no password - it now routes through the same
  reauth dialog; the UI reported a version the extension was not running; and the dev
  server's own assets were blocked by the extension CSP.

**Partially implemented or narrower than the requirement wording:**

- The NIP-07 provider trust boundary is shipped: HTTPS-only injection, a
  non-writable and non-configurable `window.nostr` over a frozen provider,
  no page-drivable extension UI, an extension-owned request lifecycle with
  one shared deadline and a cancellation path that can only deny, truthful
  capability advertisement (`nip04`/`nip44` removed rather than stubbed), and
  no injected script element left in the page. Approval display integrity is
  shipped: full origin with scheme, a non-HTTPS flag, true UTF-8 byte lengths
  for content and tags, bidi and zero-width characters rendered as visible
  escapes with a count, and the signing key bound to the request rather than
  read from the UI selection. Flood controls are shipped for requests that
  reach the approval queue: 10 enqueues per origin per minute, 5 pending per
  origin, 20 globally, with `rate_limited` as a distinct code. A request that
  policy auto-signs never enters the queue and is not metered, which is why
  SEC-006 is 🔄 rather than ✅. Bulk approve is gone, the detail pane no longer
  re-binds after a resolution, and approve carries a 500ms cooldown on bind.
  NIP-44 is not implemented and NIP-04 will not be; removing their stubs is
  what makes feature detection honest rather than a regression.

- Session auto-lock is implemented as a FLAT lock, not the gradual restriction
  SEC-012 describes. What shipped: a lock state that fails closed (absent,
  malformed or unreadable state reports locked, as does an "unlocked" record
  with no key material in memory, which is every MV3 worker eviction); an
  `autoLockMinutes` deadline of 1-60 minutes that is actually enforced, by a
  `chrome.alarms` alarm plus a check on every lock-state read; an allowlist
  lock gate on the RPC surface, so a method added tomorrow is refused while
  locked by default; redacted `keys.list` and `settings.get` projections while
  locked; a lock-gated options page; and password re-authentication for key
  deletion, raising an origin to `high` trust, enabling a session grant,
  setting a per-kind `allow` rule, and changing either timeout.
  Since 2026-09-19 the deadline slides: unlocking, switching keys, answering
  an approval and changing a setting each postpone it (reported at most once
  per 30 seconds per surface), and a countdown ring shows the time left in the
  header, popup Settings and the Options Security tab, never on the approval
  window and never to a page. Since 2026-09-20 an auto-signed request also
  postpones the deadline, but only while the `idle` API reports the OS as
  `active` within the auto-lock window; `idle`, `locked` or an unavailable API
  counts as away. This check never blocks the signature itself. The
  consequence is deliberate: a user at the machine with a Nostr client in a
  background tab keeps the vault open indefinitely, while a timer-driven tab
  on an unattended machine cannot.
  What did NOT ship: the graduated tiers. There is still one flat lock, with
  no intermediate state that stops auto-signing before requiring the password.
  OS idle state is used only as presence evidence for postponing the deadline,
  not to infer inactivity patterns. SEC-012 therefore stays 🔄.

- Memory zeroization exists for `Uint8Array` key material and derived keys, but some password fields still pass through React state and JavaScript strings, so the "complete zeroization" and "secure UI isolation" goals are not fully met. The re-entrant unlock gap is closed: `unlock()` now zeroizes the keys it replaces before clearing its map, and `memory-zeroization.test.ts` reads the first session's buffers back as zero after a second unlock.
- Approval prompts show event kind, content, tags, signer, event hash and raw details, plus a fixed one-line consequence sentence for 13 common kinds, trust and non-HTTPS chips, and a protected-kind notice. They do not parse the event: no zap amount or recipient, no reply or reaction target, no relay-list or contact-list diff, and no risk scoring.
- Encrypted backup export and restore now exist (SEC-011), but only inside
  first-key onboarding: a key added later cannot be backed up from within
  Ostrilo, and there is no user-controlled remote backup target, so SEC-011
  stays 🔄. (Wipe-on-uninstall is SEC-014, not part of this row.) BIP-39 / NIP-06 seed phrases remain out of scope
  and are tracked as SYNC-004 for v2.2: they change key *generation*, not key
  *backup*, and folding them in would have delayed removing a plaintext key file
  that shipped.
- SEC-024 ships in two phases, both landed. Phase 1 binds the page origin to
  `nostr.getPublicKey`, validates it in the background before any key is read,
  rate limits per origin, writes an activity-log entry for every outcome, and
  lists in Settings → Permissions which origins have read the public key —
  including origins with no stored policy record, which is the category a
  policy-driven table can never show. Phase 2 adds the per-origin consent gate,
  a disclosure-specific refusal code distinct from `denied`, remembered allow
  and deny, revocation, and an error boundary around the approval window.
  **No origin is grandfathered**, including origins with an explicit allow rule
  or `high` trust: every origin prompts once on next use. Approving a signature
  records disclosure consent, since the signed event contains the public key.
  
  The scope is bounded, and the bounds are the part most likely to be misread
  as covered:
  - The public key is **not made secret**. It is published on relays and this
    extension publishes it there itself. The gate is about linkage.
  - It does **not** cover a third-party script running inside a consented
    page's realm. The content script is top-frame only (`content.ts:50`,
    `all_frames` unset), so such a script inherits that page's grant. This is
    the residual most likely to be assumed away; it is not solved.
  - For any origin the user signs for, protection ends at the first approved
    signature: the signature returns the public key, and a remembered per-kind
    allow makes every later one silent. The gate protects the window before
    that, and origins that never ask to sign at all.
  - The rate limiter is held in memory, so an evicted MV3 worker loses its
    counters. It bounds a fast polling loop, which is the attack; it does not
    bound a caller patient enough to wait out an eviction.
- SEC-003 advances but does not complete. The create-key flow holds the revealed
  key only in a `useRef`, writes it into the DOM imperatively and wipes it on
  unmount, and clears the master password from reducer state on every exit path.
  `harden-password-entry-surfaces` finishes the input-hygiene half: the key import
  flow now clears its password on success, on failure and on unmount; every secret
  input in `src/ui` carries the autofill and spell-check opt-outs from one shared
  declaration; and the password input element's own value is cleared on the
  surfaces whose document outlives the attempt.
  A correction to the previous note here, which said `LockScreen` "still holds its
  password in `useState`" as an outstanding defect: it does hold a controlled value,
  and that is permitted. `secure-key-backup-flow`'s `Ephemeral Input State` allows a
  bounded controlled value where live validation needs one, the field is cleared on
  every attempt, and moving it to a `useRef` would change nothing about what a script
  in the same realm can read.
  What did NOT ship: the dedicated `keyflow.html` / `welcome.html` documents described
  in `openspec/changes/archive/2026-09-17-secure-key-backup-flow/design.md` (Decision 5, Steps B and C)
  are not built, so the popup still hosts onboarding, unlock and the whole main app
  in one realm. That realm split is the remaining half, and the row stays 🔄.
- Activity filtering covers origin and event kind; it does not yet include full-text search, date-range filtering, result filtering, or saved presets.
- Accessibility has meaningful keyboard/ARIA coverage for key management and Radix-based
  controls, the design tokens now meet AA on their intended surfaces, and the timeout
  sliders are labelled and keyboard-operable. No repo-wide WCAG 2.1 AA audit has been
  completed, so UX-011 stays 🔄.
- Relay/profile infrastructure exists, but NIP-specific protocol flows such as NIP-44, NIP-42, NIP-57 validation, NIP-65 relay lists, and NIP-05 DNS verification remain unimplemented. Kinds 9734, 22242 and 27235 are protected kinds that always prompt, but that is policy gating, not an implementation of NIP-57, NIP-42 or NIP-98. The relay adapter drops NIP-42 `AUTH` challenges. NIP-04 is out of scope (PROTO-001 ❌). NIP-05 verification would also need a reviewed widening of `connect-src`, which today allows only `wss:` and `https://nostr.build`.
- Settings, including theme, auto-lock and origin policies, live in one `appSettings` item in `storage.sync`; keys stay in `storage.local`. When the user has browser sync enabled, the vendor already copies those settings to other devices, as `PRIVACY.md` states. What is missing is everything that makes that safe: there is no conflict resolution (a whole-object write from one device can overwrite a policy set on another), no handling of the 8 KB per-item sync quota that an unbounded origin list will eventually hit, and no exclusion of device-local fields such as `selectedKeyId` and `onboardingCompleted`. Open UI pages also do not refresh on a remote change. NIP-78/decentralized sync is deferred.
- There is no code splitting: UI routes are not split and no route loads on demand. The
  one lazy boundary that existed guarded the 3D mascot, which has been removed, so
  PERF-002 is back to ⬜. CI does enforce an 800 KB uncompressed transitive-JS ceiling on
  the four UI documents (`key-handling-bundle.test.ts`), but that is a security fence,
  not a size budget: it does not cover the background script, is not gzip-based, and
  tracks no trend. The background script measured 74.3 KB gzipped (246 KB raw) at
  `71b53d1`, under PERF-003's target, but nothing in CI keeps it there.

---

## Status Reconciliation (2026-09-25)

Every row was re-checked against `src/`, `tests/`, `.github/workflows/` and the
archived OpenSpec changes at commit `71b53d1`, including the five changes archived
after the previous reconciliation (aislop improvements, auto-lock countdown,
idle-gated auto-sign activity, key-document declaration, mascot removal). The rule is unchanged: ✅ only
when the full row wording is met, 🔄 for a narrower shipped slice.

### Status changes

| ID | Was | Now | Why |
|----|-----|-----|-----|
| SEC-006 | ⬜ | 🔄 | Per-origin limits ship on the approval queue and on `getPublicKey`, returning `rate_limited`. The previous ⬜ contradicted this document's own "flood controls are shipped". |
| SEC-013 | 🔄 | ⬜ | The activity log has no tamper detection of any kind - no hash chain, MAC or signature - and it does not record unlock, lock, key deletion or settings changes. It is a user-facing activity log, not an audit log. |
| PROTO-001 | ⬜ (S) | ❌ (W) | The decision not to add NIP-04 is recorded in `harden-provider-trust-boundary` (design Decision 10) and reflected in the README, SECURITY.md and the provider specs. |
| PROTO-009 | 🔄 | ⬜ | Relays are a flat list with no read/write markers, and nothing fetches or publishes kind 10002. The generic relay settings belong to other rows. |
| UX-002 | ✅ | 🔄 | The profile picture is shown as a URL and deliberately never loaded (SEC-021), so "displaying … picture" is not met. |
| UX-005 | ⬜ | 🔄 | Inline explanatory copy now ships for trust levels, protected kinds and remember scope. There is still no tooltip component and there are no learn-more links. |
| UX-015 | ✅ | 🔄 | Only the system-preference mode exists; the row also names time-of-day and custom-schedule switching. |
| DEV-001 | ✅ | 🔄 | Inside the extension the codes are canonical, but `content.ts` sends pages three non-canonical strings, and `docs/rpc-error-codes.md` shows an old response shape and omits codes a page can receive. |
| PERF-003 | ⬜ | 🔄 | The background script is 74.3 KB gzipped, under the 150 KB target, but no CI check enforces it and no deliberate optimization was done. |
| SYNC-006 | 🔄 | ⬜ | Nothing resolves conflicts. `OriginPolicy.updatedAt` is written but never compared, and whole-object writes mean one device's theme change can overwrite another device's new policy. |

### What each 🔄 row still needs

| ID | What ships | What remains for ✅ |
|----|-----------|---------------------|
| SEC-001 | `Uint8Array` key material and derived keys are zeroized in `finally` blocks, verified by reading the bytes back, including the keys a re-entrant unlock replaces. | Get passwords out of React state (see SEC-003). String and `CryptoKey` copies stay beyond any JavaScript implementation. |
| SEC-003 | The revealed key is held in a ref and written to the DOM imperatively; passwords are cleared on every exit; secret inputs opt out of autofill and spell-check. | The realm split: dedicated `keyflow.html` / `welcome.html` documents. Passwords remain in React state in `LockScreen`, `ReauthDialog`, the backup components and the onboarding reducers; either move them out or reword the row to the bounded controlled-value rule the snapshot defends. |
| SEC-006 | Approval-queue limits (10/min and 5 pending per origin, 20 global); `getPublicKey` 6/min per origin. | Meter auto-signed requests, which bypass both limiters; make thresholds configurable; add temporary blocks for abusive origins; persist counters across worker eviction. |
| SEC-008 | Display integrity (full origin, non-HTTPS chip, byte lengths, hidden-character escapes), per-kind consequence sentence, protected-kind notice. | Risk analysis: zap amounts, DM content, relay-list changes, and a risk score. |
| SEC-011 | Encrypted backup file (Argon2id + AES-GCM, separate passphrase) offered during first-key onboarding and restored at onboarding import. | Backup for keys added later, from Settings, behind re-auth; an optional user-controlled remote target. |
| SEC-012 | Flat fail-closed lock with a sliding 1-60 minute deadline, presence-gated postponement by auto-signs, countdown ring. | An intermediate tier that stops auto-signing before requiring the password; timing based on inactivity patterns, or a reworded row. |
| SEC-017 | Frozen lockfile, `minimumReleaseAge`, `trustPolicy: no-downgrade`, audit blocking on high/critical, SHA-pinned actions, Renovate, pinned Node, a documented reproduce procedure. | A CI job that builds twice and diffs; cross-machine determinism verified (currently "deferred, unverified" in `docs/ci-verification.md`); digests published with releases. |
| UX-001 | Persistent log with timestamp, origin, kind, 100-character preview, allow/deny and key; retention 10-500 (default 50); origin and kind filters; pagination. | Date-range and result filters; record why a signature was denied (timeout vs refusal) and log rate-limited, locked and approval-failed outcomes; build the origin dropdown from the whole log, not the loaded page; let the kind dropdown reach protected kinds 5, 22242 and 27235; escape hidden characters in the preview; reconcile the row's default of 500 with the shipped 50. |
| UX-002 | kind:0 fetch, one-hour cache, name/about/website display, edit and publish. | Show the picture without breaking SEC-021's no-remote-image guarantee, or reword the row. |
| UX-003 | A fixed consequence sentence for 13 kinds, trust and non-HTTPS chips, raw content, tags and JSON. | Summaries parsed from content and tags: reply and mention targets, reaction target, zap amount and recipient, DM recipient, contact-list and relay-list diffs. |
| UX-004 | Copy public key and QR on Home; Home rows to Keys, Relays, Permissions, Profile and Activity; Add Key in the header key selector. | An external profile link (njump/nostr.band), an export action, create-key from Home, keyboard shortcuts (no `commands` in the manifest). |
| UX-005 | Inline explanations for trust levels, protected kinds and remember scope. | A tooltip/popover component; help for event kinds and security settings; learn-more links to documentation. |
| UX-006 | Origin and kind filters, combinable, with clear-filters. | Full-text search; date, result and reason criteria; saved presets. |
| UX-007 | Light, dark and system themes. | Additional built-in themes (including high-contrast), a custom colour picker, font-size adjustment. |
| UX-008 | A setup wizard: create or import, password, backup with verification. | A concept tutorial covering signing, trust levels and permissions; dismissible tips that remember dismissal. |
| UX-011 | Keyboard/ARIA coverage for key management and Radix controls, AA token contrast, labelled and keyboard-operable sliders. | A repo-wide WCAG 2.1 AA audit, automated axe checks in unit or E2E tests, and remediation. |
| UX-013 | JSON export from the Activity Log settings. | **Fix a bug:** the export requests `limit: maxEntries`, but `activity.getRecent` caps `limit` at 100, so any retention above 100 fails with "Could not export" and no more than 100 entries can ever be exported. Then add CSV. |
| UX-015 | Live switching on the system colour-scheme preference. | Time-of-day and custom-schedule modes, or reword the row to system preference. |
| DEV-001 | Canonical code set, JSON-RPC numeric mapping, structured error objects, a test that fails on hard-coded error strings. | Replace `content.ts`'s "Invalid event parameter", "Unknown method" and raw exception message with canonical codes; rewrite the overview and forwarding sections of `docs/rpc-error-codes.md`; document every code a page can receive, including `rate_limited` and `signing_failed`, with numeric mappings. |
| DEV-006 | Markdown docs: the NIP-07 section of `developers_readme.md`, `rpc-error-codes.md`, `local-https-development.md`. | A documentation site, interactive examples, framework snippets, migration guides, best practices; correct the stale dApp docs (DEV-001, `policy_denied`, "any page"). |
| PERF-003 | Background script 74.3 KB gzipped at `71b53d1`. | A CI gzip-size gate on `background.js`; deliberate tree-shaking and dependency review. |
| PERF-005 | A 5-second settings cache in the UI client, a debounced write for the docked-panel flag, an in-memory activity log, parallel policy reads. | A background settings/policy cache; stop rewriting the whole `appSettings` object on every change; batch background writes. |
| PERF-006 | Per-relay adapters reuse an open socket, reconnect with jittered backoff, give up after 5 attempts; one shared `RelayManager`. | Rebuild adapters only when the relay list changes (today any `appSettings` write disconnects every relay); a keepalive/idle policy; metrics. |
| PERF-008 | Lock state and session grants in `storage.session`, the deadline in `chrome.alarms`, the unlock throttle in `storage.local`; key material fails closed on eviction by design. | Persist or deliberately drop the approval queue and rate-limit counters, which are lost on eviction; reword the row, which asks for the vault to stay unlocked across restarts - the opposite of the shipped fail-closed design. |
| SYNC-001 | `appSettings` (theme, auto-lock, origin policies) in `storage.sync`; keys in `storage.local`; browser sync copies settings when enabled. | Stay within the 8 KB per-item sync quota; refresh open UI on a remote change; stop syncing device-local fields; test it. |
| KEYMGMT-008 | nsec, hex and `0x` hex import; encrypted backup export and import inside onboarding. | Backup and export for any key from Settings; backup import outside onboarding; hex export; NIP-49 `ncryptsec` or another standard encrypted format. |
| SOCIAL-006 | A QR code of the bare `npub` on Home and the profile. | `nostr:nprofile…` with recommended relays; a profile-sharing presentation. |

### Rows whose wording conflicts with a shipped decision

These keep their status, but the row itself needs a product decision before it can
be planned:

- **PERF-008** asks for the vault to stay unlocked across service-worker restarts; the shipped design deliberately fails closed.
- **SEC-014** asks for cryptographic erasure on uninstall. Extension code cannot run at uninstall and the browser deletes extension storage itself. An in-app "erase all data" is the implementable form; otherwise ❌.
- **SEC-018** asks to detect deterministic-signature requests. Signing uses fresh auxiliary randomness from `@noble/curves` and a page has no way to request otherwise, so there is nothing to detect.
- **MON-001, MON-002, MON-003** conflict with `PRIVACY.md`, which promises no analytics, telemetry, crash reports or usage statistics.
- **DEV-012** (batch signing to reduce prompts) conflicts with the deliberate removal of bulk approve ("approving in bulk is approving without looking").
- **UX-002** and **UX-001** as noted above: the picture versus SEC-021, and a default retention of 500 versus the shipped 50.

### Added from the competitor review (2026-09-25)

A review of nostr-wot-extension v0.8.3 against Ostrilo produced these roadmap changes. The review's defects are not rows; they are proposed as OpenSpec changes:

- `harden-origin-and-password-boundaries` (landed 2026-09-26):
  - The `policy.setOrigin` re-authentication bypass.
  - The background taking the page origin from the message body rather than from `sender`.
  - Password checks that skip the unlock throttle.
  - `unlock()` clearing keys unzeroized (the SEC-001 remainder above).
  - `lock()` skipping its listeners when the settings write fails.
  - No ceiling on KDF parameters read from backup files or storage.
- `add-master-password-change`: KEYMGMT-007.

| ID | Change |
|----|--------|
| PROTO-002 | Priority S → **M**, with a quantum-safety caveat: ship NIP-44 v2 for interoperability behind its own decrypt permission, on a crypto-agile surface that can add a post-quantum scheme without a breaking change. |
| PROTO-017 | New, M. The hybrid post-quantum scheme that caveat points at; blocked on an interoperable specification. |
| SEC-025 | New, S. Contact-list replacement guard. |
| SEC-026 | New, S. Per-key consent scope (closes the identity-linkage gap). |
| SEC-027 | New, S. Encrypted activity log at rest. |
| KEYMGMT-009 | New, S. NIP-49 `ncryptsec` import. |

Decided after the review (2026-09-26): origin policies and every other authority-bearing setting become device-local rather than browser-synced, because a grant authorised on one synced profile applied on another without that profile's password. Proposed as `localize-authority-settings`; SYNC-001 and SYNC-006 are restated when it lands.

---

## Epic 1: Security & Privacy Hardening
**Strategic Importance:** CRITICAL  
**Target Version:** v2.0  
**Owner:** Security Team

### Rationale
Security is the foundation of trust in a signing extension. Users entrust Ostrilo with their digital identity's most sensitive credentials. Any security vulnerability could lead to catastrophic loss of funds, reputation, and privacy.

### Requirements

| ID | Title | Priority | Status | Version | Epic | Description |
|----|-------|----------|--------|---------|------|--------------------------|
| SEC-001 | Complete Memory Zeroization | M | 🔄 | v2.0 | 1 | Implement comprehensive memory zeroization for all sensitive data including private keys, passwords, derived keys, and decrypted plaintext throughout the application lifecycle, ensuring buffers are zeroed immediately after use in try-finally blocks |
| SEC-002 | Hardware Security Module Support | S | ⬜ | v2.1 | 1 | Add optional hardware security module (HSM) integration via WebAuthn for private key storage, allowing users to store keys on YubiKey, Ledger, or similar devices |
| SEC-003 | Secure UI Component Isolation | M | 🔄 | v2.0 | 1 | Refactor UI components to never store private keys or passwords in React state, using refs and immediate RPC forwarding instead, with secure memory handling |
| SEC-004 | Content Security Policy Enforcement | M | ✅ | v2.0 | 1 | Add CI validation that scans build output for eval, inline scripts, and unsafe-inline directives, ensuring strict CSP compliance in manifest.json |
| SEC-005 | Secrets Scanning in CI/CD | M | ✅ | v2.0 | 1 | Integrate automated secrets scanning in CI/CD pipeline using tools like TruffleHog or git-secrets to detect accidentally committed private keys, API tokens, or passwords |
| SEC-006 | Rate Limiting for Signing Operations | S | 🔄 | v2.0 | 1 | Implement rate limiting on signing operations per origin to prevent abuse, with configurable thresholds (e.g., 100 signs/minute) and temporary blocks for suspicious activity |
| SEC-007 | Phishing Protection with Domain Verification | M | ⬜ | v2.0 | 1 | Implement domain verification against known phishing sites using community-maintained blocklists, warning users before signing on suspicious domains |
| SEC-008 | Event Content Preview with Risk Analysis | M | 🔄 | v2.0 | 1 | Enhance approval prompts with intelligent event content preview, detecting potential risks like large zap amounts, sensitive DM content, or malicious relay instructions |
| SEC-009 | Biometric Authentication Support | S | ⬜ | v2.1 | 1 | Integrate WebAuthn for biometric unlock (fingerprint, Face ID) as an alternative or supplement to password-based unlock |
| SEC-010 | Multi-Factor Authentication | S | ⬜ | v2.1 | 1 | Add optional 2FA/MFA support for high-value operations like key export, settings changes, or large zap approvals |
| SEC-011 | Secure Backup & Recovery | M | 🔄 | v2.0 | 1 | Implement secure encrypted backup export with optional cloud storage integration (user-controlled), using strong encryption and requiring re-authentication |
| SEC-012 | Session Timeout with Gradual Lock | S | 🔄 | v2.0 | 1 | Implement intelligent session timeout that gradually restricts permissions (e.g., first lock auto-signing, then require password) based on inactivity patterns |
| SEC-013 | Audit Log with Tamper Detection | S | ⬜ | v2.1 | 1 | Implement comprehensive audit logging with cryptographic tamper detection, recording all security-relevant events with timestamps and integrity checks |
| SEC-014 | Secure Wipe on Extension Removal | M | ⬜ | v2.0 | 1 | Implement secure data wipe on extension uninstall, ensuring all keys and sensitive data are cryptographically erased from storage |
| SEC-015 | Key Derivation Hardening (Argon2id) | M | ✅ | v2.0 | 1 | Upgrade key derivation from PBKDF2 to Argon2id with tunable parameters (memory-hard, GPU-resistant) for stronger password-based encryption |
| SEC-016 | Sandboxed Crypto Operations | S | ⬜ | v2.1 | 1 | Isolate cryptographic operations in dedicated Web Workers or separate contexts to minimize attack surface and prevent side-channel attacks |
| SEC-017 | Supply Chain Security Verification | M | 🔄 | v2.0 | 1 | Implement dependency verification with lock file integrity checks, automated security audits (npm audit), and reproducible builds |
| SEC-019 | RPC Privilege Separation and Log Hygiene | M | ✅ | v2.0 | 1 | Split the RPC surface into page-reachable and UI-only namespaces and enforce a sender check before dispatch; remove passwordless key export and the blind signing oracle; never log an RPC request payload or response body; strip console output from production builds. Page requests are bound to the browser-attested sender origin, and the extension-internal approval-window command takes the same extension-page sender check. |
| SEC-018 | Deterministic Event Signing Detection | S | ⬜ | v2.0 | 1 | Detect and warn users about requests for deterministic signatures (replay attacks) versus standard randomized Schnorr signatures |
| SEC-020 | Relay Input Validation and Trust Boundary | M | ✅ | v2.0 | 1 | Treat every byte a relay sends as untrusted: size-bound the frame, validate the NIP-01 envelope and event against schemas, match the event against the subscription filter, recompute the event ID, verify the Schnorr signature, bound response volume, require wss:// at every layer, close subscriptions and cap reconnection, and keep relay-derived data out of the storage area holding the key vault. CSP `img-src` and `connect-src` are delivered by harden-manifest-and-build, not here. |
| SEC-021 | Remote Media and Outbound Egress Policy | M | ✅ | v2.0 | 1 | Restrict remote-supplied URLs to an https:-only allowlist at the validation boundary; stop privileged extension pages loading relay-chosen images so a hostile relay cannot collect the user's IP address on every render; make the avatar upload destination configured, disclosed and empty by default, and validate the URL the upload service returns before it enters profile metadata. The CSP that backs this policy is declared by harden-manifest-and-build. |
| SEC-022 | Consent Scope Integrity and Trust Allowlists | M | ✅ | v2.0 | 1 | A stored consent decision grants exactly the authority the user chose: a remembered allow or deny never fabricates a trust level for a new origin record, trust levels resolve from an explicit per-level allowlist of signable kinds rather than 'everything not protected', the protected set covers irreversible and credential-equivalent kinds (1, 5, 9734, 22242, 27235), non-integer event kinds are rejected at the RPC boundary and refused by every kind-keyed domain helper, and origin records carrying an extension-assigned `medium` trust level are migrated down while their explicit rules are preserved. The origin-policy patch writes neither per-kind rules nor session flags, so each authority has exactly one password-gated path. |
| SEC-023 | Bounded Session Grants | M | ✅ | v2.0 | 1 | A grant-everything session always carries an absolute expiry: the shipped default TTL is non-zero, a stored TTL of 0 reads as that default rather than as 'never expires', settings validation refuses a zero TTL, evaluation ignores an expired or legacy zero-expiry grant, and live grant state is readable for the settings surface instead of the vestigial persisted `sessionGrantAll` flag. |
| SEC-024 | Identity Disclosure Consent for getPublicKey | M | ✅ | v2.0 | 1 | Gate `nostr.getPublicKey` behind per-origin consent: the content script sends the page origin, the background checks it against the browser-attested sender before reading key material, first use prompts, the grant is remembered and revocable in Settings, and every disclosure is written to the activity log. Today every http/https page and every third-party script on it can read and correlate the user's npub silently. |
| SEC-025 | Contact List Replacement Guard | S | ⬜ | v2.0 | 1 | Before signing a kind 3 contact list that would replace the user's known follows with far fewer (for example, zero or one), require an explicit confirmation that shows the loss - even when a remembered allow, trust level or session grant would otherwise sign it silently. A wiped follow list is the most common irreversible Nostr accident and kind 3 is not a protected kind. Needs a locally known baseline (the last kind 3 the user signed or fetched). Added from the 2026-09-25 competitor review; the competitor ships this. |
| SEC-026 | Per-Key Consent Scope | S | ⬜ | v2.0 | 1 | Let identity-disclosure consent and per-origin signing policy be scoped to a key rather than shared by every key. Today `OriginPolicy` has no key field, so a site allowed for key A silently receives key B's public key after a switch and can link the two identities. Offer per-key scoping (the default should be a product decision) and show which key each grant covers. Added from the 2026-09-25 competitor review. |
| SEC-027 | Encrypted Activity Log at Rest | S | ⬜ | v2.0 | 1 | Encrypt stored activity entries, which today keep the first 100 characters of every signed event's content in plaintext, under a vault-held key with per-entry AAD, so a copy of the browser profile does not disclose what the user signed and where. The log stays readable only while unlocked. Added from the 2026-09-25 competitor review; the competitor ships this. |

---

## Epic 2: Advanced Protocol Support
**Strategic Importance:** HIGH  
**Target Version:** v2.0-v2.1  
**Owner:** Protocol Team

### Rationale
Nostr is rapidly evolving with new NIPs. Supporting advanced protocols positions Ostrilo as the most capable and future-proof extension, enabling users to participate in all Nostr use cases.

### Requirements

| ID | Title | Priority | Status | Version | Epic | Description |
|----|-------|----------|--------|---------|------|--------------------------|
| PROTO-001 | NIP-04 Encrypted Direct Messages | W | ❌ | v2.0 | 2 | Implement NIP-04 encryption/decryption methods for direct messages, exposing window.nostr.nip04.encrypt and nip04.decrypt with proper ECDH key agreement and AES-CBC. **Out of scope:** `harden-provider-trust-boundary` (design Decision 10) decided NIP-04 will not be added - unauthenticated AES-CBC, malleable, deprecated upstream. NIP-44 (PROTO-002) is the path for encrypted messaging. |
| PROTO-002 | NIP-44 Versioned Encryption | M | ⬜ | v2.0 | 2 | Implement NIP-44 v2 encryption/decryption (`window.nostr.nip44`) for interoperability with DM, private-list and NWC clients, with decrypt behind its own per-origin permission that no trust level or session grant covers. **Caveat - aim for quantum safety:** NIP-44 v2 rests on secp256k1 ECDH and is not post-quantum; ciphertext published to relays is exposed to harvest-now-decrypt-later. Build the encryption surface crypto-agile from the start - an explicit, advertised scheme list, the caller naming the scheme, no silent downgrade from a stronger scheme to v2 - so PROTO-017 can add a hybrid post-quantum scheme without breaking the API. Added from the 2026-09-25 competitor review (raised from S). |
| PROTO-003 | NIP-46 Nostr Connect (Remote Signing) | C | ⬜ | v2.1 | 2 | Implement NIP-46 remote signer support allowing mobile apps to connect via QR code pairing and send remote signing requests over Nostr |
| PROTO-004 | NIP-26 Event Delegation | C | ⬜ | v2.1 | 2 | Implement NIP-26 delegation token creation and verification, enabling temporary or scoped signing authority for specific event kinds |
| PROTO-005 | NIP-59 Gift Wrap (Sealed Sender) | S | ⬜ | v2.1 | 2 | Implement NIP-59 gift wrap for anonymous/sealed sender DMs, providing sender anonymity with ephemeral keys and gift-wrapped events |
| PROTO-006 | NIP-51 Lists (Bookmarks, Pinned, Mute) | S | ⬜ | v2.1 | 2 | Implement NIP-51 list management for bookmarks, pinned notes, muted users, and custom categorized lists with local caching |
| PROTO-007 | NIP-57 Lightning Zaps | S | ⬜ | v2.0 | 2 | Implement NIP-57 zap request signing with amount validation, recipient verification, and zap receipt tracking in activity log |
| PROTO-008 | NIP-42 Client Authentication | S | ⬜ | v2.0 | 2 | Implement NIP-42 relay authentication allowing clients to prove identity to relays for access control or enhanced features |
| PROTO-009 | NIP-65 Relay List Metadata | S | ⬜ | v2.0 | 2 | Implement NIP-65 relay list metadata (kind 10002) for managing read/write relay preferences with UI for relay management |
| PROTO-010 | NIP-98 HTTP Auth | C | ⬜ | v2.2 | 2 | Implement NIP-98 HTTP authentication allowing websites to request signed authentication tokens for API access |
| PROTO-011 | NIP-05 Verification | S | ⬜ | v2.0 | 2 | Display NIP-05 verification status (DNS-based identity) in profile views with caching and periodic re-verification |
| PROTO-012 | NIP-13 Proof of Work | C | ⬜ | v2.2 | 2 | Implement optional NIP-13 proof-of-work mining for events with configurable difficulty, helping with spam prevention |
| PROTO-013 | NIP-25 Reactions | M | ✅ | v1.0 | 2 | Already supported via generic event signing |
| PROTO-014 | NIP-28 Public Chat | C | ⬜ | v2.2 | 2 | Add public chat channel support (kind 40-42) with channel metadata and message signing |
| PROTO-015 | NIP-72 Moderated Communities | C | ⬜ | v2.2 | 2 | Implement NIP-72 community support for creating and managing moderated communities with approval workflows |
| PROTO-016 | NIP-90 Data Vending Machines | C | ⬜ | v2.3 | 2 | Support NIP-90 DVM job requests and responses, enabling AI/service integrations |
| PROTO-017 | Post-Quantum Hybrid Encryption | M | ⬜ | v2.1 | 2 | Offer a hybrid post-quantum encryption scheme (an ML-KEM key encapsulation combined with the classical ECDH, so it is no weaker than NIP-44 v2 if either primitive fails) through the crypto-agile surface PROTO-002 builds, preferred whenever the recipient publishes a KEM key, with explicit scheme advertisement to prevent downgrade. Blocked on an interoperable specification: the only public candidate is the `nostr-wot/nostr-pqc` NIP drafts, which are unnumbered and single-implementation. Requires a new audited primitive behind a crypto port (`@noble/post-quantum` is the obvious candidate) and a decision on how KEM public keys are published and bound to the Nostr identity. Added from the 2026-09-25 competitor review. |

---

## Epic 3: Enhanced User Experience
**Strategic Importance:** HIGH  
**Target Version:** v2.0-v2.1  
**Owner:** UX Team

### Rationale
A world-class signing extension must be both powerful and delightful to use. Reducing friction, improving clarity, and providing intelligent defaults will drive adoption and satisfaction.

### Requirements

| ID | Title | Priority | Status | Version | Epic | Description |
|----|-------|----------|--------|---------|------|--------------------------|
| UX-001 | Persistent Activity Log with Real Data | M | 🔄 | v2.0 | 3 | Implement persistent activity logging that records all sign approvals/denials with timestamp, origin, event kind, event content preview, and result, storing configurable last N entries (default 500) and displaying them in ActivityView with filters by origin, kind, date range, and result |
| UX-002 | Profile Metadata Fetching & Display | S | 🔄 | v2.0 | 3 | Implement profile metadata fetching (NIP-01 kind:0) from configured relays, caching results locally with TTL, and displaying name/picture/about/website in ProfileView with ability to publish profile updates |
| UX-003 | Smart Event Preview in Approvals | M | 🔄 | v2.0 | 3 | Enhance approval prompts with intelligent event content parsing and preview, showing human-readable summaries for notes, reactions, zaps, DMs, and other common event types |
| UX-004 | One-Click Common Actions | S | 🔄 | v2.0 | 3 | Add quick action buttons in HomeView for common tasks: copy pubkey, view on nostr.band, create new key, export keys, view activity, with keyboard shortcuts |
| UX-005 | Contextual Help & Tooltips | S | 🔄 | v2.0 | 3 | Add contextual help tooltips throughout the UI explaining trust levels, event kinds, permissions, and security settings with learn more links to documentation |
| UX-006 | Search & Filter Activity | S | 🔄 | v2.0 | 3 | Add comprehensive search and filtering in ActivityView supporting full-text search of event content, filtering by multiple criteria, and saved filter presets |
| UX-007 | Theme Customization | S | 🔄 | v2.0 | 3 | Enhance theme system with multiple built-in themes (dark, light, purple, high-contrast), custom color picker, and font size adjustment for accessibility |
| UX-008 | Onboarding Tutorial & Tips | S | 🔄 | v2.0 | 3 | Add interactive onboarding tutorial with progressive disclosure, explaining key concepts (trust levels, signing, permissions) with dismissible tips throughout the UI |
| UX-009 | Bulk Permission Management | S | ⬜ | v2.1 | 3 | Add bulk operations in SettingsView for managing multiple origin permissions: bulk trust level changes, bulk rule application, import/export permission templates |
| UX-010 | Smart Notifications | S | ⬜ | v2.1 | 3 | Implement configurable browser notifications for important events: new approval requests, security warnings, failed sign attempts, with Do Not Disturb mode |
| UX-011 | Accessibility Improvements | M | 🔄 | v2.0 | 3 | Achieve WCAG 2.1 Level AA compliance with focus indicators, ARIA labels, keyboard navigation for all features, screen reader support, and minimum contrast ratios |
| UX-012 | Mobile-Optimized UI | S | ⬜ | v2.1 | 3 | Optimize UI for mobile browsers (Firefox for Android, Kiwi Browser) with responsive layouts, touch-friendly targets, and simplified navigation |
| UX-013 | Export Activity Reports | S | 🔄 | v2.1 | 3 | Add activity export functionality generating CSV/JSON reports of signing activity for personal auditing or tax reporting |
| UX-014 | Multiple Language Support (i18n) | C | ⬜ | v2.2 | 3 | Implement internationalization with initial support for English, Spanish, Portuguese, Japanese, Chinese, with community-contributed translations |
| UX-015 | Dark/Light Mode Auto-Switch | S | 🔄 | v2.0 | 3 | Implement automatic theme switching based on system preferences, time of day, or custom schedule |
| UX-016 | Compact View Mode | C | ⬜ | v2.1 | 3 | Add compact view mode for power users with denser layouts, reduced padding, and more information per screen |
| UX-017 | Drag-and-Drop Key Import | S | ⬜ | v2.1 | 3 | Support drag-and-drop import of key files (encrypted JSON, nsec files) with validation and secure handling |
| UX-018 | Durable Per-Site Signing Permissions | M | ✅ | v2.0 | 3 | Fix remembered per-site signing permissions so approving with remember saves an origin+event-kind rule, future matching unprotected requests auto-sign, protected kinds still require approval, and settings clearly shows and revokes saved policies |

---

## Epic 4: Developer Experience & Integration
**Strategic Importance:** HIGH  
**Target Version:** v2.0-v2.1  
**Owner:** DevRel Team

### Rationale
Developers are our key partners in ecosystem growth. Providing excellent APIs, debugging tools, and documentation will accelerate adoption and integration quality.

### Requirements

| ID | Title | Priority | Status | Version | Epic | Description |
|----|-------|----------|--------|---------|------|--------------------------|
| DEV-001 | Standardized Error Codes | M | 🔄 | v2.0 | 4 | Standardize all RPC error responses with uniform error codes (LOCKED, NEEDS_APPROVAL, DENIED, INVALID_EVENT, RATE_LIMITED, NETWORK_ERROR), error messages, and optional debug context following JSON-RPC 2.0 error object format |
| DEV-002 | TypeScript Type Definitions Export | M | ⬜ | v2.0 | 4 | Publish @types/ostrilo npm package containing TypeScript definitions for window.nostr API, making it easy for dApps to get proper type safety and autocomplete |
| DEV-003 | Developer Console with Debugging | S | ⬜ | v2.1 | 4 | Add developer console accessible from extension with real-time logs of RPC calls, policy evaluations, signing operations, and message passing for debugging integrations |
| DEV-004 | Test Mode with Mock Signatures | S | ⬜ | v2.1 | 4 | Add developer test mode that allows mock signing without real keys, deterministic signatures for testing, and simulation of various scenarios (locked, denied, etc.) |
| DEV-005 | Integration Testing Helpers | S | ⬜ | v2.1 | 4 | Provide integration testing utilities for dApp developers: mock Ostrilo provider, test fixtures, and example test suites demonstrating proper integration patterns |
| DEV-006 | API Documentation Website | M | 🔄 | v2.0 | 4 | Build comprehensive API documentation website with interactive examples, code snippets in multiple frameworks, migration guides, and best practices |
| DEV-007 | SDK for Common Frameworks | S | ⬜ | v2.1 | 4 | Develop official SDKs/adapters for popular frameworks (React, Vue, Svelte, Angular) providing hooks, components, and utilities for seamless Ostrilo integration |
| DEV-008 | Webhook Support for Events | C | ⬜ | v2.2 | 4 | Implement webhook notifications for local development allowing dApps to receive events when signing occurs, permissions change, or user locks/unlocks |
| DEV-009 | Browser DevTools Integration | C | ⬜ | v2.2 | 4 | Create custom browser DevTools panel for inspecting Ostrilo state, viewing policies, testing signing, and debugging permission issues |
| DEV-010 | API Versioning & Deprecation Policy | M | ⬜ | v2.0 | 4 | Implement clear API versioning with semantic version negotiation, deprecation warnings, and migration path documentation ensuring backward compatibility |
| DEV-011 | Performance Profiling Tools | C | ⬜ | v2.2 | 4 | Add performance profiling showing signing latency, policy evaluation time, and RPC message overhead to help developers optimize integrations |
| DEV-012 | Batch Signing API | S | ⬜ | v2.1 | 4 | Implement batch signing API allowing dApps to submit multiple events for approval in a single flow, reducing prompt fatigue for bulk operations |
| DEV-013 | Capability Detection API | M | ⬜ | v2.0 | 4 | Add capability detection API (window.nostr.capabilities) returning list of supported NIPs, features, and API versions for progressive enhancement |

---

## Epic 5: Performance & Reliability
**Strategic Importance:** HIGH  
**Target Version:** v2.0  
**Owner:** Performance Team

### Rationale
Performance and reliability are non-negotiable for a signing extension. Slow or unreliable operations frustrate users and harm the Nostr ecosystem's reputation.

### Requirements

| ID | Title | Priority | Status | Version | Epic | Description |
|----|-------|----------|--------|---------|------|--------------------------|
| PERF-001 | Sub-5ms Signing Operations | S | ⬜ | v2.0 | 5 | Optimize signing performance targeting ≤5ms P50 latency and ≤10ms P99 latency with benchmarks in CI measuring schnorr signature generation and event serialization |
| PERF-002 | Lazy Loading & Code Splitting | S | ⬜ | v2.0 | 5 | Implement code splitting and lazy loading for UI routes reducing initial bundle size, loading components on-demand, and improving extension startup time |
| PERF-003 | Background Script Optimization | M | 🔄 | v2.0 | 5 | Optimize background script bundle size to ≤150KB gzipped through tree-shaking, dependency optimization, and removing unused code, with CI size checks |
| PERF-004 | Memory Leak Detection | M | ⬜ | v2.0 | 5 | Add automated memory leak detection in CI/CD using heap snapshots, monitoring for leaked event listeners, retained closures, and unbounded caches |
| PERF-005 | Efficient Storage Patterns | S | 🔄 | v2.0 | 5 | Optimize storage access patterns with batching, debouncing, and strategic caching reducing chrome.storage API calls and improving responsiveness |
| PERF-006 | Connection Pooling for Relays | S | 🔄 | v2.1 | 5 | Implement relay connection pooling and reuse for profile fetching and list operations, maintaining persistent WebSocket connections with automatic reconnection |
| PERF-007 | Signature Caching | S | ⬜ | v2.1 | 5 | Implement intelligent signature caching for idempotent events (kind 0 profile updates) with cache invalidation and TTL to avoid redundant signing |
| PERF-008 | Service Worker Lifecycle Management | M | 🔄 | v2.0 | 5 | Properly manage service worker lifecycle in Chrome MV3 with persistence strategies for critical state, ensuring vault remains unlocked during service worker restarts |
| PERF-009 | Bundle Analysis Dashboard | S | ⬜ | v2.0 | 5 | Integrate bundle analysis tools (webpack-bundle-analyzer) in CI generating reports on bundle composition, detecting bloat, and tracking size trends over time |
| PERF-010 | Startup Time Optimization | M | ⬜ | v2.0 | 5 | Optimize extension startup time measuring time-to-interactive, deferring non-critical initialization, and reducing synchronous storage reads |
| PERF-011 | Policy Evaluation Caching | S | ⬜ | v2.0 | 5 | Implement policy evaluation result caching with cache warming and invalidation on policy changes, reducing repeated policy computations |

---

## Epic 6: Multi-Device & Sync
**Strategic Importance:** MEDIUM  
**Target Version:** v2.1-v2.2  
**Owner:** Platform Team

### Rationale
Users increasingly work across multiple devices. Seamless sync of settings, trusted origins, and (optionally) encrypted keys dramatically improves the multi-device experience.

### Requirements

| ID | Title | Priority | Status | Version | Epic | Description |
|----|-------|----------|--------|---------|------|--------------------------|
| SYNC-001 | Settings & Policy Sync | S | 🔄 | v2.1 | 6 | Implement cross-device settings sync using browser sync storage (chrome.storage.sync) for theme, auto-lock settings, and origin policies (excluding private keys) |
| SYNC-002 | Encrypted Key Backup to Cloud | C | ⬜ | v2.2 | 6 | Add optional encrypted key backup to user-controlled cloud storage (Nostr events, IPFS, user's server) with strong encryption and master password |
| SYNC-003 | QR Code Key Transfer | S | ⬜ | v2.1 | 6 | Implement secure QR code-based key transfer between devices using ephemeral encryption, time-limited tokens, and visual confirmation |
| SYNC-004 | Key Restoration from Seed Phrase | C | ⬜ | v2.2 | 6 | Add optional BIP39 seed phrase support for key generation and restoration enabling familiar backup/restore flow for crypto users |
| SYNC-005 | Profile Sync via Nostr Events | C | ⬜ | v2.2 | 6 | Store extension settings as encrypted Nostr events (private relay or user's relays) enabling true decentralized sync across devices without browser vendor dependency |
| SYNC-006 | Conflict Resolution Strategy | S | ⬜ | v2.1 | 6 | Implement conflict resolution for synced settings using last-write-wins with timestamps, merge strategies for policies, and user notification for conflicts |

---

## Epic 7: Privacy-Preserving Features
**Strategic Importance:** MEDIUM  
**Target Version:** v2.1-v2.2  
**Owner:** Privacy Team

### Rationale
Privacy is a core Nostr value. Advanced privacy features differentiate Ostrilo and enable use cases where anonymity and metadata protection are critical.

### Requirements

| ID | Title | Priority | Status | Version | Epic | Description |
|----|-------|----------|--------|---------|------|--------------------------|
| PRIV-001 | Anonymous Event Signing | C | ⬜ | v2.2 | 7 | Implement anonymous event signing with ephemeral keys (single-use, not linked to main identity) for posting without identity attribution |
| PRIV-002 | Tor/I2P Relay Support | C | ⬜ | v2.3 | 7 | Add support for connecting to relays via Tor (.onion addresses) or I2P for enhanced privacy and censorship resistance |
| PRIV-003 | Metadata Minimization Mode | S | ⬜ | v2.1 | 7 | Add privacy mode that strips optional metadata from events (client tags, geotags) and randomizes timing of submissions to reduce fingerprinting |
| PRIV-004 | Origin Cloaking for Sensitive Sites | C | ⬜ | v2.2 | 7 | Allow users to mask origin in signed events (generic client tag) when using privacy-sensitive applications to prevent usage pattern analysis |
| PRIV-005 | Local-Only Mode | S | ⬜ | v2.1 | 7 | Add airplane/offline mode disabling all network operations (relay connections, profile fetching) for complete airgapped signing |
| PRIV-006 | Decoy Traffic Generation | C | ⬜ | v2.3 | 7 | Optionally generate decoy relay traffic (cover traffic) to obscure real usage patterns from network observers |

---

## Epic 8: Advanced Key Management
**Strategic Importance:** MEDIUM  
**Target Version:** v2.1-v2.2  
**Owner:** Security Team

### Rationale
Sophisticated users need advanced key management features like hierarchical keys, rotation policies, and emergency access to maintain security hygiene and prepare for key compromise.

### Requirements

| ID | Title | Priority | Status | Version | Epic | Description |
|----|-------|----------|--------|---------|------|--------------------------|
| KEYMGMT-001 | Key Rotation & Migration | S | ⬜ | v2.1 | 8 | Implement key rotation workflow allowing users to migrate followers and data to new key, publishing rotation event (proposed NIP), and deprecating old key |
| KEYMGMT-002 | Hierarchical Deterministic Keys | C | ⬜ | v2.2 | 8 | Support BIP32-style HD key derivation from master seed, generating multiple Nostr identities from single backup |
| KEYMGMT-003 | Sub-Keys for Specific Purposes | C | ⬜ | v2.2 | 8 | Implement sub-key system where master key can delegate limited signing authority to sub-keys (e.g., posting-only key, reaction-only key) |
| KEYMGMT-004 | Key Compromise & Revocation | S | ⬜ | v2.1 | 8 | Add key revocation flow publishing revocation event, notifying followers, providing guidance for key compromise scenarios |
| KEYMGMT-005 | Emergency Access & Dead Man's Switch | C | ⬜ | v2.3 | 8 | Implement emergency access system allowing trusted contact to recover account after specified inactivity period (Shamir's Secret Sharing) |
| KEYMGMT-006 | Key Strength Indicator | S | ⬜ | v2.1 | 8 | Display key security strength in UI showing encryption algorithm, key length, last rotation date, and recommendations for upgrades |
| KEYMGMT-007 | Master Password Change | M | ⬜ | v2.0 | 8 | Implement secure master password change requiring current password, re-encrypting all stored keys with new password-derived key |
| KEYMGMT-008 | Import/Export with Standard Formats | S | 🔄 | v2.1 | 8 | Support standard import/export formats: nsec, hex, encrypted JSON, NIP-XX key export format for interoperability with other clients |
| KEYMGMT-009 | NIP-49 ncryptsec Import | S | ⬜ | v2.0 | 8 | Accept a NIP-49 `ncryptsec` (scrypt + XChaCha20-Poly1305) at import, with its own passphrase, so a user moving from another signer does not have to expose a bare nsec to do it. Import only; `ncryptsec` export belongs to KEYMGMT-008, and seed-phrase restoration stays SYNC-004. Needs scrypt and XChaCha20-Poly1305 behind crypto ports, and a KDF-parameter ceiling on untrusted input. Added from the 2026-09-25 competitor review. |

---

## Epic 9: Social & Discovery Features
**Strategic Importance:** MEDIUM  
**Target Version:** v2.2+  
**Owner:** Product Team

### Rationale
While primarily a signing extension, integrating lightweight social features enhances utility and helps users discover and manage their Nostr identity without leaving the extension.

### Requirements

| ID | Title | Priority | Status | Version | Epic | Description |
|----|-------|----------|--------|---------|------|--------------------------|
| SOCIAL-001 | Contact List Management | C | ⬜ | v2.2 | 9 | Display and manage contact list (kind 3) within extension, showing following count, recent follows, with ability to follow/unfollow |
| SOCIAL-002 | Relay Recommendations | C | ⬜ | v2.2 | 9 | Provide intelligent relay recommendations based on user's network, geographic location, relay performance metrics, and community ratings |
| SOCIAL-003 | Identity Verification Status | S | ⬜ | v2.1 | 9 | Display comprehensive identity verification status showing NIP-05 verification, domain ownership, web of trust score, and badges |
| SOCIAL-004 | Web of Trust Integration | C | ⬜ | v2.2 | 9 | Integrate web of trust calculations showing trust scores for origins based on who vouches for them, warning when signing for low-trust entities |
| SOCIAL-005 | Notification Preferences | C | ⬜ | v2.2 | 9 | Add notification filtering allowing users to configure which events trigger browser notifications, with mute/unmute per origin |
| SOCIAL-006 | Profile QR Code Display | S | 🔄 | v2.1 | 9 | Generate and display profile QR codes encoding pubkey and recommended relays for easy sharing at events or with new connections |
| SOCIAL-007 | Recent Activity Feed | C | ⬜ | v2.2 | 9 | Add lightweight activity feed showing recent posts, reactions, and replies across configured relays, accessible from HomeView |

---

## Epic 10: Monitoring & Analytics
**Strategic Importance:** LOW  
**Target Version:** v2.2+  
**Owner:** Operations Team

### Rationale
Understanding extension health, usage patterns, and error rates enables data-driven improvements while respecting user privacy. All analytics must be privacy-preserving and opt-in.

### Requirements

| ID | Title | Priority | Status | Version | Epic | Description |
|----|-------|----------|--------|---------|------|--------------------------|
| MON-001 | Privacy-Preserving Telemetry | C | ⬜ | v2.2 | 10 | Implement opt-in privacy-preserving telemetry collecting aggregated usage metrics (feature usage, performance) without PII, using differential privacy |
| MON-002 | Error Reporting & Crash Analytics | S | ⬜ | v2.1 | 10 | Add opt-in error reporting sending anonymized stack traces and error context to Sentry or similar service for debugging production issues |
| MON-003 | Performance Monitoring | C | ⬜ | v2.2 | 10 | Implement performance monitoring tracking real-user metrics (signing latency, UI responsiveness) with percentile aggregations and alerting |
| MON-004 | Health Check Dashboard | C | ⬜ | v2.3 | 10 | Create public health dashboard showing extension uptime, relay connectivity status, known issues, and incident history |
| MON-005 | A/B Testing Framework | C | ⬜ | v2.3 | 10 | Implement privacy-preserving A/B testing framework enabling feature experiments and UX optimizations with statistical analysis |

---

## Implementation Roadmap

Treat this document as the progress ledger: every completed OpenSpec slice must update affected requirement statuses, the Current Implementation Snapshot, and roadmap gap lists before archival. Mark a requirement `✅` only when the full row wording is satisfied and verified; use `🔄` for narrower shipped slices.

### Status Legend

- ✅ Implemented in the current repository
- 🔄 Implemented partially or narrower than the requirement wording
- ⬜ Planned, deferred, or not started
- ❌ Removed or explicitly out of scope

### Implemented Foundation

The current codebase has delivered a strong signer foundation rather than the full original v2.0 scope.

- ✅ **Core signer:** NIP-07 `getPublicKey` and `signEvent`, background-only signing, event validation, policy evaluation, and canonical RPC error codes inside the extension.
- ✅ **Approval workflow:** managed approval window, pending queue, event de-duplication, full event detail view, bulk deny, timeouts, and Activity-page re-entry.
- ✅ **Identity management:** multiple encrypted keys, active key selector, create/import/add-key flows, rename/delete/set-active actions, profile-aware key display, and last-key deletion guard.
- ✅ **Profile and relays:** NIP-01 kind:0 profile fetch/cache/display/edit/publish, relay list settings, multi-relay query/publish handling, and local profile cache.
- ✅ **Settings surfaces:** popup Basic Settings, full Options Page, tab navigation, URL hash deep links, local settings sync between popup/options, relay settings, policy settings, and activity-log controls.
- ✅ **Theme:** light/dark/system theme selection with live system-preference updates across extension UI surfaces. Only the system-preference mode of UX-015 has shipped.
- ✅ **Session lock:** fail-closed lock state, an enforced 1-60 minute auto-lock that slides on deliberate activity and on auto-signs made while the user is present, a countdown readout, and password re-authentication for sensitive changes (graduated tiers remain open under SEC-012).
- ✅ **Testing and tooling:** Vitest coverage across domain/application/infrastructure/UI/security under enforced thresholds, Playwright coverage of the Tier-1 journeys, an agent-driven E2E loop with console capture, a dual-theme design-review runner that photographs populated state as well as a fresh vault, WXT Chrome/Firefox build targets, and a CI verification gate (typecheck, lint, tests with coverage thresholds, both builds, built-output security assertions, dependency audit, gitleaks), plus the aislop gate and React Doctor.

### Foundation Gaps

These items should be treated as the next hardening priority before claiming the original v2.0 foundation complete.

- 🔄 **Security hardening:** finish secure UI input isolation (the realm split), complete zeroization coverage for sensitive UI paths, meter auto-signed requests (SEC-006), and offer backup/export for every key rather than only the first (SEC-011, KEYMGMT-008).
- 🔄 **Security automation:** CSP and build-output validation now run in CI against freshly built output, the dependency audit blocks on high and critical, and gitleaks scans for committed secrets (SEC-005). Still missing: a background bundle-size gate and trend tracking (PERF-003, PERF-009), memory-leak detection (PERF-004), and a reproducible-build check (SEC-017).
- 🔄 **Approval intelligence:** keep the current detail-first approval UI and its per-kind consequence sentences, then add previews parsed from the event and risk analysis for zaps, DMs, relay changes, and high-risk event kinds.
- 🔄 **Activity experience:** fix the export above 100 entries, build the origin filter from the whole log rather than the loaded page, let the kind filter reach protected kinds, then add full-text search, result and date-range filtering, and CSV export.
- 🔄 **Accessibility:** token contrast now meets AA on its intended surfaces and the timeout sliders are operable and named; broaden existing keyboard/ARIA coverage into a repo-wide WCAG 2.1 AA audit, automated axe checks, and a remediation pass.
- 🔄 **Developer surface:** the page boundary still leaks three non-canonical error strings, and `docs/rpc-error-codes.md` describes an old response shape (DEV-001). Formal TypeScript definitions, capability detection, an API versioning/deprecation policy, and a real documentation site are not started.
- ⬜ **Protocol depth:** implement NIP-44, NIP-42, NIP-57 validation, NIP-65 relay lists, and NIP-05 DNS verification instead of relying on generic event signing. NIP-04 is out of scope.

### Advanced Roadmap

The original v2.1+ epics remain mostly future work.

- 🔄 **Sync:** settings are stored in browser sync storage, so browser sync already copies them between devices, and local contexts update live. Conflict resolution, quota safety, excluding device-local fields, and NIP-78/decentralized sync remain open.
- 🔄 **Relay performance:** relay adapters reuse open WebSocket connections and reconnect with capped backoff, but every `appSettings` write, including a theme change, currently drops every relay socket. Rebuilding only on a relay-list change, a keepalive policy and metrics remain open.
- 🔄 **Import/export:** nsec/hex import, a one-time key reveal inside the create-key flow, and an encrypted backup file exist; the backup is offered while creating the first key and restored from the onboarding import step. Backing up a key added later, importing a backup file outside onboarding, hex and NIP-49 export, and an export control in Settings remain open. The background `vault.reveal` already takes a `keyId`, so the gap is in the UI.
- 🔄 **Profile QR:** the QR encodes the bare `npub`; a profile-sharing QR (`nostr:nprofile…` with recommended relays) is not built.
- ⬜ **Advanced security:** HSM/WebAuthn key storage, biometric unlock, MFA, sandboxed crypto workers, phishing blocklists, and tamper-evident audit logs remain future work.
- ⬜ **Advanced protocol/social/privacy/monitoring:** NIP-46, NIP-26, NIP-59, NIP-51, NIP-98, NIP-13, social discovery, Tor/I2P, privacy modes, telemetry, crash analytics, and public health dashboards are not implemented. The published privacy policy currently promises no analytics, telemetry or crash reports, so MON-001 to MON-003 cannot ship without changing it.

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

## Appendix A: Glossary

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

## Appendix B: References

1. Nostr Protocol Specification: https://github.com/nostr-protocol/nips
2. Web Extension APIs: https://developer.chrome.com/docs/extensions/
3. WCAG 2.1 Guidelines: https://www.w3.org/WAI/WCAG21/quickref/
4. OWASP Browser Security: https://owasp.org/www-project-web-security-testing-guide/
5. Noble Cryptography: https://github.com/paulmillr/noble-curves
6. OpenSpec Project Context: openspec/project.md

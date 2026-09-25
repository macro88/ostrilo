# Profile Metadata Management - OpenSpec Proposal Summary

## ✅ Proposal Status: Complete & Validated

The OpenSpec proposal for profile metadata management has been created and successfully validated in strict mode.

## 📁 Created Artifacts

### 1. `proposal.md` (2,400+ words)
**Location:** `openspec/changes/add-profile-metadata-management/proposal.md`

Comprehensive change proposal covering:
- **Problem Statement:** Current ProfileView displays static placeholder data, no integration with Nostr protocol
- **Solution Overview:** ProfileService + relay integration + local caching with TTL + multi-identity support
- **Implementation Phases:**
  - Phase 1: Core Infrastructure (Domain + Application layers)
  - Phase 2: Infrastructure Layer (Relay adapter)
  - Phase 3: UI Integration (ProfileView)
  - Phase 4: Multi-Key Profile Awareness
- **Risk Mitigation:** Bundle size, WebSocket complexity, service worker lifecycle, relay failures
- **Success Criteria:** Profile fetching, caching, editing, publishing, multi-identity foundation

---

### 2. `design.md` (3,000+ words)
**Location:** `openspec/changes/add-profile-metadata-management/design.md`

Detailed technical architecture document:
- **Hexagonal Architecture Alignment:** Clear separation of Domain, Application, Infrastructure, UI layers
- **ProfileService Design:**
  - `getProfile(pubkey, forceFetch?)` - Cache-first strategy with TTL
  - `getAllProfiles()` - Fetch for all managed keys
  - `updateProfile(metadata)` - Validate, sign, publish
  - `clearCache(pubkey?)` - Manual cache management
- **INostrRelay Port Interface:** Abstraction for relay communication (subscribe, publish, close, disconnect)
- **NostrRelayAdapter Implementation:** WebSocket-based relay client with reconnection logic
- **Caching Strategy:**
  - Storage: `profileCache:{pubkey}` in local storage
  - TTL: 1 hour (3600s) default
  - Eviction: LRU with 50-entry limit
  - Per-pubkey isolation for multi-identity
- **Data Models:**
  - `ProfileMetadata` (NIP-01 kind:0 fields)
  - `ProfileCacheEntry` (metadata + fetchedAt + ttl)
  - Zod validation schemas
- **Multi-Relay Query Strategy:** Parallel queries, highest created_at wins, partial failure handling
- **Error Handling:** Invalid JSON, validation failures, relay timeouts, publish failures
- **Security Considerations:** Private key isolation, URL sanitization, untrusted content handling
- **Service Worker Lifecycle:** Stateless restart handling, cache persistence

---

### 3. `tasks.md` (38 tasks, 75-80 hours estimated)
**Location:** `openspec/changes/add-profile-metadata-management/tasks.md`

Detailed implementation checklist organized into 7 phases:

**Phase 1: Core Infrastructure** (4 tasks, ~13 hours)
- Define ProfileMetadata domain types with Zod validation
- Define INostrRelay port interface
- Implement ProfileService with caching and relay integration
- Write ProfileService unit tests (16 test scenarios)

**Phase 2: Infrastructure Layer** (3 tasks, ~14 hours)
- Implement NostrRelayAdapter with WebSocket, reconnection, service worker handling
- Write integration tests for relay adapter
- Integrate adapter with ProfileService multi-relay strategy

**Phase 3: UI Layer** (4 tasks, ~18 hours)
- Update ProfileView display mode to fetch and render real profiles
- Implement ProfileView edit mode with validation
- Add profile picture upload (optional enhancement)
- Write ProfileView component tests

**Phase 4: Multi-Key Profile Awareness** (3 tasks, ~5 hours)
- Display profile for selected key
- Handle key switching (future integration point)
- Verify distinct cache per pubkey

**Phase 5: End-to-End Testing** (2 tasks, ~8 hours)
- E2E tests for profile viewing (cached, fresh fetch, offline mode)
- E2E tests for profile editing (validation, publish, cancel, errors)

**Phase 6: Performance & Security** (4 tasks, ~5 hours)
- Validate bundle size impact (≤ 10KB gzipped)
- Validate storage efficiency (≤ 100KB for 50 profiles)
- Validate network efficiency (zero queries for cached, limit:1 for fresh)
- Security audit (private key isolation, URL sanitization, XSS prevention)

**Phase 7: Documentation & Deployment** (4 tasks, ~9 hours)
- Update documentation (README, developer docs, architecture diagrams)
- Validate against spec requirements
- Final testing & QA (Chrome + Firefox)
- Prepare for deployment (version bump, packaging, release notes)

**Critical Path:** Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7

---

### 4. `specs/profile-metadata/spec.md` (15 requirements, 50+ scenarios)
**Location:** `openspec/changes/add-profile-metadata-management/specs/profile-metadata/spec.md`

Comprehensive specification with 15 ADDED requirements:

1. **Profile Metadata Type Definition** - Standard fields, validation constraints
2. **Profile Cache Entry Structure** - Metadata + timing information
3. **Profile Service** - Get, update, cache management operations (8 scenarios)
4. **Nostr Relay Port Interface** - Abstraction for relay operations (3 scenarios)
5. **Nostr Relay Adapter Implementation** - WebSocket client, reconnection, service worker handling (4 scenarios)
6. **Profile Cache Storage** - TTL, eviction, manual clearing (4 scenarios)
7. **ProfileView UI Integration** - Display, edit, publish modes (4 scenarios)
8. **Multi-Key Profile Awareness** - Per-pubkey profiles, key switching, cache isolation (3 scenarios)
9. **Relay Query Strategy** - Multi-relay parallel queries, timeout, partial failures (3 scenarios)
10. **Error Handling** - Invalid JSON, validation failures, relay failures, publish failures (4 scenarios)
11. **Performance Optimization** - Bundle size, storage efficiency, network efficiency (3 scenarios)
12. **Security Considerations** - Private key isolation, URL sanitization, untrusted content (3 scenarios)
13. **Testing Coverage** - Unit, integration, E2E test scenarios (3 scenarios)

Each requirement includes multiple scenarios with GIVEN-WHEN-THEN format.

---

## 🎯 Alignment with Requirements

This proposal directly addresses **UX-002** from `docs/v2-prd.md`:
- ✅ Profile Metadata Fetching & Display
- ✅ NIP-01 kind:0 event handling
- ✅ Configured relay integration
- ✅ Local caching with TTL
- ✅ Display name/picture/about/website in ProfileView
- ✅ Profile editing and publishing capability
- ✅ Multi-identity foundation (per-pubkey profiles)

---

## 🏗️ Architectural Alignment

**Hexagonal Architecture:**
- **Domain Layer:** ProfileMetadata types, validation schemas
- **Application Layer:** ProfileService (business logic), INostrRelay port
- **Infrastructure Layer:** NostrRelayAdapter (WebSocket implementation), storage adapters
- **UI Layer:** ProfileView component (display + edit modes)

**Follows Existing Patterns:**
- Port/Adapter pattern (like ICryptoProvider)
- Service-based architecture (like KeyVaultService)
- Storage abstraction (like SettingsService)
- Caching with TTL (like activity log ring buffer)

---

## 📊 Validation Results

```bash
openspec validate add-profile-metadata-management --strict
```

**Result:** ✅ Change 'add-profile-metadata-management' is valid

All requirements met:
- ✅ proposal.md exists with problem/solution/phases
- ✅ design.md exists with detailed architecture
- ✅ tasks.md exists with verifiable implementation checklist
- ✅ Spec deltas use ADDED Requirements format
- ✅ Each requirement has at least one Scenario
- ✅ Scenarios use GIVEN-WHEN-THEN format
- ✅ No validation errors in strict mode

---

## 🚀 Next Steps

### Immediate (Awaiting Approval)
1. **Review proposal documents** - Ensure alignment with your vision
2. **Provide feedback** - Request changes or approve to proceed
3. **Approve implementation** - Give green light to start Phase 1

### After Approval (Implementation)
1. **Phase 1:** Domain types + ProfileService + unit tests (~13 hours)
2. **Phase 2:** NostrRelayAdapter + integration tests (~14 hours)
3. **Phase 3:** ProfileView UI integration + component tests (~18 hours)
4. **Phase 4:** Multi-key awareness (~5 hours)
5. **Phase 5:** E2E tests (~8 hours)
6. **Phase 6:** Performance & security validation (~5 hours)
7. **Phase 7:** Documentation & deployment (~9 hours)

**Total Estimated Effort:** 75-80 hours (2-3 weeks for single developer)

---

## 📋 Key Decisions Made

1. **Caching Strategy:** 1-hour TTL, LRU eviction at 50 entries, per-pubkey isolation
2. **Relay Communication:** Custom WebSocket adapter (no nostr-tools to minimize bundle size)
3. **Multi-Relay Strategy:** Parallel queries, select event with highest created_at
4. **Validation:** Zod schemas with graceful partial profile handling
5. **Service Worker:** Accept stateless restart, rely on cache persistence
6. **Security:** URL sanitization, private key isolation, untrusted content handling
7. **Testing:** Unit (ProfileService), integration (relay adapter), E2E (ProfileView flows)
8. **Bundle Size Target:** ≤ 10KB gzipped for new functionality
9. **Storage Target:** ≤ 100KB for 50 cached profiles
10. **Multi-Identity:** Foundation for future key switcher (per-pubkey profiles, independent caching)

---

## 🔍 Files to Review

1. **`openspec/changes/add-profile-metadata-management/proposal.md`** - Start here for overview
2. **`openspec/changes/add-profile-metadata-management/design.md`** - Technical architecture deep-dive
3. **`openspec/changes/add-profile-metadata-management/tasks.md`** - Implementation checklist
4. **`openspec/changes/add-profile-metadata-management/specs/profile-metadata/spec.md`** - Requirements and scenarios

---

## ✅ Proposal Complete

**Status:** Ready for review and approval  
**Validation:** Passed strict mode  
**Estimated Implementation:** 2-3 weeks  
**Risk Level:** Medium (WebSocket complexity, service worker lifecycle)  
**Value:** High (enables real Nostr identity integration, multi-identity foundation)

**Awaiting your approval to proceed with implementation! 🚀**

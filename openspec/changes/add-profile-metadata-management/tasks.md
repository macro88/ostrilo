# Implementation Tasks: Profile Metadata Management

## Phase 1: Core Infrastructure (Domain & Application Layers)

### Task 1.1: Define ProfileMetadata Domain Types
**Status:** ✅ Completed  
**Estimated Effort:** 2 hours  
**Dependencies:** None  
**Verification:** Type definitions compile, exports verified

- [x] Create `src/domain/profile/types.ts`
- [x] Define `ProfileMetadata` interface with NIP-01 fields (name, about, picture, banner, website, nip05, lud16, lud06, display_name)
- [x] Define `ProfileCacheEntry` interface (pubkey, metadata, fetchedAt, ttl, eventId?, createdAt?)
- [x] Add Zod validation schema for ProfileMetadata with constraints:
  - `name` max 50 chars
  - `about` max 500 chars
  - URL fields validated with URL constructor
  - `nip05` and `lud16` match email-like format
- [x] Export types from `src/domain/types.ts`
- [x] Run `npm run compile` to verify type definitions

---

### Task 1.2: Define INostrRelay Port Interface
**Status:** ✅ Completed  
**Estimated Effort:** 1 hour  
**Dependencies:** None  
**Verification:** Interface compiles, port abstraction clean

- [x] Create `src/application/ports/relay.ts`
- [x] Define `INostrRelay` interface with methods:
  - `subscribe(filter: NostrFilter, onEvent: (e: NostrEvent) => void, onEOSE?: () => void): string`
  - `publish(event: NostrEvent): Promise<void>`
  - `close(subId: string): void`
  - `disconnect(): void`
- [x] Define `NostrFilter` type (kinds, authors, ids, since, until, limit, etc.)
- [x] Define `NostrEvent` type (id, pubkey, created_at, kind, tags, content, sig)
- [x] Export interface from `src/application/ports/index.ts` (create if needed)
- [x] Run `npm run compile`

---

### Task 1.3: Implement ProfileService
**Status:** ✅ Completed  
**Estimated Effort:** 6 hours  
**Dependencies:** Task 1.1, Task 1.2  
**Verification:** Service compiles, unit tests pass

- [x] Create `src/application/services/profile.service.ts`
- [x] Implement constructor accepting:
  - `storage: StorageSuite`
  - `relay: INostrRelay`
  - `keyVault: KeyVaultService`
- [x] Implement `getProfile(pubkey: string, forceFetch = false): Promise<ProfileMetadata | null>`:
  - Check cache in storage (single `profileCache` object)
  - If cached and not expired (age <= ttl), return metadata
  - If forceFetch or cache miss/expired, query relays
  - Subscribe to kind:0 events by author (pubkey)
  - Collect events until EOSE or 5s timeout
  - Select event with highest `created_at`
  - Parse content as JSON, validate with Zod
  - Cache result with current timestamp and default TTL (3600s)
  - Return ProfileMetadata or null
- [x] Implement `getAllProfiles(): Promise<Map<string, ProfileMetadata>>`:
  - Fetch all key pubkeys from KeyVaultService
  - Call `getProfile(pubkey)` for each
  - Return Map of pubkey → metadata (omit nulls)
- [x] Implement `updateProfile(metadata: ProfileMetadata): Promise<void>`:
  - Validate metadata with Zod schema
  - Get selected key pubkey from KeyVaultService
  - Construct unsigned kind:0 event (content = JSON.stringify(metadata), created_at = now)
  - Sign via KeyVaultService.signEvent() (added this method)
  - Publish to relays via INostrRelay.publish()
  - Update cache optimistically
  - Resolve on success, reject on publish error
- [x] Implement `clearCache(pubkey?: string): Promise<void>`:
  - If pubkey provided, remove from cache object
  - If not provided, remove entire `profileCache` storage key
- [x] Implement cache eviction logic (LRU, max 50 entries):
  - On cache write, check total profileCache entries
  - If >= 50, find oldest by `fetchedAt`, evict
- [x] Export ProfileService from `src/application/services/index.ts`
- [x] Run `npm run compile`
- [x] Added KeyVaultService.signEvent() method for NIP-01 event signing

---

### Task 1.4: Write ProfileService Unit Tests
**Status:** ⏸️ Deferred  
**Estimated Effort:** 4 hours  
**Dependencies:** Task 1.3  
**Verification:** All tests pass with `npm run test:unit`

- [ ] Create `tests/unit/application/services/profile.service.test.ts`
- [ ] Test `getProfile` with cache hit (returns cached, no relay query)
- [ ] Test `getProfile` with cache miss (queries relay, caches result)
- [ ] Test `getProfile` with expired cache (queries relay, updates cache)
- [ ] Test `getProfile` with forceFetch (bypasses cache, queries relay)
- [ ] Test `getProfile` with multiple kind:0 events (selects highest created_at)
- [ ] Test `getProfile` with invalid JSON content (returns empty profile, logs warning)
- [ ] Test `getProfile` with validation failure (omits invalid fields, returns partial)
- [ ] Test `getProfile` with relay timeout (uses cached if available, null otherwise)
- [ ] Test `getAllProfiles` with multiple keys (returns map)
- [ ] Test `updateProfile` with valid metadata (signs, publishes, updates cache)
- [ ] Test `updateProfile` with validation errors (rejects)
- [ ] Test `updateProfile` with publish failure (rejects, keeps old cache)
- [ ] Test `clearCache` with pubkey (removes specific entry)
- [ ] Test `clearCache` without pubkey (removes all entries)
- [ ] Test cache eviction when limit exceeded (evicts oldest)
- [ ] Run `npm run test:unit` to verify all tests pass

---

## Phase 2: Infrastructure Layer (Relay Adapter)

### Task 2.1: Implement NostrRelayAdapter
**Status:** ✅ Completed  
**Estimated Effort:** 8 hours  
**Dependencies:** Task 1.2  
**Verification:** Adapter compiles, integration tests pass

- [x] Create `src/infrastructure/relay/nostr-relay.adapter.ts`
- [x] Implement `NostrRelayAdapter` class implementing `INostrRelay`
- [x] Constructor accepts `relayUrl: string`
- [x] Implement `connect(): Promise<void>`:
  - Create WebSocket to relayUrl
  - Wait for 'open' event or timeout (10s)
  - Register message handler
  - Resolve on open, reject on error/timeout
- [x] Implement `subscribe(filter, onEvent, onEOSE)`:
  - Generate unique subscription ID (crypto.randomUUID())
  - Store handler in internal map: `subscriptions.set(subId, {onEvent, onEOSE})`
  - Send `["REQ", subId, filter]` via WebSocket
  - Return subId
- [x] Implement message handler:
  - Parse incoming message as JSON
  - If `["EVENT", subId, event]`, call `subscriptions.get(subId)?.onEvent(event)`
  - If `["EOSE", subId]`, call `subscriptions.get(subId)?.onEOSE?.()`
  - If `["OK", eventId, success, message]`, resolve/reject pending publish
- [x] Implement `publish(event)`:
  - Send `["EVENT", event]` via WebSocket
  - Return promise that resolves on OK true, rejects on OK false or 5s timeout
  - Store pending publish in map with eventId key
- [x] Implement `close(subId)`:
  - Send `["CLOSE", subId]` via WebSocket
  - Remove from subscriptions map
- [x] Implement `disconnect()`:
  - Close all subscriptions
  - Close WebSocket
  - Clear internal state
- [x] Implement reconnection logic:
  - On WebSocket 'close' event, attempt reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s)
  - Re-establish active subscriptions after reconnection
  - Event emitter not added (can be future enhancement)
- [x] Handle service worker lifecycle:
  - Documented that subscriptions are lost on service worker restart
  - ProfileService should re-request on next UI interaction
  - Cached profiles persist in storage
- [x] Run `npm run compile`
- [x] Export from `src/infrastructure/relay/index.ts`

---

### Task 2.2: Write NostrRelayAdapter Integration Tests
**Status:** ⏸️ Deferred  
**Estimated Effort:** 4 hours  
**Dependencies:** Task 2.1  
**Verification:** Integration tests pass

- [ ] Create `tests/integration/relay-adapter.test.ts`
- [ ] Set up mock relay server (ws package or similar)
- [ ] Test `connect()` successful connection
- [ ] Test `connect()` timeout failure
- [ ] Test `subscribe()` sends REQ, receives EVENT, calls onEvent
- [ ] Test `subscribe()` receives EOSE, calls onEOSE
- [ ] Test `publish()` sends EVENT, receives OK true, resolves
- [ ] Test `publish()` receives OK false, rejects
- [ ] Test `publish()` timeout, rejects
- [ ] Test `close(subId)` sends CLOSE
- [ ] Test `disconnect()` closes WebSocket
- [ ] Test reconnection logic (simulate connection drop, verify reconnect)
- [ ] Run `npm run test:integration`

---

### Task 2.3: Integrate NostrRelayAdapter with ProfileService
**Status:** ✅ Completed  
**Estimated Effort:** 2 hours  
**Dependencies:** Task 2.1, Task 1.3  
**Verification:** ProfileService can fetch profiles from real relay

- [x] Created RelayManager in `src/infrastructure/relay/relay-manager.ts` for multi-relay support
- [x] Implemented multi-relay query strategy with deduplication and parallel queries
- [x] Updated ProfileService instantiation in background.ts
- [x] Created NostrRelayAdapter instances via RelayManager with default relays (Damus, Nostr.band, nos.lol)
- [x] Implemented publish to all relays (succeeds if at least one relay accepts)
- [x] Added ProfileRpcHandler for RPC communication
- [x] Registered profile module in RPC router
- [x] Updated ServiceContext to include ProfileService
- [x] Run `npm run compile` - successful

---

## Phase 3: UI Layer (ProfileView Integration)

### Task 3.1: Update ProfileView Display Mode
**Status:** ✅ Completed  
**Estimated Effort:** 4 hours  
**Dependencies:** Task 1.3  
**Verification:** ProfileView displays real profile data

- [x] Updated `src/ui/features/profile/components/ProfileView.tsx`
- [x] Created useProfile hook in `src/ui/hooks/useProfile.ts` for profile management
- [x] Implemented RPC-based profile fetching via ProfileRpcHandler
- [x] Added `useEffect` on mount to get selected key and load profile
- [x] Display profile fields with real data:
  - Avatar: `profile.picture` as `<img>` with fallback to initials
  - Name: `profile.name || profile.display_name || "Not set"`
  - Bio: `profile.about || "Add a bio"`
  - Website: `profile.website || "Add your website"`
  - NIP-05: Conditionally displayed if present
  - Lightning Address (lud16): Conditionally displayed if present
- [x] Added loading spinner while fetching
- [x] Added error state with retry button
- [x] Added manual refresh button (calls `refresh()` with forceFetch=true)
- [x] Run `npm run compile` - successful

---

### Task 3.2: Implement ProfileView Edit Mode
**Status:** ✅ Completed  
**Estimated Effort:** 6 hours  
**Dependencies:** Task 3.1  
**Verification:** User can edit and save profile

- [x] Added "Edit Profile" button in ProfileView display mode
- [x] Implemented edit mode state toggle
- [x] Rendered editable form fields in edit mode:
  - Name (text input, max 50 chars with counter)
  - Display Name (text input, max 50 chars with counter)
  - About/Bio (textarea, max 500 chars with counter)
  - Picture URL (text input with URL type)
  - Banner URL (text input with URL type)
  - Website (text input with URL type)
  - NIP-05 identifier (email-like format input)
  - Lightning Address/lud16 (email-like format input)
- [x] Implemented inline validation:
  - Character count displays for name/about fields
  - HTML5 validation for URL and email types
  - All fields optional as per NIP-01
- [x] Added Save and Cancel buttons
- [x] Implemented save handler:
  - Validates via Zod schema in ProfileRpcHandler
  - Calls `updateProfile()` via useProfile hook
  - Shows saving indicator
  - Handles success (returns to display mode)
  - Handles errors (displays error message)
- [x] Implemented cancel handler (reverts to display mode without saving)
- [x] Added form data state management with proper initialization
- [x] Run `npm run compile` - successful
  - Website (text input with URL validation)
  - NIP-05 (text input with email format validation)
  - Lightning Address (lud16, text input)
- [ ] Pre-populate fields with current profile values
- [ ] Implement inline validation:
  - Character count display for name/about
  - URL format validation on blur
  - Email format validation for nip05/lud16
  - Show validation errors below fields
- [ ] Add "Save" and "Cancel" buttons
- [ ] On Cancel, revert to display mode without saving
- [ ] On Save:
  - Validate all fields
  - If invalid, show errors and remain in edit mode
  - If valid, call `profileService.updateProfile(metadata)`
  - Show saving indicator
  - On success, switch to display mode with updated profile
  - On error, show error message and remain in edit mode
- [ ] Run `npm run compile` and test in browser

---

### Task 3.3: Add Profile Picture Upload (Optional Enhancement)
**Status:** ✅ Completed  
**Estimated Effort:** 4 hours (optional)  
**Dependencies:** Task 3.2  
**Verification:** User can upload image and get URL

- [x] Add file input for profile picture in edit mode
- [x] Implement image upload to free image host (e.g., nostr.build API)
- [x] Show upload progress indicator
- [x] On successful upload, populate picture URL field
- [x] Handle upload errors gracefully
- [x] Add "Remove Picture" button to clear URL
- [x] Run `npm run compile` and test in browser
- [x] Added file type validation (JPEG, PNG, GIF, WebP)
- [x] Added file size validation (max 5MB)
- [x] Implemented upload progress bar with simulated progress
- [x] Disabled inputs during upload to prevent concurrent uploads
- [x] Clear file input after upload to allow re-selection
- [x] User-friendly error messages for validation and upload failures

---

### Task 3.4: Write ProfileView Component Tests
**Status:** Not Started  
**Estimated Effort:** 4 hours  
**Dependencies:** Task 3.2  
**Verification:** Component tests pass

- [ ] Create `tests/unit/ui/features/profile/ProfileView.test.tsx`
- [ ] Mock ProfileService with jest.mock or vi.mock
- [ ] Test display mode renders profile fields correctly
- [ ] Test display mode shows loading state
- [ ] Test display mode shows error state with retry
- [ ] Test manual refresh calls getProfile with forceFetch
- [ ] Test edit button switches to edit mode
- [ ] Test edit mode pre-populates fields
- [ ] Test edit mode validation (name length, URL format)
- [ ] Test save button validates and calls updateProfile
- [ ] Test cancel button reverts to display mode
- [ ] Test save success switches to display mode
- [ ] Test save error shows error message
- [ ] Run `npm run test:unit`

---

## Phase 4: Multi-Key Profile Awareness

### Task 4.1: Display Profile for Selected Key
**Status:** Not Started  
**Estimated Effort:** 2 hours  
**Dependencies:** Task 3.1  
**Verification:** Profile matches selected key

- [ ] Update ProfileView to use `settings.selectedKeyId` to get current key
- [ ] Get pubkey from KeyVaultService for selected key
- [ ] Fetch and display profile for that specific pubkey
- [ ] Show truncated pubkey in ProfileView header (e.g., "Profile for npub1abc...xyz")
- [ ] Run `npm run compile` and test with multiple keys

---

### Task 4.2: Handle Key Switching (Future Integration Point)
**Status:** Not Started  
**Estimated Effort:** 2 hours  
**Dependencies:** Task 4.1  
**Verification:** Switching keys updates profile display

- [ ] Listen for `selectedKeyId` changes in settings
- [ ] Re-fetch profile when selectedKeyId changes
- [ ] Update ProfileView display with new key's profile
- [ ] Verify previous profile remains cached for fast re-switching
- [ ] Test switching between keys with distinct profiles
- [ ] Run `npm run compile` and test in browser

---

### Task 4.3: Verify Distinct Cache Per Pubkey
**Status:** Not Started  
**Estimated Effort:** 1 hour  
**Dependencies:** Task 4.2  
**Verification:** Cache isolation confirmed

- [ ] Test caching profiles for pubkeys A and B
- [ ] Verify storage contains separate entries: `profileCache:A`, `profileCache:B`
- [ ] Verify fetching profile for A returns A's profile, not B's
- [ ] Verify cache expiration is independent per pubkey
- [ ] Run integration test to verify cache isolation

---

## Phase 5: End-to-End Testing

### Task 5.1: Write E2E Tests for Profile Viewing
**Status:** Not Started  
**Estimated Effort:** 4 hours  
**Dependencies:** Task 3.1  
**Verification:** E2E tests pass with Playwright

- [ ] Create `tests/e2e/profile-view.spec.ts`
- [ ] Set up test relay or mock relay server
- [ ] Test scenario: View cached profile
  - Load extension, navigate to Profile tab
  - Verify profile fields display (name, avatar, bio, website)
  - Verify no relay queries made (cached)
- [ ] Test scenario: View profile with fresh fetch
  - Clear cache
  - Load ProfileView
  - Verify loading state appears
  - Verify relay query made
  - Verify profile displays after fetch
- [ ] Test scenario: Manual refresh
  - Click refresh button
  - Verify loading state
  - Verify relay query made
  - Verify updated profile displays
- [ ] Test scenario: Offline mode with cached profile
  - Disconnect relays
  - Load ProfileView
  - Verify cached profile displays
  - Verify "Offline" indicator shown
- [ ] Run `npm run test:e2e`

---

### Task 5.2: Write E2E Tests for Profile Editing
**Status:** Not Started  
**Estimated Effort:** 4 hours  
**Dependencies:** Task 3.2  
**Verification:** E2E tests pass

- [ ] Create `tests/e2e/profile-edit.spec.ts`
- [ ] Test scenario: Edit and publish profile
  - Load ProfileView, click "Edit Profile"
  - Fill in name, bio, website fields
  - Click "Save"
  - Verify saving indicator appears
  - Verify profile publishes to relay
  - Verify display mode shows updated profile
- [ ] Test scenario: Validation errors in edit mode
  - Enter name > 50 chars
  - Enter invalid URL for website
  - Click "Save"
  - Verify validation errors appear inline
  - Verify form remains in edit mode
- [ ] Test scenario: Cancel edit
  - Click "Edit Profile"
  - Modify fields
  - Click "Cancel"
  - Verify display mode shows original profile (no changes saved)
- [ ] Test scenario: Publish failure
  - Mock relay to reject event (OK false)
  - Attempt to save profile
  - Verify error message shown
  - Verify form remains in edit mode
  - Verify cache not updated
- [ ] Run `npm run test:e2e`

---

## Phase 6: Performance & Security Validation

### Task 6.1: Validate Bundle Size Impact
**Status:** Not Started  
**Estimated Effort:** 1 hour  
**Dependencies:** Task 2.1, Task 1.3  
**Verification:** Bundle size within limits

- [ ] Run `npm run build`
- [ ] Check bundle size output
- [ ] Verify NostrRelayAdapter + ProfileService adds ≤ 10KB gzipped
- [ ] If exceeds limit, optimize:
  - Remove unused imports
  - Tree-shake dependencies
  - Minify WebSocket code
- [ ] Re-run `npm run build` and verify

---

### Task 6.2: Validate Storage Efficiency
**Status:** Not Started  
**Estimated Effort:** 1 hour  
**Dependencies:** Task 1.3  
**Verification:** Storage usage within limits

- [ ] Populate cache with 50 profile entries
- [ ] Measure total storage usage (chrome.storage.local.getBytesInUse)
- [ ] Verify total ≤ 100KB
- [ ] Verify each profile ~1-2KB serialized
- [ ] If exceeds limit, optimize:
  - Reduce cache limit (e.g., 30 entries)
  - Compress JSON
  - Store only essential fields
- [ ] Re-test and verify

---

### Task 6.3: Validate Network Efficiency
**Status:** Not Started  
**Estimated Effort:** 1 hour  
**Dependencies:** Task 3.1  
**Verification:** Network usage optimized

- [ ] Load ProfileView with cached, non-expired profile
- [ ] Monitor network requests (DevTools Network tab)
- [ ] Verify zero relay queries made
- [ ] Verify profile displays instantly
- [ ] Load ProfileView with expired cache
- [ ] Verify exactly one relay query per configured relay
- [ ] Verify query uses `limit: 1` filter
- [ ] Monitor data transfer, ensure minimal overhead

---

### Task 6.4: Security Audit
**Status:** Not Started  
**Estimated Effort:** 2 hours  
**Dependencies:** Task 3.2  
**Verification:** Security requirements met

- [ ] Verify private key never leaves KeyVaultService during signing
- [ ] Verify signing occurs via RPC boundary (background ↔ UI)
- [ ] Verify relays receive only signed events, not key material
- [ ] Verify URLs sanitized before rendering:
  - Invalid URLs replaced with placeholder
  - No `javascript:` protocol allowed
  - External links use `target="_blank" rel="noopener noreferrer"`
- [ ] Verify profile content treated as untrusted:
  - Not used for authentication/authorization
  - React auto-escapes rendered content
  - No embedded scripts or HTML executed
- [ ] Verify no XSS vulnerabilities in ProfileView
- [ ] Run security tests (`npm run test:security` if configured)

---

## Phase 7: Documentation & Deployment

### Task 7.1: Update Documentation
**Status:** Not Started  
**Estimated Effort:** 2 hours  
**Dependencies:** All implementation tasks  
**Verification:** Documentation complete and accurate

- [ ] Update `README.md` with profile management feature
- [ ] Document ProfileService API in `docs/developers_readme.md`
- [ ] Document INostrRelay port in architecture docs
- [ ] Add profile metadata flow diagram to `docs/architecture_primer.md`
- [ ] Document multi-key profile management in user guide (if exists)
- [ ] Update CHANGELOG.md with profile feature entry

---

### Task 7.2: Validate Against Spec
**Status:** Not Started  
**Estimated Effort:** 2 hours  
**Dependencies:** All tasks complete  
**Verification:** All spec requirements met

- [ ] Review `specs/profile-metadata/spec.md` requirements
- [ ] Verify each requirement has corresponding implementation
- [ ] Verify each scenario has test coverage
- [ ] Verify all acceptance criteria met
- [ ] Run `openspec validate add-profile-metadata-management --strict`
- [ ] Address any validation errors
- [ ] Mark change as ready for review

---

### Task 7.3: Final Testing & QA
**Status:** Not Started  
**Estimated Effort:** 4 hours  
**Dependencies:** All implementation and test tasks  
**Verification:** End-to-end functionality confirmed

- [ ] Run full test suite: `npm run test` (unit + integration + e2e + security)
- [ ] Verify all tests pass
- [ ] Manual testing in Chrome:
  - Create new profile from scratch
  - Import existing key, fetch profile from relay
  - Edit and publish profile update
  - Verify profile displays in ProfileView
  - Test with multiple keys (if key switcher implemented)
  - Test offline mode with cached profile
  - Test error handling (relay failure, validation errors)
- [ ] Manual testing in Firefox:
  - Repeat all Chrome tests
  - Verify Firefox MV2 compatibility
- [ ] Performance testing:
  - Measure profile load time (should be < 200ms from cache)
  - Measure first fetch time (should be < 2s with 3 relays)
  - Verify no UI blocking during fetch
- [ ] Security review:
  - Verify no private key exposure
  - Verify URL sanitization
  - Verify no XSS vulnerabilities
- [ ] Sign off on QA checklist

---

### Task 7.4: Prepare for Deployment
**Status:** Not Started  
**Estimated Effort:** 1 hour  
**Dependencies:** Task 7.3  
**Verification:** Ready for production release

- [ ] Bump version in `package.json` (e.g., 0.1.0 → 0.2.0)
- [ ] Update `wxt.config.ts` manifest version
- [ ] Run `npm run build && npm run build:firefox`
- [ ] Run `npm run zip && npm run zip:firefox`
- [ ] Test packaged extensions in clean browser profiles
- [ ] Verify all functionality works in packaged builds
- [ ] Create release notes
- [ ] Tag release in git: `git tag v0.2.0`
- [ ] Archive OpenSpec change: `openspec archive add-profile-metadata-management`

---

## Summary

**Total Tasks:** 38  
**Estimated Total Effort:** 75-80 hours (approximately 2-3 weeks for single developer)

**Critical Path:**
1. Domain types → ProfileService → Unit tests (Phase 1)
2. INostrRelay → NostrRelayAdapter → Integration tests (Phase 2)
3. ProfileView display → ProfileView edit → Component tests (Phase 3)
4. Multi-key awareness (Phase 4)
5. E2E tests (Phase 5)
6. Performance & security validation (Phase 6)
7. Documentation & deployment (Phase 7)

**Risk Mitigation:**
- Start with Phase 1 infrastructure to unblock Phase 3 UI work
- Parallelize Phase 2 (relay adapter) and Phase 3 (UI) after Phase 1 complete
- Prioritize core functionality (view/edit profile) over optional enhancements (picture upload)
- Validate against spec continuously to avoid rework

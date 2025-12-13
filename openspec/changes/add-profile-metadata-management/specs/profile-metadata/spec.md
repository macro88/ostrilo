# profile-metadata Capability Specification

## Purpose
Enable comprehensive profile metadata management for Nostr identities managed by Ostrilo, including fetching profiles from relays, caching locally with TTL, displaying in UI, and publishing profile updates. This capability supports multi-identity workflows where users manage multiple keys with distinct profiles.

## ADDED Requirements

### Requirement: Profile Metadata Type Definition

The extension SHALL define a `ProfileMetadata` type representing NIP-01 kind:0 event content structure.

#### Scenario: Standard profile fields supported
- **GIVEN** the profile metadata type definition
- **THEN** it SHALL include optional fields: `name`, `about`, `picture`, `banner`, `website`
- **AND** it SHALL include optional Lightning fields: `nip05`, `lud16`, `lud06`
- **AND** it SHALL include `display_name` as alternative to `name`
- **AND** all fields SHALL be optional (allow partial profiles)

#### Scenario: Validation constraints enforced
- **WHEN** validating profile metadata
- **THEN** `name` SHALL be limited to 50 characters maximum
- **AND** `about` SHALL be limited to 500 characters maximum
- **AND** URL fields (`picture`, `banner`, `website`) SHALL be validated as valid URLs
- **AND** `nip05` and `lud16` SHALL match email-like format (user@domain)
- **AND** invalid fields SHALL be omitted (not reject entire profile)

---

### Requirement: Profile Cache Entry Structure

The extension SHALL define a `ProfileCacheEntry` type for storing cached profile metadata with expiration metadata.

#### Scenario: Cache entry contains metadata and timing
- **GIVEN** a cached profile entry
- **THEN** it SHALL include `pubkey` (hex public key)
- **AND** it SHALL include `metadata` (ProfileMetadata object)
- **AND** it SHALL include `fetchedAt` (epoch seconds when cached)
- **AND** it SHALL include `ttl` (seconds until expiration)
- **AND** it MAY include `eventId` (most recent kind:0 event ID)
- **AND** it MAY include `createdAt` (event created_at timestamp)

---

### Requirement: Profile Service

The extension SHALL provide a `ProfileService` in the application layer for managing profile operations.

#### Scenario: Service initialized with dependencies
- **WHEN** ProfileService is constructed
- **THEN** it SHALL accept `StorageSuite` dependency for cache persistence
- **AND** it SHALL accept `INostrRelay` port for relay communication
- **AND** it SHALL accept `KeyVaultService` for signing profile updates

#### Scenario: Get profile with cache-first strategy
- **GIVEN** ProfileService is initialized
- **WHEN** `getProfile(pubkey)` is called
- **THEN** it SHALL check local cache for the pubkey
- **AND** if cached entry exists and not expired (fetchedAt + ttl > now), it SHALL return cached metadata
- **AND** if cache miss or expired, it SHALL query relays for kind:0 events by author
- **AND** if multiple events found, it SHALL use the one with highest `created_at`
- **AND** it SHALL parse event content as JSON into ProfileMetadata
- **AND** it SHALL cache the result with current timestamp and default TTL (3600s)
- **AND** it SHALL return the ProfileMetadata object
- **AND** if all operations fail, it SHALL return null

#### Scenario: Force refresh bypasses cache
- **GIVEN** ProfileService is initialized
- **WHEN** `getProfile(pubkey, forceFetch=true)` is called
- **THEN** it SHALL skip cache lookup
- **AND** it SHALL query relays directly
- **AND** it SHALL update cache with fresh data
- **AND** it SHALL return the fresh ProfileMetadata

#### Scenario: Get all profiles for managed keys
- **GIVEN** ProfileService is initialized
- **AND** user has multiple keys managed by KeyVaultService
- **WHEN** `getAllProfiles()` is called
- **THEN** it SHALL fetch list of all key pubkeys from KeyVaultService
- **AND** it SHALL call `getProfile(pubkey)` for each pubkey
- **AND** it SHALL return a Map<pubkey, ProfileMetadata>
- **AND** entries with null profiles SHALL be omitted from map

#### Scenario: Update and publish profile
- **GIVEN** ProfileService is initialized
- **AND** user is authenticated with unlocked key
- **WHEN** `updateProfile(metadata)` is called
- **THEN** it SHALL validate metadata against ProfileMetadata schema
- **AND** if validation fails, it SHALL reject with validation error
- **AND** it SHALL get selected key pubkey from KeyVaultService
- **AND** it SHALL construct unsigned kind:0 event with content=JSON.stringify(metadata)
- **AND** it SHALL set `created_at` to current Unix timestamp
- **AND** it SHALL sign the event via KeyVaultService
- **AND** it SHALL publish signed event to all configured relays via INostrRelay
- **AND** it SHALL update local cache optimistically with new metadata
- **AND** it SHALL return successfully or reject with publish error

---

### Requirement: Nostr Relay Port Interface

The extension SHALL define an `INostrRelay` port interface for abstracting Nostr relay communication.

#### Scenario: Port interface defines relay operations
- **GIVEN** the INostrRelay port definition
- **THEN** it SHALL include `subscribe(filter, onEvent, onEOSE)` method returning subscription ID
- **AND** it SHALL include `publish(event)` method for broadcasting events
- **AND** it SHALL include `close(subId)` method for closing subscriptions
- **AND** it SHALL include `disconnect()` method for closing relay connection

#### Scenario: Subscribe to filtered events
- **GIVEN** an INostrRelay implementation
- **WHEN** `subscribe(filter, onEvent, onEOSE)` is called
- **THEN** it SHALL send REQ message to relay with generated subscription ID
- **AND** it SHALL call `onEvent(event)` for each matching EVENT message received
- **AND** it SHALL call `onEOSE()` when EOSE message received (if callback provided)
- **AND** it SHALL return unique subscription ID string

#### Scenario: Publish event to relay
- **GIVEN** an INostrRelay implementation
- **WHEN** `publish(event)` is called with signed Nostr event
- **THEN** it SHALL send EVENT message to relay
- **AND** it SHALL wait for OK response or timeout (5 seconds)
- **AND** it SHALL resolve promise on success (OK with true status)
- **AND** it SHALL reject promise on failure (OK with false status or timeout)

---

### Requirement: Nostr Relay Adapter Implementation

The extension SHALL provide a `NostrRelayAdapter` class implementing `INostrRelay` via WebSocket.

#### Scenario: Adapter connects to relay URL
- **GIVEN** NostrRelayAdapter is constructed with relay URL
- **WHEN** `connect()` is called
- **THEN** it SHALL establish WebSocket connection to the relay URL
- **AND** it SHALL wait for WebSocket 'open' event or timeout (10 seconds)
- **AND** it SHALL register message handler for incoming messages
- **AND** it SHALL resolve on successful connection
- **AND** it SHALL reject on connection failure or timeout

#### Scenario: Adapter handles subscription lifecycle
- **GIVEN** NostrRelayAdapter is connected
- **WHEN** `subscribe()` is called
- **THEN** it SHALL generate unique subscription ID (UUID)
- **AND** it SHALL store subscription handler internally
- **AND** it SHALL send ["REQ", subId, filter] message via WebSocket
- **AND** it SHALL route incoming ["EVENT", subId, event] to onEvent callback
- **AND** it SHALL route incoming ["EOSE", subId] to onEOSE callback
- **AND** when `close(subId)` is called, it SHALL send ["CLOSE", subId] and remove handler

#### Scenario: Adapter handles reconnection
- **GIVEN** NostrRelayAdapter is connected
- **WHEN** WebSocket connection drops unexpectedly
- **THEN** it SHALL attempt reconnection with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- **AND** it SHALL re-establish all active subscriptions after reconnection
- **AND** it SHALL emit 'reconnected' event (if event emitter added)

#### Scenario: Adapter handles service worker lifecycle
- **GIVEN** NostrRelayAdapter is running in Chrome MV3 service worker
- **WHEN** service worker is terminated and restarted
- **THEN** active subscriptions SHALL be lost (stateless restart)
- **AND** ProfileService SHALL re-request profiles on next UI interaction
- **AND** cached profiles SHALL remain available (persisted in storage)

---

### Requirement: Profile Cache Storage

The extension SHALL persist profile cache entries in local storage.

#### Scenario: Cache keyed by pubkey
- **GIVEN** ProfileService caches a profile
- **WHEN** storing in local storage
- **THEN** it SHALL use key format `profileCache:{pubkey}`
- **AND** it SHALL serialize ProfileCacheEntry as JSON
- **AND** it SHALL store in `storage.local` (not sync storage)

#### Scenario: Cache respects TTL
- **GIVEN** a cached profile exists
- **WHEN** ProfileService checks cache
- **THEN** it SHALL compute age as `now - fetchedAt`
- **AND** if age > ttl, it SHALL treat cache as expired
- **AND** if age <= ttl, it SHALL return cached metadata
- **AND** default TTL SHALL be 3600 seconds (1 hour)

#### Scenario: Cache eviction on size limit
- **GIVEN** profile cache contains 50 entries (max limit)
- **WHEN** a new profile is cached
- **THEN** ProfileService SHALL evict oldest entry by `fetchedAt`
- **AND** SHALL store new entry
- **AND** total cached profiles SHALL not exceed 50

#### Scenario: Manual cache clearing
- **GIVEN** ProfileService is initialized
- **WHEN** `clearCache(pubkey)` is called
- **THEN** it SHALL remove cache entry for that pubkey from storage
- **WHEN** `clearAllCache()` is called
- **THEN** it SHALL remove all profileCache:* entries from storage

---

### Requirement: ProfileView UI Integration

The extension SHALL enhance ProfileView component to display real profile metadata.

#### Scenario: Display mode shows profile fields
- **GIVEN** ProfileView is mounted
- **AND** user has unlocked key selected
- **WHEN** component loads
- **THEN** it SHALL fetch profile via ProfileService.getProfile(selectedPubkey)
- **AND** it SHALL display profile.name or "Unnamed" fallback
- **AND** it SHALL display profile.picture as avatar or placeholder icon
- **AND** it SHALL display profile.about or "No bio" fallback
- **AND** it SHALL display profile.website as clickable link or "No website"
- **AND** it SHALL show loading state while fetching
- **AND** it SHALL show error state if fetch fails

#### Scenario: Edit mode allows profile updates
- **GIVEN** ProfileView is in display mode
- **WHEN** user clicks "Edit Profile" button
- **THEN** it SHALL switch to edit mode
- **AND** it SHALL render editable form fields for name, about, picture URL, website
- **AND** it SHALL pre-populate fields with current profile values
- **AND** it SHALL validate inputs on blur (URL format, length limits)
- **AND** it SHALL show validation errors inline

#### Scenario: Publishing profile updates
- **GIVEN** ProfileView is in edit mode
- **AND** user has modified profile fields
- **WHEN** user clicks "Save" button
- **THEN** it SHALL validate all fields
- **AND** if validation passes, it SHALL call ProfileService.updateProfile(metadata)
- **AND** it SHALL show saving indicator
- **AND** on success, it SHALL switch back to display mode with updated profile
- **AND** on error, it SHALL show error message and remain in edit mode

#### Scenario: Manual refresh
- **GIVEN** ProfileView is in display mode
- **WHEN** user clicks refresh icon/button
- **THEN** it SHALL call ProfileService.getProfile(pubkey, forceFetch=true)
- **AND** it SHALL show loading indicator
- **AND** it SHALL update display with fresh profile data
- **AND** it SHALL update cache timestamp

---

### Requirement: Multi-Key Profile Awareness

The extension SHALL associate profiles with specific public keys to support multi-identity workflows.

#### Scenario: Profile displayed for selected key
- **GIVEN** user has multiple keys managed
- **AND** settings.selectedKeyId points to specific key
- **WHEN** ProfileView loads
- **THEN** it SHALL fetch profile for selectedKey's pubkey only
- **AND** it SHALL display that key's profile metadata
- **AND** it SHALL indicate which key's profile is shown (pubkey truncated in header)

#### Scenario: Switching keys updates profile view
- **GIVEN** user has multiple keys with distinct profiles
- **WHEN** user changes selectedKeyId in settings (future key switcher)
- **THEN** ProfileView SHALL re-fetch profile for new selectedKey
- **AND** SHALL display new key's profile metadata
- **AND** previous profile SHALL remain cached for fast re-switching

#### Scenario: Distinct cache per pubkey
- **GIVEN** user manages keys with pubkeys A and B
- **WHEN** profiles are cached for both
- **THEN** cache SHALL store separate entries: profileCache:A and profileCache:B
- **AND** fetching profile for A SHALL NOT return B's profile
- **AND** cache expiration SHALL be independent per key

---

### Requirement: Relay Query Strategy

The extension SHALL query configured relays efficiently for profile metadata.

#### Scenario: Query all configured relays in parallel
- **GIVEN** user has configured relays: [relay1, relay2, relay3]
- **WHEN** ProfileService fetches profile for pubkey
- **THEN** it SHALL connect to all relays concurrently
- **AND** it SHALL send REQ for {kinds: [0], authors: [pubkey]} to each
- **AND** it SHALL collect events from all relays
- **AND** it SHALL select event with highest created_at across all relays
- **AND** it SHALL close subscriptions after EOSE or 5-second timeout

#### Scenario: Timeout handling
- **GIVEN** ProfileService is fetching profile
- **WHEN** 5 seconds pass without EOSE from relay
- **THEN** it SHALL treat subscription as complete
- **AND** it SHALL use events received so far
- **AND** it SHALL close the subscription
- **AND** it SHALL not block indefinitely

#### Scenario: Partial relay failures
- **GIVEN** user has 3 configured relays
- **AND** 1 relay is unreachable
- **WHEN** ProfileService fetches profile
- **THEN** it SHALL proceed with 2 successful relays
- **AND** it SHALL log error for failed relay
- **AND** it SHALL return profile if at least one relay responded
- **AND** it SHALL not fail entire operation due to single relay failure

---

### Requirement: Error Handling

The extension SHALL handle errors gracefully during profile operations.

#### Scenario: Invalid JSON in kind:0 content
- **GIVEN** a kind:0 event is fetched from relay
- **AND** event.content is not valid JSON
- **WHEN** parsing profile metadata
- **THEN** it SHALL catch JSON parse error
- **AND** it SHALL log warning with event ID
- **AND** it SHALL treat profile as empty {} (all fields null)
- **AND** it SHALL cache empty profile to avoid repeated failures

#### Scenario: Schema validation failure
- **GIVEN** a kind:0 event content parses as JSON
- **AND** some fields fail validation (e.g., invalid URL)
- **WHEN** validating with Zod schema
- **THEN** it SHALL omit invalid fields
- **AND** it SHALL retain valid fields
- **AND** it SHALL log validation errors
- **AND** it SHALL return partial profile

#### Scenario: Relay connection failure
- **GIVEN** ProfileService attempts to fetch profile
- **AND** all relays are unreachable
- **WHEN** connection fails
- **THEN** it SHALL return cached profile if available (even if expired)
- **AND** if no cache exists, it SHALL return null
- **AND** it SHALL show "Offline" indicator in UI
- **AND** it SHALL not crash or hang

#### Scenario: Publish failure
- **GIVEN** user attempts to publish profile update
- **AND** all relays reject the event (OK with false)
- **WHEN** publish operation completes
- **THEN** it SHALL reject promise with publish error
- **AND** it SHALL surface error message in UI
- **AND** it SHALL NOT update cache (keep old profile)
- **AND** it SHALL allow user to retry

---

### Requirement: Performance Optimization

The extension SHALL optimize profile operations for responsiveness and efficiency.

#### Scenario: Bundle size impact
- **GIVEN** NostrRelayAdapter implementation
- **THEN** it SHALL use minimal WebSocket code (no external libraries)
- **AND** total added bundle size SHALL be ≤ 10KB gzipped
- **AND** it SHALL NOT include full `nostr-tools` library (too large)

#### Scenario: Storage efficiency
- **GIVEN** profile cache with 50 entries
- **THEN** total storage SHALL be ≤ 100KB
- **AND** each profile SHALL be ~1-2KB serialized
- **AND** cache SHALL use JSON serialization (no binary formats)

#### Scenario: Network efficiency
- **GIVEN** user loads ProfileView
- **WHEN** profile is cached and not expired
- **THEN** zero relay queries SHALL be made
- **AND** profile SHALL display instantly from cache
- **WHEN** cache is expired
- **THEN** exactly one relay query SHALL be made per configured relay
- **AND** query SHALL use limit:1 to minimize data transfer

---

### Requirement: Security Considerations

The extension SHALL maintain security boundaries during profile operations.

#### Scenario: No private key exposure
- **GIVEN** ProfileService publishes profile update
- **WHEN** constructing and signing event
- **THEN** private key SHALL remain in KeyVaultService only
- **AND** signing SHALL occur via RPC boundary
- **AND** signed event SHALL be returned without exposing private key
- **AND** relay SHALL receive only signed event, not key material

#### Scenario: URL sanitization
- **GIVEN** profile contains picture, banner, or website URLs
- **WHEN** rendering in ProfileView
- **THEN** URLs SHALL be validated using URL constructor
- **AND** invalid URLs SHALL be replaced with placeholder or omitted
- **AND** URLs SHALL NOT be executed as JavaScript (no javascript: protocol)
- **AND** external links SHALL open in new tab with noopener noreferrer

#### Scenario: Profile content not trusted
- **GIVEN** profile metadata is fetched from relays
- **THEN** content SHALL be treated as untrusted user input
- **AND** SHALL NOT be used for authentication or authorization
- **AND** SHALL be sanitized before rendering (React auto-escapes)
- **AND** SHALL NOT execute embedded scripts or HTML

---

### Requirement: Testing Coverage

The extension SHALL include comprehensive tests for profile functionality.

#### Scenario: Unit test coverage
- **GIVEN** ProfileService implementation
- **THEN** unit tests SHALL cover:
  - getProfile with cache hit and miss
  - Cache expiration logic
  - Profile validation (valid, invalid, partial)
  - updateProfile success and error paths
  - Cache eviction (LRU)
  - getAllProfiles with multiple keys

#### Scenario: Integration test coverage
- **GIVEN** NostrRelayAdapter implementation
- **THEN** integration tests SHALL cover:
  - WebSocket connection lifecycle
  - Subscribe and receive events
  - Publish and receive OK
  - Handle EOSE message
  - Reconnection logic
  - Timeout handling

#### Scenario: E2E test coverage
- **GIVEN** ProfileView UI component
- **THEN** Playwright tests SHALL cover:
  - View profile (cached)
  - View profile (fresh fetch)
  - Edit and publish profile
  - Validation errors in edit mode
  - Manual refresh
  - Offline mode with cached profile

# profile-metadata Specification

## Purpose
Define how the extension fetches, caches, and displays Nostr profile metadata (kind 0) for managed identities, including relay query strategy, cache lifetime, untrusted-content handling, and failure behavior.
## Requirements

### Requirement: Profile Metadata Type Definition

The extension SHALL define a `ProfileMetadata` type representing NIP-01 kind:0 event content structure. The validation schema for that type SHALL bound every field, SHALL restrict URL fields to the `https:` scheme, and SHALL NOT pass unknown relay-supplied keys through to storage or the UI.

#### Scenario: Standard profile fields supported
- **GIVEN** the profile metadata type definition
- **WHEN** the type is used to model kind:0 content
- **THEN** it SHALL include optional fields: `name`, `about`, `picture`, `banner`, `website`
- **AND** it SHALL include optional Lightning fields: `nip05`, `lud16`, `lud06`
- **AND** it SHALL include `display_name` as alternative to `name`
- **AND** all fields SHALL be optional (allow partial profiles)

#### Scenario: Validation constraints enforced
- **WHEN** validating profile metadata
- **THEN** `name` and `display_name` SHALL be limited to 50 characters maximum
- **AND** `about` SHALL be limited to 500 characters maximum
- **AND** URL fields (`picture`, `banner`, `website`) SHALL be parsed as absolute URLs, SHALL be limited to 512 characters, and SHALL be retained only when the scheme is `https:`
- **AND** `nip05` and `lud16` SHALL match email-like format (user@domain) and SHALL be limited to 254 characters
- **AND** `lud06` SHALL be limited to 512 characters
- **AND** invalid fields SHALL be omitted (not reject entire profile)

#### Scenario: Unknown relay-supplied keys are dropped
- **GIVEN** a relay returns kind:0 content containing keys outside the defined field set
- **WHEN** the content is validated
- **THEN** the validated result SHALL contain only defined fields
- **AND** unknown keys SHALL NOT be persisted to the profile cache
- **AND** unknown keys SHALL NOT be returned across the RPC boundary

#### Scenario: Validated metadata size is bounded
- **GIVEN** validated profile metadata
- **WHEN** the metadata is serialised for caching
- **THEN** the serialised form SHALL be at most 4096 bytes
- **AND** metadata exceeding that bound SHALL be reduced by omitting the largest optional fields before caching
- **AND** the extension SHALL NOT cache a profile larger than the bound

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

The extension SHALL provide a `ProfileService` in the application layer for managing profile operations. `ProfileService` SHALL accept a relay event only after the event has been verified and matched against the request that produced it.

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
- **AND** it SHALL discard any received event whose `pubkey` is not the requested pubkey or whose `kind` is not `0`
- **AND** it SHALL discard any received event whose event ID or Schnorr signature does not verify
- **AND** if multiple verified events remain, it SHALL use the one with highest `created_at`
- **AND** it SHALL parse event content as JSON into ProfileMetadata
- **AND** it SHALL cache the result with current timestamp and default TTL (3600s)
- **AND** it SHALL return the ProfileMetadata object
- **AND** if all operations fail, it SHALL return null

#### Scenario: Force refresh bypasses cache
- **GIVEN** ProfileService is initialized
- **WHEN** `getProfile(pubkey, forceFetch=true)` is called
- **THEN** it SHALL skip cache lookup
- **AND** it SHALL query relays directly
- **AND** it SHALL update cache only with a verified result
- **AND** it SHALL return the fresh ProfileMetadata

#### Scenario: Get all profiles for managed keys
- **GIVEN** ProfileService is initialized
- **AND** user has multiple keys managed by KeyVaultService
- **WHEN** `getAllProfiles()` is called
- **THEN** it SHALL fetch list of all key pubkeys from KeyVaultService
- **AND** it SHALL assign each pubkey to a single configured relay rather than querying every relay for every pubkey
- **AND** it SHALL issue one filter per pubkey containing exactly one entry in `authors`
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

The extension SHALL provide a `NostrRelayAdapter` class implementing `INostrRelay` via WebSocket. The adapter SHALL connect only over `wss:`, SHALL validate and verify every inbound message before invoking a callback, and SHALL bound its reconnection behaviour.

#### Scenario: Adapter connects to relay URL
- **GIVEN** NostrRelayAdapter is constructed with relay URL
- **WHEN** `connect()` is called
- **THEN** it SHALL reject the relay URL unless its scheme is `wss:`
- **AND** it SHALL establish WebSocket connection to the relay URL
- **AND** it SHALL wait for WebSocket 'open' event or timeout (10 seconds)
- **AND** it SHALL register message handler for incoming messages
- **AND** it SHALL resolve on successful connection
- **AND** it SHALL reject on connection failure or timeout

#### Scenario: Adapter handles subscription lifecycle
- **GIVEN** NostrRelayAdapter is connected
- **WHEN** `subscribe()` is called
- **THEN** it SHALL generate unique subscription ID (UUID)
- **AND** it SHALL store subscription handler internally together with the filter that created it
- **AND** it SHALL send ["REQ", subId, filter] message via WebSocket
- **AND** it SHALL discard any inbound message larger than 131072 bytes before parsing it
- **AND** it SHALL validate the message envelope and event payload against a schema before dispatch
- **AND** it SHALL route incoming ["EVENT", subId, event] to onEvent only when the event's ID and signature verify and the event matches the stored filter's `authors` and `kinds`
- **AND** it SHALL accept at most 20 events per subscription
- **AND** it SHALL route incoming ["EOSE", subId] to onEOSE callback and then remove the subscription handler
- **AND** when `close(subId)` is called, it SHALL send ["CLOSE", subId] and remove handler

#### Scenario: Adapter handles reconnection
- **GIVEN** NostrRelayAdapter is connected
- **WHEN** WebSocket connection drops unexpectedly
- **THEN** it SHALL attempt reconnection with exponential backoff (1s, 2s, 4s, 8s, max 30s) plus randomised jitter of up to 20 percent
- **AND** it SHALL stop reconnecting after 5 consecutive failed attempts
- **AND** on giving up it SHALL clear active subscriptions and settle dependent fetches
- **AND** it SHALL re-establish all active subscriptions after a successful reconnection
- **AND** it SHALL reset the attempt counter after a successful reconnection

#### Scenario: Adapter handles service worker lifecycle
- **GIVEN** NostrRelayAdapter is running in Chrome MV3 service worker
- **WHEN** service worker is terminated and restarted
- **THEN** active subscriptions SHALL be lost (stateless restart)
- **AND** ProfileService SHALL re-request profiles on next UI interaction
- **AND** cached profiles SHALL remain available for the remainder of the browser session (persisted in session storage)

---

### Requirement: Profile Cache Storage

The extension SHALL persist profile cache entries in a storage area that does not hold encrypted private key material, and SHALL enforce a hard byte cap on the cache so relay-driven growth cannot exhaust the quota of the area holding key records.

#### Scenario: Cache keyed by pubkey
- **GIVEN** ProfileService caches a profile
- **WHEN** storing the cache
- **THEN** it SHALL use key format `profileCache:{pubkey}` within the cache record
- **AND** it SHALL serialize ProfileCacheEntry as JSON
- **AND** it SHALL store in `browser.storage.session`, which holds no key material
- **AND** it SHALL NOT write profile data to `browser.storage.local`, which holds `encryptedKeys`
- **AND** it SHALL NOT write profile data to sync storage

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

#### Scenario: Cache eviction on byte limit
- **GIVEN** the profile cache is near its byte budget
- **WHEN** a new profile would take the serialised cache above 262144 bytes (256 KB)
- **THEN** ProfileService SHALL measure the serialised cache before committing the write
- **AND** SHALL evict entries oldest-first by `fetchedAt` until the cache fits within the budget
- **AND** SHALL commit the write only once the budget is satisfied

#### Scenario: Cache write failure is contained
- **GIVEN** a profile cache write fails, including with a storage quota error
- **WHEN** the failure occurs
- **THEN** ProfileService SHALL catch the failure
- **AND** SHALL return the freshly fetched metadata for the current request
- **AND** SHALL NOT surface a cache write failure as a profile fetch error
- **AND** the failure SHALL NOT affect any key record write

#### Scenario: Legacy unverified cache is purged
- **GIVEN** a previous version stored a `profileCache` record in `browser.storage.local`
- **WHEN** the extension starts after this change ships
- **THEN** the legacy `profileCache` record SHALL be removed from `browser.storage.local`
- **AND** no legacy entry SHALL be migrated into the new cache area
- **AND** profiles SHALL be re-fetched and verified on next use

#### Scenario: Manual cache clearing
- **GIVEN** ProfileService is initialized
- **WHEN** `clearCache(pubkey)` is called
- **THEN** it SHALL remove cache entry for that pubkey from storage
- **WHEN** `clearAllCache()` is called
- **THEN** it SHALL remove all profileCache:* entries from storage

---

### Requirement: ProfileView UI Integration

The extension SHALL enhance ProfileView component to display real profile metadata. ProfileView SHALL NOT load an image from a relay-supplied URL.

#### Scenario: Display mode shows profile fields
- **GIVEN** ProfileView is mounted
- **AND** user has unlocked key selected
- **WHEN** component loads
- **THEN** it SHALL fetch profile via ProfileService.getProfile(selectedPubkey)
- **AND** it SHALL display profile.name or "Unnamed" fallback
- **AND** it SHALL display the local seal avatar with the profile initial
- **AND** it SHALL NOT set profile.picture as an image source
- **AND** it SHALL display profile.picture, when present, as monospace text with a copy affordance
- **AND** it SHALL display profile.about or "No bio" fallback
- **AND** it SHALL display profile.website as a link opening in a new tab with `rel="noopener noreferrer"`, or "No website"
- **AND** it SHALL show loading state while fetching
- **AND** it SHALL show error state if fetch fails

#### Scenario: Edit mode allows profile updates
- **GIVEN** ProfileView is in display mode
- **WHEN** user clicks "Edit Profile" button
- **THEN** it SHALL switch to edit mode
- **AND** it SHALL render editable form fields for name, about, picture URL, website
- **AND** it SHALL pre-populate fields with current profile values
- **AND** it SHALL validate inputs on blur, requiring `https:` URLs and enforcing length limits
- **AND** it SHALL show validation errors inline
- **AND** it SHALL NOT preview an entered image URL by loading it in the extension page

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
- **AND** it SHALL update display with fresh verified profile data
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

The extension SHALL query configured relays efficiently for profile metadata while limiting what any single relay learns about the user's identity set and guaranteeing that every query settles.

#### Scenario: Background hydration partitions pubkeys across relays
- **GIVEN** user has configured relays: [relay1, relay2, relay3]
- **AND** user manages several keys
- **WHEN** ProfileService hydrates profiles for all managed keys
- **THEN** it SHALL assign each pubkey to a single relay from the configured set
- **AND** it SHALL send REQ for {kinds: [0], authors: [pubkey], limit: 1} to that relay only
- **AND** it SHALL NOT send every managed pubkey to every relay
- **AND** it SHALL select the event with highest created_at among the verified events it received
- **AND** it SHALL close each subscription after EOSE, after the accepted-event cap, or after the 5-second deadline

#### Scenario: Explicit refresh of a single identity may query all relays
- **GIVEN** the user explicitly refreshes the profile for one pubkey
- **WHEN** ProfileService fetches that profile
- **THEN** it MAY send REQ for {kinds: [0], authors: [pubkey], limit: 1} to every configured relay
- **AND** it SHALL NOT include any other managed pubkey in that fetch

#### Scenario: Timeout handling
- **GIVEN** ProfileService is fetching profile
- **WHEN** 5 seconds pass without the fetch settling for any reason
- **THEN** it SHALL treat subscription as complete
- **AND** it SHALL use verified events received so far
- **AND** it SHALL close the subscription
- **AND** it SHALL not block indefinitely
- **AND** the deadline SHALL be armed before the subscribe call so a subscribe that never resolves cannot hang the fetch

#### Scenario: Partial relay failures
- **GIVEN** user has 3 configured relays
- **AND** 1 relay is unreachable
- **WHEN** ProfileService fetches profiles
- **THEN** it SHALL proceed with the reachable relays
- **AND** it SHALL log error for failed relay without logging the raw relay payload
- **AND** a pubkey assigned to the failed relay MAY be retried on one alternate relay
- **AND** it SHALL not fail entire operation due to single relay failure

---

### Requirement: Error Handling

The extension SHALL handle errors gracefully during profile operations, and SHALL treat a rejected relay event as an absence of data rather than as a reason to change cached state.

#### Scenario: Invalid JSON in kind:0 content
- **GIVEN** a verified kind:0 event from the requested author is fetched from relay
- **AND** event.content is not valid JSON
- **WHEN** parsing profile metadata
- **THEN** it SHALL catch JSON parse error
- **AND** it SHALL log warning with event ID
- **AND** it SHALL treat profile as empty {} (all fields null)
- **AND** it SHALL cache empty profile to avoid repeated failures

#### Scenario: Rejected relay event leaves cache unchanged
- **GIVEN** a cached profile exists for pubkey `P`
- **WHEN** every event returned for `P` is rejected by validation, verification, or the author and kind checks
- **THEN** the extension SHALL treat the fetch as returning no data
- **AND** the cached entry for `P` SHALL remain unchanged
- **AND** the extension SHALL NOT cache an empty profile derived from a rejected event

#### Scenario: Malformed relay payload does not hang the fetch
- **GIVEN** a profile fetch is in flight
- **WHEN** a relay sends a payload that causes an exception while events are being handled or reduced
- **THEN** the exception SHALL be caught at the fetch boundary
- **AND** the fetch promise SHALL settle exactly once
- **AND** the subscription SHALL be closed
- **AND** the caller SHALL receive a null or cached result rather than waiting indefinitely

#### Scenario: Schema validation failure
- **GIVEN** a verified kind:0 event content parses as JSON
- **AND** some fields fail validation (for example a non-`https:` picture URL or an over-length bio)
- **WHEN** validating with Zod schema
- **THEN** it SHALL omit invalid fields
- **AND** it SHALL retain valid fields
- **AND** it SHALL log validation errors without logging the rejected field values in full
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

The extension SHALL optimize profile operations for responsiveness and efficiency, and SHALL bound the cost of relay-event verification and the storage footprint of relay-derived data.

#### Scenario: Bundle size impact
- **GIVEN** NostrRelayAdapter implementation
- **WHEN** the background bundle is built
- **THEN** it SHALL use minimal WebSocket code (no external libraries)
- **AND** total added bundle size SHALL be ≤ 10KB gzipped
- **AND** it SHALL NOT include full `nostr-tools` library (too large)
- **AND** signature verification SHALL reuse the `@noble/curves` and Zod dependencies already present in the background bundle rather than adding a new runtime dependency

#### Scenario: Verification cost is bounded
- **GIVEN** a profile fetch on cache miss
- **WHEN** relay events are verified
- **THEN** at most 20 signature verifications SHALL be performed per subscription
- **AND** cheaper size, schema, filter-match, and event-ID checks SHALL run first so rejected events cost no signature verification
- **AND** verification overhead SHALL add no more than 50 milliseconds to a single profile fetch

#### Scenario: Storage efficiency
- **GIVEN** profile cache with 50 entries
- **WHEN** the cache is measured
- **THEN** each cached profile SHALL be at most 4096 bytes serialized
- **AND** total profile cache storage SHALL be at most 262144 bytes (256 KB)
- **AND** the byte budget SHALL be enforced before each write, not merely expected
- **AND** cache SHALL use JSON serialization (no binary formats)

#### Scenario: Network efficiency
- **GIVEN** user loads a profile surface
- **WHEN** profile is cached and not expired
- **THEN** zero relay queries SHALL be made
- **AND** profile SHALL display instantly from cache
- **WHEN** cache is expired
- **THEN** exactly one relay query SHALL be made to the relay assigned to that pubkey
- **AND** query SHALL use limit:1 to minimize data transfer
- **AND** rendering a profile surface SHALL make no request to any relay-supplied media host

---

### Requirement: Security Considerations

The extension SHALL maintain security boundaries during profile operations. A relay SHALL be treated as an untrusted remote party whose output is verified before it can change extension state or appear in an extension page.

#### Scenario: No private key exposure
- **GIVEN** ProfileService publishes profile update
- **WHEN** constructing and signing event
- **THEN** private key SHALL remain in KeyVaultService only
- **AND** signing SHALL occur via RPC boundary
- **AND** signed event SHALL be returned without exposing private key
- **AND** relay SHALL receive only signed event, not key material

#### Scenario: URL sanitization
- **GIVEN** profile contains picture, banner, or website URLs
- **WHEN** validating and rendering the profile
- **THEN** URLs SHALL be parsed using the URL constructor
- **AND** only the `https:` scheme SHALL be accepted; `http:`, `javascript:`, `data:`, `blob:`, and `file:` SHALL be rejected
- **AND** invalid URLs SHALL be omitted from validated metadata
- **AND** URLs SHALL NOT be executed as JavaScript (no javascript: protocol)
- **AND** picture and banner URLs SHALL NOT be used as an image source in an extension page
- **AND** external links SHALL open in new tab with noopener noreferrer

#### Scenario: Profile content not trusted
- **GIVEN** profile metadata is fetched from relays
- **WHEN** the extension processes the event
- **THEN** the event's ID SHALL be recomputed and compared before the content is read
- **AND** the event's Schnorr signature SHALL be verified with `verifyEventSignature`
- **AND** the event's `pubkey` SHALL equal the requested pubkey and its `kind` SHALL equal `0`
- **AND** content SHALL be treated as untrusted user input even after verification
- **AND** SHALL NOT be used for authentication or authorization
- **AND** SHALL be sanitized before rendering (React auto-escapes)
- **AND** SHALL NOT execute embedded scripts or HTML
- **AND** React escaping alone SHALL NOT be treated as sufficient protection for relay-supplied data

#### Scenario: Relay cannot poison the displayed identity
- **GIVEN** the user manages pubkey `P`
- **WHEN** a relay returns a kind:0 event for `P` that it did not obtain from `P`'s key holder
- **THEN** the event SHALL fail signature verification and be discarded
- **AND** the name and avatar shown for `P` in the key selector, profile surface, and approval window SHALL be unaffected
- **AND** the user's view of which identity is about to sign SHALL remain accurate

#### Scenario: Relay data is isolated from key storage
- **GIVEN** relay-derived profile data is cached
- **WHEN** the cache is written
- **THEN** the write SHALL target a storage area that does not contain `encryptedKeys`
- **AND** relay-derived data volume SHALL NOT contribute to the quota of the area holding key records
- **AND** a key creation or import write SHALL NOT fail because of cached relay data

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

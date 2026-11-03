## MODIFIED Requirements

### Requirement: Profile Service

The extension SHALL provide a `ProfileService` in the application layer for managing profile operations. `ProfileService` SHALL accept a relay event only after the event has been verified and matched against the request that produced it. `ProfileService` SHALL publish a profile to the selected key's routable write relays and the discovery relays when that key's relay list is known, and to the discovery relays alone when it is not.

#### Scenario: Service initialized with dependencies
- **WHEN** ProfileService is constructed
- **THEN** it SHALL accept `StorageSuite` dependency for cache persistence
- **AND** it SHALL accept a relay port that can query and publish on named relays, for relay communication
- **AND** it SHALL accept `KeyVaultService` for signing profile updates
- **AND** it SHALL accept the relay-list service for resolving the selected key's write relays

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
- **AND** it SHALL look up the selected key's relay list
- **AND** it SHALL construct unsigned kind:0 event with content=JSON.stringify(metadata)
- **AND** it SHALL set `created_at` to current Unix timestamp
- **AND** it SHALL sign the event via KeyVaultService
- **AND** if the relay-list lookup is `found`, it SHALL publish the signed event to the routable write relays of that list together with the discovery relays, de-duplicated and bounded to 16 relays
- **AND** if the relay-list lookup is `none`, `unreadable`, or `unreachable`, it SHALL publish the signed event to the discovery relays
- **AND** it SHALL update local cache optimistically with new metadata
- **AND** it SHALL return successfully when at least one relay accepts the event, or reject with publish error

#### Scenario: Profile publish follows the relay list
- **GIVEN** the selected key's relay list names `wss://write.example` as a write relay and `wss://read.example` as read only
- **AND** the discovery relays are the three defaults
- **WHEN** `updateProfile(metadata)` publishes
- **THEN** the event SHALL be sent to `wss://write.example` and each discovery relay
- **AND** the event SHALL NOT be sent to `wss://read.example` unless it is also a discovery relay

---

### Requirement: Relay Query Strategy

The extension SHALL query configured relays efficiently for profile metadata while limiting what any single relay learns about the user's identity set and guaranteeing that every query settles. Routine hydration SHALL use only the discovery relays. An explicit refresh of one identity MAY additionally use that identity's cached routable write relays.

#### Scenario: Background hydration partitions pubkeys across relays
- **GIVEN** user has configured relays: [relay1, relay2, relay3]
- **AND** user manages several keys
- **WHEN** ProfileService hydrates profiles for all managed keys
- **THEN** it SHALL assign each pubkey to a single relay from the configured set
- **AND** it SHALL send REQ for {kinds: [0], authors: [pubkey], limit: 1} to that relay only
- **AND** it SHALL NOT send every managed pubkey to every relay
- **AND** it SHALL NOT send any query to a relay that is not a configured discovery relay
- **AND** it SHALL select the event with highest created_at among the verified events it received
- **AND** it SHALL close each subscription after EOSE, after the accepted-event cap, or after the 5-second deadline

#### Scenario: Explicit refresh of a single identity may query all relays
- **GIVEN** the user explicitly refreshes the profile for one pubkey
- **WHEN** ProfileService fetches that profile
- **THEN** it MAY send REQ for {kinds: [0], authors: [pubkey], limit: 1} to every configured relay
- **AND** it MAY send the same REQ to the routable write relays in that pubkey's cached relay list
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

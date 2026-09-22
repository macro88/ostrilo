# Relay Trust Boundary Specification

## Purpose

Define the validation boundary the extension applies to everything a Nostr relay sends, so that relay-supplied data can never reach storage, the RPC surface, or an extension page unverified. Covers envelope and event validation, signature and subscription-match enforcement, volume and transport limits, subscription lifecycle, query partitioning, and isolation from key material.

## Requirements

### Requirement: Relay Input Is Untrusted

The extension SHALL treat every byte received from a Nostr relay as untrusted remote input. No relay-supplied value SHALL be written to persistent storage, returned across the RPC boundary, or rendered in an extension page until it has passed the relay validation boundary defined by this capability.

#### Scenario: Unverified event never reaches cache or UI

- **GIVEN** a relay delivers an event on an active subscription
- **WHEN** the event fails any envelope, schema, bounds, signature, author, or kind check
- **THEN** the extension MUST discard the event
- **AND** the event MUST NOT be written to the profile cache
- **AND** the event MUST NOT be returned to any `profile.*` RPC caller
- **AND** the extension MUST NOT render any field of the event in an extension page

#### Scenario: Relay cannot be treated as an authority

- **GIVEN** a relay is configured by the user
- **WHEN** the extension consumes data from that relay
- **THEN** the relay MUST NOT be used as a source of authentication or authorisation
- **AND** relay data MUST NOT influence key selection, policy evaluation, or signing decisions

---

### Requirement: Relay Message Envelope Validation

The extension SHALL validate the size and structure of every relay WebSocket message before interpreting it. Messages SHALL be size-checked before parsing, and parsed messages SHALL be validated against a schema for the NIP-01 relay-to-client envelope.

#### Scenario: Oversized frame rejected before parsing

- **GIVEN** the relay adapter receives a WebSocket message
- **WHEN** the raw message exceeds 131072 bytes (128 KB)
- **THEN** the adapter MUST discard the message without calling `JSON.parse`
- **AND** the adapter MUST NOT invoke any subscription callback for that message

#### Scenario: Envelope validated against a schema

- **GIVEN** a relay message is within the size bound
- **WHEN** the adapter parses the message
- **THEN** the parsed value MUST be validated against a relay-message schema before use
- **AND** the message type MUST be one of `EVENT`, `EOSE`, `OK`, `NOTICE`, `CLOSED`, or `AUTH`
- **AND** any subscription ID MUST match `^[a-zA-Z0-9_-]{1,64}$`
- **AND** a message failing validation MUST be discarded

#### Scenario: Unknown message type discarded

- **GIVEN** a relay sends a message whose first element is not a recognised type
- **WHEN** the adapter handles the message
- **THEN** the adapter MUST discard the message
- **AND** the adapter MUST NOT dispatch it to a subscription handler

#### Scenario: Relay-supplied notice text is bounded before logging

- **GIVEN** a relay sends a `NOTICE` message
- **WHEN** the adapter records the notice
- **THEN** the notice text MUST be truncated to at most 200 characters
- **AND** the raw relay message MUST NOT be logged in full

---

### Requirement: Relay Event Structural Validation

The extension SHALL validate every relay-supplied event against a NIP-01 event schema with explicit bounds on each relay-controlled field before the event is considered further.

#### Scenario: Event schema enforced

- **GIVEN** a relay delivers an `EVENT` message
- **WHEN** the adapter validates the event payload
- **THEN** `id` MUST be a 64-character lowercase hex string
- **AND** `pubkey` MUST be a 64-character lowercase hex string
- **AND** `sig` MUST be a 128-character lowercase hex string
- **AND** `kind` MUST be an integer between 0 and 65535
- **AND** `created_at` MUST be a positive integer no greater than the current time plus 900 seconds
- **AND** `content` MUST be a string of at most 8192 bytes
- **AND** `tags` MUST be an array of at most 50 arrays of strings
- **AND** each tag array MUST contain at most 10 elements of at most 1024 bytes each
- **AND** an event failing any of these checks MUST be discarded

#### Scenario: Non-object event payload discarded

- **GIVEN** a relay sends `["EVENT", subId, null]` or `["EVENT", subId, "text"]`
- **WHEN** the adapter validates the payload
- **THEN** the adapter MUST discard the message
- **AND** the subscription callback MUST NOT be invoked
- **AND** the in-flight fetch that owns the subscription MUST still settle

---

### Requirement: Relay Event Signature Verification

The extension SHALL recompute the NIP-01 event ID and verify the Schnorr signature of every relay-supplied event before the event is delivered to any subscription callback. Verification SHALL use the existing `verifyEventSignature` helper in `src/application/crypto/event-id.ts`.

#### Scenario: Event ID recomputed and compared

- **GIVEN** a relay event has passed structural validation
- **WHEN** the extension verifies the event
- **THEN** the extension MUST recompute the event ID from `pubkey`, `created_at`, `kind`, `tags`, and `content`
- **AND** the recomputed ID MUST equal the event's `id` field
- **AND** an event whose ID does not match MUST be discarded

#### Scenario: Schnorr signature verified

- **GIVEN** a relay event has a matching recomputed event ID
- **WHEN** the extension verifies the event
- **THEN** the extension MUST verify `sig` against `id` and `pubkey` using `verifyEventSignature`
- **AND** an event whose signature does not verify MUST be discarded

#### Scenario: Forged profile event is rejected

- **GIVEN** the user's own pubkey `P` has a profile cached or absent
- **AND** a hostile relay returns a kind `0` event claiming `pubkey` `P` with attacker-chosen `name` and `picture`
- **AND** the event's signature was not produced by the private key for `P`
- **WHEN** the extension processes the relay response
- **THEN** the event MUST be discarded
- **AND** the cached profile for `P` MUST remain unchanged
- **AND** the key selector MUST continue to show the previously known or fallback identity for `P`

#### Scenario: Cheap checks run before signature verification

- **GIVEN** a relay floods a subscription with events
- **WHEN** the extension processes each event
- **THEN** size, schema, subscription-match, and event-ID checks MUST be evaluated before the Schnorr verification
- **AND** an event rejected by an earlier check MUST NOT incur a signature verification

---

### Requirement: Relay Event Subscription Match Enforcement

The extension SHALL deliver a relay event to a subscription callback only when the event matches the filter that created the subscription. The relay SHALL NOT be able to answer a request for one author or kind with data about another.

#### Scenario: Author mismatch rejected

- **GIVEN** a subscription was created with filter `{ kinds: [0], authors: [P] }`
- **WHEN** the relay returns a validly signed event whose `pubkey` is `Q` and `Q` is not in the filter's `authors`
- **THEN** the adapter MUST discard the event
- **AND** the subscription callback MUST NOT be invoked

#### Scenario: Kind mismatch rejected

- **GIVEN** a subscription was created with filter `{ kinds: [0], authors: [P] }`
- **WHEN** the relay returns a validly signed event whose `kind` is not `0`
- **THEN** the adapter MUST discard the event
- **AND** the subscription callback MUST NOT be invoked

#### Scenario: Consumer re-checks author and kind

- **GIVEN** `ProfileService` requested a profile for pubkey `P`
- **WHEN** an event reaches `ProfileService`
- **THEN** `ProfileService` MUST independently confirm `event.pubkey === P` and `event.kind === 0`
- **AND** an event failing that re-check MUST be discarded without being cached

---

### Requirement: Relay Response Volume Bounds

The extension SHALL bound the number of events it accepts from a single subscription so that a relay cannot grow background-worker memory without limit.

#### Scenario: Event count capped per subscription

- **GIVEN** a profile subscription is open
- **WHEN** the relay has delivered 20 accepted events for that subscription
- **THEN** the extension MUST stop accumulating further events for that subscription
- **AND** the extension MUST close the subscription
- **AND** the extension MUST settle the in-flight fetch using the events already accepted

#### Scenario: Configured relay count bounded

- **GIVEN** a settings update supplies a relay list
- **WHEN** the list contains more than 10 relay URLs
- **THEN** the update MUST be rejected as invalid
- **AND** the stored relay list MUST remain unchanged

---

### Requirement: Secure Relay Transport Only

The extension SHALL accept only `wss://` relay URLs, and SHALL enforce that at every layer that handles a relay URL rather than relying on a single downstream filter.

#### Scenario: Domain validator rejects cleartext WebSocket

- **GIVEN** the domain validator `isValidRelayUrl`
- **WHEN** it is given `ws://relay.example.com` or `ws://localhost:8080`
- **THEN** it MUST return false
- **AND** it MUST return true only for a `wss:` URL with a non-empty hostname and no embedded credentials

#### Scenario: Settings schema rejects non-relay URLs

- **GIVEN** a `settings.update` request patches `relays`
- **WHEN** an entry is `http://relay.example.com`, `ws://relay.example.com`, or any other non-`wss:` URL
- **THEN** the settings patch MUST be rejected with an invalid-params error
- **AND** the rejected value MUST NOT be written to stored settings

#### Scenario: Relay adapter refuses to connect over cleartext

- **GIVEN** a relay adapter is constructed with a non-`wss:` URL
- **WHEN** a connection is attempted
- **THEN** the adapter MUST refuse to open the WebSocket
- **AND** the failure MUST be reported as a relay configuration error

#### Scenario: Settings UI reuses the shared validator

- **GIVEN** the user adds a relay in Settings
- **WHEN** the UI validates the entered URL
- **THEN** the UI MUST use the shared relay-URL validator rather than a local string prefix check
- **AND** the UI MUST explain that only `wss://` relays are accepted

#### Scenario: Stored cleartext relays are dropped on migration

- **GIVEN** stored settings contain a `ws://` relay from a previous version
- **WHEN** settings are loaded after this change ships
- **THEN** the `ws://` entry MUST be removed from the stored relay list
- **AND** if no valid relay remains, the default relay list MUST be restored

---

### Requirement: Relay Subscription Lifecycle

The extension SHALL close every relay subscription it opens and SHALL guarantee that every relay-backed fetch settles, regardless of what the relay sends or fails to send.

#### Scenario: Subscription closed on EOSE

- **GIVEN** a profile subscription is open
- **WHEN** the relay sends `EOSE` for that subscription
- **THEN** the extension MUST close the subscription
- **AND** the subscription MUST be removed from the adapter's subscription registry

#### Scenario: Deadline settles the fetch even if subscribe never resolves

- **GIVEN** a profile fetch is started
- **WHEN** 5000 milliseconds elapse without the fetch settling for any reason
- **THEN** the fetch MUST settle with the events accepted so far
- **AND** the subscription MUST be closed if one was opened
- **AND** the deadline MUST be armed before the subscribe call so that a subscribe that never resolves cannot hang the fetch

#### Scenario: Failure inside an event or EOSE handler still settles the fetch

- **GIVEN** a profile fetch is in flight
- **WHEN** an exception is thrown while handling a relay event or EOSE
- **THEN** the exception MUST be caught at the fetch boundary
- **AND** the fetch MUST settle exactly once with a null or partial result
- **AND** the subscription MUST be closed

#### Scenario: Fetch settles exactly once

- **GIVEN** EOSE, the event cap, and the deadline could each settle a fetch
- **WHEN** more than one of them occurs
- **THEN** the fetch MUST resolve only on the first of them
- **AND** later settle attempts MUST be ignored

---

### Requirement: Bounded Relay Reconnection

The extension SHALL bound relay reconnection so that an unreachable or hostile relay cannot hold a permanent reconnect loop in the background worker.

#### Scenario: Reconnect attempts capped

- **GIVEN** a relay connection drops while subscriptions are registered
- **WHEN** reconnection is attempted
- **THEN** the delay MUST follow exponential backoff starting at 1000 milliseconds and capped at 30000 milliseconds
- **AND** the delay MUST include randomised jitter of up to 20 percent
- **AND** after 5 consecutive failed attempts the adapter MUST stop reconnecting
- **AND** on giving up the adapter MUST clear its subscriptions and settle any dependent fetch

#### Scenario: No reconnect loop without work to do

- **GIVEN** a relay connection drops
- **WHEN** the adapter holds no subscriptions and no pending publishes
- **THEN** the adapter MUST NOT schedule a reconnect

#### Scenario: Successful reconnect resets the attempt counter

- **GIVEN** a relay has failed to connect twice
- **WHEN** a later connection attempt succeeds
- **THEN** the reconnect attempt counter MUST be reset to zero

---

### Requirement: Profile Query Partitioning Across Relays

The extension SHALL NOT reveal the user's whole set of public keys to a single relay during routine profile hydration. Profile queries for managed keys SHALL be partitioned across the configured relays.

#### Scenario: Background hydration partitions keys across relays

- **GIVEN** the user manages pubkeys `A`, `B`, and `C`
- **AND** relays `R1` and `R2` are configured
- **WHEN** the extension hydrates profiles for all managed keys
- **THEN** each pubkey MUST be queried on exactly one assigned relay
- **AND** no relay MUST receive a query for every managed pubkey while more than one relay is configured
- **AND** a filter MUST NOT contain more than one entry in `authors`

#### Scenario: Relay assignment is stable per pubkey

- **GIVEN** relays `R1` and `R2` are configured
- **WHEN** the extension hydrates the profile for pubkey `A` on separate occasions
- **THEN** `A` MUST be assigned to the same relay each time while the relay list is unchanged
- **AND** the assignment MUST NOT be derived from the pubkey alone in a way that is identical across installs

#### Scenario: Failover does not broadcast the identity set

- **GIVEN** pubkey `A` is assigned to relay `R1`
- **WHEN** `R1` fails to answer within the fetch deadline
- **THEN** the extension MAY retry `A` on one other configured relay
- **AND** the extension MUST NOT retry `A` on every configured relay during background hydration

#### Scenario: Single configured relay is disclosed as unavoidable correlation

- **GIVEN** exactly one relay is configured
- **WHEN** the user views relay settings
- **THEN** the UI MUST state that a single relay sees every identity the extension queries
- **AND** the UI MUST NOT claim that partitioning protects the user in that configuration

#### Scenario: Explicit refresh of one identity may fan out

- **GIVEN** the user explicitly refreshes the profile for the selected key
- **WHEN** the extension fetches that single pubkey
- **THEN** the extension MAY query all configured relays for that one pubkey
- **AND** the extension MUST NOT include any other managed pubkey in that fetch

---

### Requirement: Relay Data Is Isolated From Key Material

The extension SHALL NOT store relay-controlled data in a storage area that holds encrypted private key material, and relay-driven storage growth SHALL NOT be able to cause a key write to fail.

#### Scenario: Relay-derived cache does not share the vault storage area

- **GIVEN** the encrypted key vault is stored under `encryptedKeys` in `browser.storage.local`
- **WHEN** the extension persists relay-derived profile data
- **THEN** the write MUST target a storage area that does not hold `encryptedKeys`
- **AND** no relay-derived value MUST be written to `browser.storage.local`

#### Scenario: Relay-derived writes are best effort

- **GIVEN** a write of relay-derived profile data fails for any reason, including a quota error
- **WHEN** the failure occurs
- **THEN** the extension MUST catch the failure and continue
- **AND** the failure MUST NOT propagate to a caller as a profile fetch error
- **AND** the extension MUST trim the relay-derived cache and retain the in-memory result for the current request

#### Scenario: Key writes are not affected by relay-derived data volume

- **GIVEN** a relay has returned the maximum amount of profile data the extension will accept
- **WHEN** the user creates or imports a key
- **THEN** the key record write MUST succeed
- **AND** the amount of relay-derived data stored MUST NOT contribute to the quota of the area holding key records

## ADDED Requirements

### Requirement: Discovery Relays Default To Three Relays

The extension SHALL ship `wss://relay.primal.net`, `wss://relay.damus.io` and `wss://nos.lol`, in that order, as the default discovery relays held in `settings.relays`. An install whose stored relay list is exactly the previous default, `["wss://relay.primal.net"]`, SHALL be moved to the new default when settings are read. Any other stored list SHALL be left unchanged.

#### Scenario: Fresh install receives three discovery relays

- **GIVEN** the extension has no stored settings
- **WHEN** settings are read for the first time
- **THEN** `relays` MUST equal `["wss://relay.primal.net", "wss://relay.damus.io", "wss://nos.lol"]`

#### Scenario: Previous single-relay default is migrated

- **GIVEN** stored settings hold `relays: ["wss://relay.primal.net"]`
- **WHEN** settings are read after this change ships
- **THEN** `relays` MUST equal the three-relay default
- **AND** the migrated list MUST be written back to stored settings

#### Scenario: A customised relay list is not touched

- **GIVEN** stored settings hold `relays: ["wss://relay.primal.net", "wss://relay.example.com"]`
- **WHEN** settings are read after this change ships
- **THEN** `relays` MUST remain `["wss://relay.primal.net", "wss://relay.example.com"]`

#### Scenario: A list emptied by sanitisation restores the new default

- **GIVEN** stored settings hold only relay URLs that fail the `wss://` validator
- **WHEN** settings are read
- **THEN** `relays` MUST equal the three-relay default

---

### Requirement: Relay List Parsing Is Bounded

The extension SHALL interpret a verified kind `10002` event only through a domain parser that reads `r` tags under explicit bounds. The parser SHALL ignore `content`, SHALL accept an entry only when its URL passes the shared relay-URL validator and the 512-character bound, and SHALL report how many tags it dropped. A list with more than 20 accepted entries SHALL be reported as unreadable, not truncated.

#### Scenario: Markers map to read and write

- **GIVEN** a verified kind `10002` event with tags `["r", "wss://a.example"]`, `["r", "wss://b.example", "read"]` and `["r", "wss://c.example", "write"]`
- **WHEN** the event is parsed
- **THEN** `wss://a.example` MUST be both read and write
- **AND** `wss://b.example` MUST be read only
- **AND** `wss://c.example` MUST be write only

#### Scenario: Invalid tags are dropped and counted

- **GIVEN** a verified kind `10002` event containing `["r", "ws://cleartext.example"]`, `["r", "wss://a.example", "both"]` and `["r", "wss://user:pass@b.example"]`
- **WHEN** the event is parsed
- **THEN** none of those three entries MUST be accepted
- **AND** the parse result MUST report a dropped count of 3

#### Scenario: Duplicate URLs merge their markers

- **GIVEN** a verified kind `10002` event with tags `["r", "wss://A.example/", "read"]` and `["r", "wss://a.example", "write"]`
- **WHEN** the event is parsed
- **THEN** exactly one entry for `wss://a.example` MUST be accepted
- **AND** that entry MUST be both read and write

#### Scenario: An oversized list is unreadable rather than truncated

- **GIVEN** a verified kind `10002` event with 21 valid, distinct `r` tags
- **WHEN** the event is parsed
- **THEN** the parse result MUST be unreadable
- **AND** no subset of its entries MUST be offered for editing or republishing

#### Scenario: Consumer re-checks author and kind

- **GIVEN** the extension requested the relay list for pubkey `P`
- **WHEN** an event reaches the relay-list service
- **THEN** the service MUST independently confirm `event.pubkey === P` and `event.kind === 10002`
- **AND** an event failing that re-check MUST be discarded without being cached

---

### Requirement: Relay List Lookup Reports One Of Four Outcomes

A relay-list lookup SHALL report exactly one of `found`, `none`, `unreadable`, or `unreachable`. The relay adapter SHALL count, per subscription, the event frames it discards, and SHALL make that count visible to the subscriber, so that a discarded list is never reported as an absent one.

#### Scenario: Newest verified list is found

- **GIVEN** two relays return verified kind `10002` events for pubkey `P` with different `created_at`
- **WHEN** the lookup settles
- **THEN** the outcome MUST be `found`
- **AND** the event with the highest `created_at` MUST be the result

#### Scenario: None requires every relay to answer with nothing discarded

- **GIVEN** every relay asked answers `EOSE` without delivering an event
- **AND** no frame on the lookup's subscriptions was discarded
- **WHEN** the lookup settles
- **THEN** the outcome MUST be `none`

#### Scenario: A discarded frame makes the lookup unreadable

- **GIVEN** a relay sends a kind `10002` event for pubkey `P` that has 51 tags
- **AND** the adapter discards it under the tag bound
- **AND** no other relay returns a verified list
- **WHEN** the lookup settles
- **THEN** the outcome MUST be `unreadable`
- **AND** the outcome MUST NOT be `none`

#### Scenario: A silent relay makes an empty lookup unreachable

- **GIVEN** three relays are asked
- **AND** two answer `EOSE` without an event and one does not answer before the deadline
- **WHEN** the lookup settles
- **THEN** the outcome MUST be `unreachable`

---

### Requirement: Relay Lists Are Looked Up Only On A User Action

The extension SHALL look up a kind `10002` relay list only for a single identity, and only when the user opens or refreshes the Relays tab, publishes a profile or relay list, or explicitly refreshes a profile. Background profile hydration SHALL NOT request kind `10002`. A lookup MAY ask every discovery relay and the identity's cached routable write relays, and SHALL include exactly one entry in `authors`.

#### Scenario: Background hydration does not request relay lists

- **GIVEN** the user manages several keys
- **WHEN** the extension hydrates profiles for all managed keys in the background
- **THEN** no relay MUST receive a filter whose `kinds` includes `10002`

#### Scenario: Opening the Relays tab looks up one identity

- **GIVEN** key `A` is selected and keys `B` and `C` also exist
- **WHEN** the user opens the Relays tab
- **THEN** the extension MUST look up the relay list for `A`'s pubkey
- **AND** every filter sent MUST be `{ kinds: [10002], authors: [A] }` with exactly one author
- **AND** no relay MUST receive a relay-list filter for `B` or `C`

---

### Requirement: Relay Lists Are Cached In Session Storage

The extension SHALL cache parsed relay lists in `browser.storage.session` keyed by pubkey, with the event ID, `created_at`, accepted entries, dropped count, and fetch time. The cache SHALL hold at most 50 entries and at most 262144 serialised bytes, SHALL expire entries after 3600 seconds, and SHALL never be written to `browser.storage.local`. When the extension signs a kind `10002` event for a website, it SHALL drop the cached list for the signing key's pubkey and SHALL NOT write the signed event into the cache.

#### Scenario: Cache lives in session storage only

- **WHEN** a relay list is cached
- **THEN** it MUST be written to `browser.storage.session`
- **AND** no relay-list data MUST be written to `browser.storage.local`

#### Scenario: A site-signed relay list drops the cache

- **GIVEN** a relay list is cached for key `A`
- **WHEN** a website requests a kind `10002` signature from key `A` and the extension signs it
- **THEN** the cached relay list for `A` MUST be removed
- **AND** the signed event MUST NOT be written into the relay-list cache
- **AND** the next Relays tab read for `A` MUST perform a fresh lookup

---

### Requirement: Publishing A Relay List Does Not Overwrite An Unseen List

The extension SHALL publish a relay list only after a fresh lookup for that identity. It SHALL refuse when the lookup is `unreadable` or `unreachable`, and SHALL answer with status `changed` and the newer list, without signing, when the newest event's ID differs from the event the edit was based on. Refusals of this kind SHALL be statuses in a successful response, not new RPC error codes. The published event's `created_at` SHALL be the greater of the current time and the base event's `created_at` plus one. A published list SHALL contain at least one write relay and at most 20 entries. The extension SHALL publish to the routable union of the new list's write relays, the base list's write relays, and the discovery relays, de-duplicated and bounded to 16 relays. It SHALL report per-relay results, and SHALL record the publish in the activity log with origin `extension://relays` and kind `10002`.

#### Scenario: A list changed elsewhere is not overwritten

- **GIVEN** the user began editing key `A`'s relay list from event `E1`
- **AND** another client has since published event `E2` for `A`
- **WHEN** the user publishes
- **THEN** the extension MUST NOT sign or publish
- **AND** the response MUST carry status `changed` and the entries of `E2`

#### Scenario: An unreadable or unreachable list blocks publishing

- **GIVEN** a fresh lookup for key `A` returns `unreadable` or `unreachable`
- **WHEN** the user publishes a relay list for `A`
- **THEN** the extension MUST NOT sign or publish
- **AND** the UI MUST say what happened and what the user can do next

#### Scenario: created_at always moves forward

- **GIVEN** the base event has `created_at` 2000000000
- **AND** the local clock reads 1999999000
- **WHEN** the extension signs the new relay list
- **THEN** the new event's `created_at` MUST be 2000000001

#### Scenario: Publish reaches new, old and discovery relays

- **GIVEN** the base list's write relays are `wss://old.example`
- **AND** the new list's write relays are `wss://new.example`
- **AND** the discovery relays are the three defaults
- **WHEN** the extension publishes the new list
- **THEN** the event MUST be sent to `wss://new.example`, `wss://old.example` and each discovery relay
- **AND** the response MUST report, per relay, whether the relay accepted the event

#### Scenario: A list with no write relay is refused

- **WHEN** the user attempts to publish a relay list whose entries are all read-only
- **THEN** the extension MUST refuse with an invalid-params error
- **AND** nothing MUST be signed

#### Scenario: Publish is recorded

- **WHEN** a relay list publish is accepted by at least one relay
- **THEN** the activity log MUST gain an entry with origin `extension://relays`, kind `10002`, decision `allow`, and the signing key's ID

---

### Requirement: Generated Keys Receive A Starter Relay List

When `vault.generate` succeeds, the extension SHALL sign and publish, with the new key, a kind `10002` event that lists each current discovery relay as an `r` tag with no marker, and SHALL send it to those discovery relays. The `vault.generate` response SHALL NOT wait for this publish. The extension SHALL attempt it once, SHALL NOT retry it later, and SHALL skip it if the key cannot sign. The extension SHALL NOT publish a relay list automatically for an imported key. The create-key step, Quick start, and Add Key's generate path SHALL each tell the user that a starter relay list will be published for the new key.

#### Scenario: New key gets a starter list

- **GIVEN** the discovery relays are the three defaults
- **WHEN** the user creates a key in onboarding
- **THEN** the extension MUST publish a kind `10002` event signed by the new key
- **AND** its tags MUST be exactly `["r", "wss://relay.primal.net"]`, `["r", "wss://relay.damus.io"]` and `["r", "wss://nos.lol"]`
- **AND** it MUST be sent to those three relays

#### Scenario: Onboarding does not wait on relays

- **GIVEN** every discovery relay is unreachable
- **WHEN** the user creates a key
- **THEN** `vault.generate` MUST respond without waiting for the relay-list publish
- **AND** onboarding MUST complete normally

#### Scenario: A failed starter publish is not retried

- **GIVEN** the starter publish for a generated key was accepted by no relay
- **WHEN** the vault is later locked and unlocked
- **THEN** the extension MUST NOT attempt the starter publish again on its own
- **AND** the Relays tab for that key MUST show the result of a fresh lookup

#### Scenario: Imported key is never published automatically

- **WHEN** the user imports a key
- **THEN** the extension MUST NOT publish a kind `10002` event for it

#### Scenario: Starter list is offered for a key with none

- **GIVEN** a fresh lookup for the selected key returns `none`
- **WHEN** the user views the Relays tab
- **THEN** the tab MUST offer to publish a starter relay list built from the discovery relays
- **AND** the tab MUST state that publishing replaces any relay list held on relays the extension did not ask
- **AND** confirming MUST apply the full publish guard with no base event, so a list that appeared since is shown instead of overwritten

#### Scenario: Starter publish is disclosed before key creation

- **WHEN** the user is on the create-key step, the Quick start step, or Add Key's generate path
- **THEN** the screen MUST state that a starter relay list will be published for the new key

---

### Requirement: Relay-List Hosts On A Private Network Are Never Contacted

The extension SHALL NOT open a connection to, subscribe on, or publish to a relay URL taken from a relay list when its host is `localhost`, ends in `.localhost`, `.local` or `.internal`, or is an IP literal in a loopback, private, link-local, carrier-grade NAT or unspecified range, including IPv4-mapped IPv6 forms. A URL the user entered as a discovery relay SHALL be exempt. Such entries SHALL remain visible and SHALL be preserved when the list is republished.

#### Scenario: LAN address in a relay list is not contacted

- **GIVEN** key `A`'s relay list names `wss://192.168.1.1` as a write relay
- **AND** `wss://192.168.1.1` is not a discovery relay
- **WHEN** the extension publishes a profile or relay list for `A`
- **THEN** no connection to `wss://192.168.1.1` MUST be opened
- **AND** the Relays tab MUST show that entry as not used by the extension

#### Scenario: A discovery relay on localhost remains usable

- **GIVEN** `wss://localhost:7447` is a discovery relay
- **AND** key `A`'s relay list names `wss://localhost:7447` as a write relay
- **WHEN** the extension publishes for `A`
- **THEN** the event MUST be sent to `wss://localhost:7447`

#### Scenario: Non-routable entries survive republishing

- **GIVEN** key `A`'s relay list contains `wss://10.0.0.5` and `wss://relay.example.com`
- **WHEN** the user removes `wss://relay.example.com` and publishes
- **THEN** the published event MUST still contain `["r", "wss://10.0.0.5"]`

---

### Requirement: Short-Lived Relay Connections Are Bounded

The relay manager SHALL be able to subscribe on and publish to a relay URL that is not a discovery relay. It SHALL do so through short-lived adapters that inherit every existing relay bound, SHALL hold at most 16 such adapters open at once, and SHALL close each one when the operation it was opened for settles.

#### Scenario: Short-lived adapter is closed after use

- **GIVEN** a publish targets `wss://write.example`, which is not a discovery relay
- **WHEN** the publish settles
- **THEN** the adapter for `wss://write.example` MUST be disconnected
- **AND** it MUST hold no subscriptions or pending publishes

#### Scenario: Short-lived adapters are capped

- **GIVEN** an operation targets 20 distinct non-discovery relay URLs
- **WHEN** the relay manager opens adapters for them
- **THEN** no more than 16 short-lived adapters MUST be open at any moment

#### Scenario: Short-lived adapters keep the relay trust boundary

- **GIVEN** a short-lived adapter is subscribed on `wss://write.example`
- **WHEN** that relay sends an event whose signature does not verify
- **THEN** the event MUST be discarded under the same rules as on a discovery relay

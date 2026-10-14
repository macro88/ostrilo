## MODIFIED Requirements

### Requirement: Relay Input Is Untrusted

The extension SHALL treat every byte received from a Nostr relay as untrusted remote input. No relay-supplied value SHALL be written to persistent storage, returned across the RPC boundary, or rendered in an extension page until it has passed the relay validation boundary defined by this capability. A relay list signed by the user's own key SHALL also be treated as untrusted: a website can obtain that signature, so its contents SHALL NOT be able to direct the extension's network connections beyond what the relay-list capability permits.

#### Scenario: Unverified event never reaches cache or UI

- **GIVEN** a relay delivers an event on an active subscription
- **WHEN** the event fails any envelope, schema, bounds, signature, author, or kind check
- **THEN** the extension MUST discard the event
- **AND** the event MUST NOT be written to the profile cache or the relay-list cache
- **AND** the event MUST NOT be returned to any `profile.*` or `relayList.*` RPC caller
- **AND** the extension MUST NOT render any field of the event in an extension page

#### Scenario: Relay cannot be treated as an authority

- **GIVEN** a relay is configured by the user
- **WHEN** the extension consumes data from that relay
- **THEN** the relay MUST NOT be used as a source of authentication or authorisation
- **AND** relay data MUST NOT influence key selection, policy evaluation, or signing decisions

#### Scenario: A user-signed relay list cannot reach the local network

- **GIVEN** a website obtained the user's signature on a kind `10002` event naming `wss://127.0.0.1:8080`
- **WHEN** the extension later reads that relay list and publishes for the same key
- **THEN** the extension MUST NOT open a connection to `wss://127.0.0.1:8080`

---

### Requirement: Relay Data Is Isolated From Key Material

The extension SHALL NOT store relay-controlled data in a storage area that holds encrypted private key material, and relay-driven storage growth SHALL NOT be able to cause a key write to fail. This applies to cached profiles and cached relay lists alike.

#### Scenario: Relay-derived cache does not share the vault storage area

- **GIVEN** the encrypted key vault is stored under `encryptedKeys` in `browser.storage.local`
- **WHEN** the extension persists relay-derived profile data or relay-list data
- **THEN** the write MUST target a storage area that does not hold `encryptedKeys`
- **AND** no relay-derived value MUST be written to `browser.storage.local`

#### Scenario: Relay-derived writes are best effort

- **GIVEN** a write of relay-derived profile data or relay-list data fails for any reason, including a quota error
- **WHEN** the failure occurs
- **THEN** the extension MUST catch the failure and continue
- **AND** the failure MUST NOT propagate to a caller as a profile fetch or relay-list lookup error
- **AND** the extension MUST trim the relay-derived cache and retain the in-memory result for the current request

#### Scenario: Key writes are not affected by relay-derived data volume

- **GIVEN** a relay has returned the maximum amount of profile and relay-list data the extension will accept
- **WHEN** the user creates or imports a key
- **THEN** the key record write MUST succeed
- **AND** the amount of relay-derived data stored MUST NOT contribute to the quota of the area holding key records

## ADDED Requirements

### Requirement: Background Binds The Requesting Origin To The Attested Sender

For every `nostr` namespace request, the background SHALL derive the requesting origin from the browser-attested message sender, SHALL refuse the request with the `invalid_origin` error code when that origin cannot be attested or disagrees with the origin the content script sent, and SHALL pass only the derived origin to request handlers. A sender is attestable only when its extension id is this extension's runtime id, it has a tab, its frame id is `0`, its URL parses with the `https:` scheme, and, where the browser supplies a sender origin, that origin agrees with the URL's origin. A refused request SHALL NOT reach any service, SHALL NOT be charged to any per-origin rate limit, and SHALL NOT create or modify an origin policy or activity entry.

#### Scenario: Matching origins are dispatched with the derived value

- **GIVEN** a `nostr.signEvent` request whose `origin` is `https://a.example`
- **AND** the sender is this extension's content script in the top frame of a tab at `https://a.example/path`
- **WHEN** the background router receives the request
- **THEN** the request is dispatched
- **AND** the handler receives `https://a.example` as the origin

#### Scenario: A claimed origin that disagrees with the sender is refused

- **GIVEN** a `nostr.getPublicKey` request whose `origin` is `https://trusted.example`
- **AND** the sender's URL is `https://attacker.example/`
- **WHEN** the background router receives the request
- **THEN** the response carries the `invalid_origin` error code
- **AND** no consent, trust level, or rate-limit state for either origin changes

#### Scenario: A subframe sender is refused

- **GIVEN** a `nostr.signEvent` request from a sender whose frame id is not `0`
- **WHEN** the background router receives the request
- **THEN** the response carries the `invalid_origin` error code

#### Scenario: A sender from another extension is refused

- **GIVEN** a `nostr.signEvent` request whose sender id is not this extension's runtime id
- **WHEN** the background router receives the request
- **THEN** the response carries the `invalid_origin` error code

#### Scenario: A non-HTTPS sender URL is refused

- **GIVEN** a `nostr.getPublicKey` request whose sender URL uses the `http:` scheme
- **WHEN** the background router receives the request
- **THEN** the response carries the `invalid_origin` error code

#### Scenario: Same-document navigation keeps the origin

- **GIVEN** a page at `https://a.example/` that calls `history.pushState` to `/other`
- **WHEN** it then calls `window.nostr.signEvent`
- **THEN** the request is dispatched with origin `https://a.example`

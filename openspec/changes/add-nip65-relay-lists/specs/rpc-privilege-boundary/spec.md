## MODIFIED Requirements

### Requirement: Page-Reachable RPC Namespaces Are Explicitly Limited

The background RPC router SHALL classify every registered namespace as page-reachable or UI-only. Only the `nostr` namespace SHALL be page-reachable. The `vault`, `keys`, `policy`, `settings`, `crypto`, `state`, `approval`, `activity`, `profile`, and `relayList` namespaces SHALL be UI-only.

#### Scenario: Content script reaches the NIP-07 namespace

- **GIVEN** the content script is running in a web page tab
- **WHEN** it forwards a `nostr.signEvent` request to the background
- **THEN** the router dispatches the request to the Nostr handler
- **AND** normal origin, policy, and approval evaluation applies

#### Scenario: Tab sender cannot reach a UI-only namespace

- **GIVEN** a message arrives at the background listener with `sender.tab` present
- **WHEN** the message requests a UI-only namespace such as `vault.reveal`
- **THEN** the router SHALL NOT dispatch the request to any handler
- **AND** the response SHALL be an error with machine code `unknown_namespace`
- **AND** no vault, policy, settings, or activity state is read or written

#### Scenario: Forwarding a third content-script method does not widen the privileged surface

- **GIVEN** the content script is extended to forward an additional method
- **WHEN** that method resolves to a UI-only namespace
- **THEN** the background listener still rejects the request
- **AND** the privileged surface remains unreachable from page context

#### Scenario: A page cannot publish a relay list

- **GIVEN** a message arrives at the background listener with `sender.tab` present
- **WHEN** the message requests `relayList.publish` or `relayList.publishStarter`
- **THEN** the router SHALL NOT dispatch the request
- **AND** the response SHALL be an error with machine code `unknown_namespace`
- **AND** nothing SHALL be signed or published

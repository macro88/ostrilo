# RPC Privilege Boundary Specification

## Purpose

Define which background RPC namespaces and methods are reachable from web page context and which are restricted to verified extension pages, so that privileged vault, policy, and settings operations can never be invoked by a site.
## Requirements
### Requirement: Page-Reachable RPC Namespaces Are Explicitly Limited

The background RPC router SHALL classify every registered namespace as page-reachable or UI-only. Only the `nostr` namespace SHALL be page-reachable. The `vault`, `keys`, `policy`, `settings`, `crypto`, `state`, `approval`, `activity`, and `profile` namespaces SHALL be UI-only.

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

### Requirement: UI-Only Namespaces Require A Verified Extension-Page Sender

The background listener SHALL verify the message sender before dispatching a UI-only namespace request. It SHALL require `sender.id` to equal the extension's own runtime id and SHALL require `sender.tab` to be absent.

#### Scenario: Extension page request is accepted

- **GIVEN** the popup, sidepanel, options, or approval page is open
- **WHEN** it sends `vault.reveal` with a valid password
- **THEN** the sender id matches the extension runtime id
- **AND** no `sender.tab` is present
- **AND** the router dispatches the request normally

#### Scenario: Foreign sender id is rejected

- **GIVEN** a message arrives whose `sender.id` does not match the extension runtime id
- **WHEN** the message requests a UI-only namespace
- **THEN** the request is rejected with machine code `unknown_namespace`
- **AND** the request is never dispatched to a handler

#### Scenario: Missing sender metadata is rejected

- **GIVEN** a message arrives with no `sender` object or with no `sender.id`
- **WHEN** the message requests a UI-only namespace
- **THEN** the request is rejected rather than assumed trusted

### Requirement: Unclassified Namespaces Fail Closed

A namespace registered on the router without an explicit privilege classification SHALL be treated as UI-only.

#### Scenario: New namespace defaults to UI-only

- **GIVEN** a new RPC module is registered under a namespace that is absent from the page-reachable set
- **WHEN** a request for that namespace arrives from a tab sender
- **THEN** the request is rejected with machine code `unknown_namespace`
- **AND** the namespace becomes page-reachable only by an explicit code change to the page-reachable set

### Requirement: Passwordless Export And Blind Signing Methods Are Not Routable

The RPC surface SHALL NOT expose a method that returns private-key material without password re-verification, and SHALL NOT expose a method that signs a caller-supplied hash without an origin, policy evaluation, and activity record. `vault.export` and `vault.sign` SHALL NOT exist as routable methods or as client wrappers.

#### Scenario: vault.export is no longer routable

- **GIVEN** the background router is running
- **WHEN** any caller sends a request of type `vault.export`
- **THEN** the response is an error with machine code `unknown_method`
- **AND** no private-key material is returned

#### Scenario: vault.sign is no longer routable

- **GIVEN** the background router is running
- **WHEN** any caller sends a request of type `vault.sign` with a 64-character hex hash
- **THEN** the response is an error with machine code `unknown_method`
- **AND** no signature is produced

#### Scenario: Event signing still works through the NIP-07 path

- **GIVEN** the vault is unlocked and a key is selected
- **WHEN** a page requests `nostr.signEvent`
- **THEN** the handler computes the event id itself from the selected key's public key
- **AND** evaluates policy before signing
- **AND** records the signing decision in the activity log

### Requirement: Private Key Parsing Returns A Validation Result Only

`crypto.parsePrivateKey` SHALL return only a validation verdict for the supplied input. It SHALL NOT return secret-key bytes, hex, or bech32 encodings of the parsed key. It SHALL reject public-key input because it parses private keys.

#### Scenario: Valid private key returns a verdict without material

- **GIVEN** the caller supplies a valid `nsec1` or 64-character hex private key
- **WHEN** `crypto.parsePrivateKey` is handled
- **THEN** the response reports that the input is a valid private key
- **AND** the response contains no key bytes, hex, or bech32 encoding of the key

#### Scenario: Invalid private key returns a validation error

- **GIVEN** the caller supplies input that is not a valid private key
- **WHEN** `crypto.parsePrivateKey` is handled
- **THEN** the response is an error with machine code `invalid_key_input`

#### Scenario: Public key input is rejected

- **GIVEN** the caller supplies an `npub1` public key
- **WHEN** `crypto.parsePrivateKey` is handled
- **THEN** the response is an error with machine code `invalid_key_input`

#### Scenario: Import validation still works from the UI

- **GIVEN** a user types a private key into the onboarding import step or the import dialog
- **WHEN** the UI validates the input before importing
- **THEN** the UI decides validity from the verdict alone
- **AND** the UI never holds parsed secret-key bytes

### Requirement: Extension-Internal Commands Require A Verified Extension-Page Sender

Every background message listener that performs an action outside the RPC router, including `ostrilo.openApprovalWindow`, SHALL apply the same verified extension-page sender check as UI-only RPC namespaces, and SHALL neither perform the action nor reply with a result when the check fails.

#### Scenario: An extension page opens the approval window

- **GIVEN** the Activity page sends `ostrilo.openApprovalWindow`
- **WHEN** the background receives it
- **THEN** the approval window is focused or created

#### Scenario: A content-script sender cannot open the approval window

- **GIVEN** a message `{ __command: "ostrilo.openApprovalWindow" }` whose sender URL is a web page
- **WHEN** the background receives it
- **THEN** no window is created or focused
- **AND** the sender receives no result


## MODIFIED Requirements

### Requirement: UI-Only Namespaces Require A Verified Extension-Page Sender

The background listener SHALL verify the message sender before dispatching a UI-only namespace request. It SHALL require `sender.id` to equal the extension's own runtime id AND SHALL require `sender.url` to start with the extension's own origin. The absence of `sender.tab` SHALL NOT be required: the options page opens in a tab, the approval page is a created window, and the biometric ceremony page is a created window, so all three are extension pages that carry a `sender.tab`. A matching `sender.id` alone SHALL NOT be sufficient, because the extension's own content script reports the extension's runtime id.

#### Scenario: Extension page request is accepted

- **GIVEN** the popup, sidepanel, options, approval, or biometric ceremony page is open
- **WHEN** it sends `vault.reveal` with a valid password
- **THEN** the sender id matches the extension runtime id
- **AND** the sender url starts with the extension's own origin
- **AND** the router dispatches the request normally

#### Scenario: An extension page that carries a tab is accepted

- **GIVEN** an extension page whose sender carries a `sender.tab`, such as the options page opened in a tab, the approval window, or the biometric ceremony window
- **WHEN** it sends a UI-only namespace request
- **THEN** the presence of `sender.tab` SHALL NOT cause rejection
- **AND** the router dispatches the request normally

#### Scenario: Foreign sender id is rejected

- **GIVEN** a message arrives whose `sender.id` does not match the extension runtime id
- **WHEN** the message requests a UI-only namespace
- **THEN** the request is rejected with machine code `unknown_namespace`
- **AND** the request is never dispatched to a handler

#### Scenario: A content script with a matching sender id is rejected

- **GIVEN** a message from this extension's own content script, whose `sender.id` equals the extension runtime id and whose `sender.url` is the web page's url
- **WHEN** the message requests a UI-only namespace such as `vault.reveal`
- **THEN** the request is rejected with machine code `unknown_namespace`
- **AND** the request is never dispatched to a handler
- **AND** no vault, policy, settings, or activity state is read or written

#### Scenario: Missing sender metadata is rejected

- **GIVEN** a message arrives with no `sender` object, with no `sender.id`, or with no `sender.url`
- **WHEN** the message requests a UI-only namespace
- **THEN** the request is rejected rather than assumed trusted

### Requirement: Private Key Parsing Returns A Validation Result Only

`crypto.parsePrivateKey` SHALL return only a validation verdict for the supplied input. It SHALL NOT return secret-key bytes, hex, or bech32 encodings of the parsed key. It SHALL reject public-key input because it parses private keys. Key material SHALL travel only toward the background: a document SHALL send a pseudo-random-function output and an assertion and SHALL receive a verdict, and the vault key-encryption key and the wrapped key blob SHALL NOT be returned to a document in any encoding.

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

#### Scenario: A biometric unlock returns a verdict, not key material

- **GIVEN** the ceremony document holds a pseudo-random-function output and a signed assertion
- **WHEN** it sends both to the background to complete a biometric unlock
- **THEN** the response reports only whether the vault is now unlocked
- **AND** the response contains no key-encryption key, no wrapped key blob, and no data-encryption key in any encoding

#### Scenario: No method hands a wrapping back to a document

- **GIVEN** the registered RPC surface
- **WHEN** every method that reads the stored biometric factor record is enumerated
- **THEN** none of them returns the wrapped key blob or the key-encryption key to a document as bytes, hex, base64, or an array of numbers

## ADDED Requirements

### Requirement: Biometric Methods Are Not Page-Reachable

Every biometric remote-procedure method SHALL be registered only in a UI-only namespace, and none SHALL be added to the page-reachable set. A web page or content script attempting a biometric method SHALL receive exactly the response an unregistered namespace produces, so the refusal discloses neither that the method exists nor whether a factor is enrolled.

#### Scenario: A page request for a biometric method is refused

- **GIVEN** the content script is extended to forward `vault.biometricCompleteUnlock`
- **WHEN** the request arrives at the background from a page sender
- **THEN** the response is an error with machine code `unknown_namespace`
- **AND** no challenge is minted or consumed
- **AND** the stored biometric factor record is not read

#### Scenario: The refusal is not an oracle

- **GIVEN** a page that requests a biometric method and a page that requests a namespace which was never registered
- **WHEN** both responses are compared
- **THEN** they carry the same machine code and the same detail
- **AND** neither reveals whether a biometric factor is enrolled

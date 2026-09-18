## MODIFIED Requirements

### Requirement: Key Material Does Not Cross The Realm Boundary

When the user moves between the key-handling document and other extension documents, the extension MUST NOT transfer a private key, a master password, a backup passphrase, the vault key-encryption key, or any key-wrapping key across that boundary. A WebAuthn pseudo-random-function output is directional: it MAY cross from a document to the background as the payload of a single unlock or enrolment request, and it SHALL NOT cross from the background to any document, nor from one document to another.

#### Scenario: Navigation carries no secrets

- **GIVEN** the user completes the create-key flow in the key-handling document
- **WHEN** the extension navigates to the main surface
- **THEN** no private key, master password, backup passphrase, key-encryption key, key-wrapping key, or pseudo-random-function output SHALL be passed in a URL, query string, hash fragment, or broadcast message
- **AND** the receiving document SHALL determine vault state from the background service instead

#### Scenario: Secrets are not staged in storage for handoff

- **WHEN** the extension hands off between documents during onboarding
- **THEN** it SHALL NOT write a private key, master password, backup passphrase, key-encryption key, key-wrapping key, or pseudo-random-function output to `chrome.storage`, `localStorage`, or `sessionStorage` as part of the handoff

#### Scenario: Leaving the key handling document tears down key material

- **GIVEN** the key-handling document holds a revealed key or a password
- **WHEN** the document is left or closed
- **THEN** the flow SHALL drop its references to that material before the document unloads

#### Scenario: A pseudo-random-function output travels only inward

- **GIVEN** the ceremony document has obtained a pseudo-random-function output from the authenticator
- **WHEN** it sends the unlock or enrolment request
- **THEN** the output SHALL be carried only in that request to the background
- **AND** it SHALL NOT be sent to any other document

#### Scenario: No response returns a pseudo-random-function output

- **GIVEN** a biometric unlock or enrolment request that the background has handled
- **WHEN** the response is inspected, whether the request succeeded or failed
- **THEN** it SHALL contain no pseudo-random-function output, no key-encryption key, and no key-wrapping key
- **AND** the background SHALL NOT broadcast any of them to any document

#### Scenario: The key-encryption key never leaves the background

- **GIVEN** an unlock that recovers the vault key-encryption key
- **WHEN** any document requests vault state
- **THEN** the key-encryption key and any key-wrapping key SHALL stay inside the background service
- **AND** no remote-procedure result SHALL expose either

## ADDED Requirements

### Requirement: A Pseudo-Random-Function Output Is Held Only As A Transient Buffer

A document that obtains a WebAuthn pseudo-random-function output SHALL hold it only as a byte buffer in a ref. It SHALL NOT enter component state, a URL, a query string, a hash fragment, a broadcast message, a log or error message, or any storage area. It SHALL be zeroized when the request that carries it settles, and on unmount.

#### Scenario: The output never enters component state

- **WHEN** the ceremony document holds a pseudo-random-function output
- **THEN** it SHALL be stored in a ref
- **AND** it SHALL NOT be placed in component state or any value that participates in rendering

#### Scenario: The output is zeroized when the request settles

- **GIVEN** a ceremony document that has sent an unlock or enrolment request carrying the output
- **WHEN** the request resolves or rejects
- **THEN** the document SHALL fill the buffer with zeros
- **AND** SHALL drop its reference to it

#### Scenario: The output is zeroized on unmount

- **GIVEN** a ceremony document holding a pseudo-random-function output while a request is still in flight
- **WHEN** the document unmounts or the window is closed
- **THEN** the document SHALL fill the buffer with zeros before it unloads

#### Scenario: The output is never written to storage

- **WHEN** the ceremony runs to success or to any failure
- **THEN** no pseudo-random-function output SHALL be written to `chrome.storage`, `localStorage`, `sessionStorage`, or session storage

#### Scenario: The output is never logged

- **GIVEN** a ceremony or verification step that fails
- **WHEN** the failure is reported or logged
- **THEN** no pseudo-random-function output, key-encryption key, or key-wrapping key SHALL appear in the message, the detail, or any thrown error

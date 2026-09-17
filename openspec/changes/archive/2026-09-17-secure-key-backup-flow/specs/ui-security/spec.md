## MODIFIED Requirements

### Requirement: Ephemeral Input State

The UI MUST NOT store sensitive user inputs (passwords, private keys) in persistent component state (e.g., React `useState` or `useReducer` state). Where a controlled value is unavoidable, for example to drive a live password strength meter or a confirmation match, the UI SHALL treat that value as ephemeral: it MUST be cleared when the step that needs it completes, when the flow is left, on error, and on unmount.

JavaScript strings are immutable and cannot be zeroized, so the requirement is to hold sensitive input for the shortest possible time and drop every reference to it promptly. It is not a claim that the value is erased from memory.

#### Scenario: Password Entry

- **GIVEN** a password input field
- **WHEN** the user types their password
- **THEN** the value MUST be managed via a DOM reference (`useRef`) or, where a controlled value is required for live validation, cleared as the following scenarios require
- **AND** it MUST NOT be logged, persisted, or written to storage
- **AND** it MUST NOT be retained after the step that consumed it completes

#### Scenario: Controlled password value is cleared on flow exit

- **GIVEN** a flow that holds a password and a password confirmation in reducer state to drive strength and match feedback
- **WHEN** the flow completes, is navigated away from, errors, or unmounts
- **THEN** both the password and the password confirmation MUST be cleared from that state
- **AND** any ref holding a copy of the password for a later step MUST be cleared at the same time

#### Scenario: Unlock screen password is not retained

- **GIVEN** the lock screen password input
- **WHEN** an unlock attempt succeeds or fails
- **THEN** the entered password MUST be cleared from component state

#### Scenario: Clipboard is treated as sensitive input state

- **GIVEN** the UI has written key material to the system clipboard
- **WHEN** a bounded interval no longer than 60 seconds elapses, or the flow is left, whichever comes first
- **THEN** the UI MUST attempt to clear that clipboard entry
- **AND** the UI MUST have told the user beforehand that the clear will happen

### Requirement: Secure Key Display

The UI MUST NOT persist revealed private keys in component state, MUST NOT expose them to the browser's autofill and password-manager machinery, and MUST NOT hand them to any sink outside the extension, including the filesystem in plaintext, a QR code, or an unexpiring clipboard entry.

#### Scenario: Key Backup

- **GIVEN** the user is backing up a newly generated key
- **WHEN** the key is revealed
- **THEN** it MUST be fetched via a secure RPC call that re-verifies the user's password
- **AND** it MUST be held in a non-persistent mechanism outside render state
- **AND** it MUST be cleared from the DOM immediately when the user navigates away

#### Scenario: Revealed key is excluded from autofill and spell-check

- **GIVEN** an input that displays or accepts private key material
- **WHEN** that input is rendered
- **THEN** it MUST set `autoComplete="off"`
- **AND** it MUST set `spellCheck={false}`

#### Scenario: Revealed key is never written to disk in plaintext

- **GIVEN** the user is backing up a newly generated key
- **WHEN** the user saves a backup file
- **THEN** the private key material in that file MUST be encrypted under a user-supplied passphrase
- **AND** no UI path SHALL produce a file containing the nsec or hex private key as readable text

#### Scenario: Revealed key is never encoded as a QR code

- **GIVEN** a surface that displays key material
- **WHEN** a QR code affordance is offered
- **THEN** it MUST encode only public data
- **AND** it MUST NOT encode an nsec or hex private key

#### Scenario: Clipboard copy of a revealed key expires

- **GIVEN** the user copies a revealed private key
- **WHEN** the announced expiry interval elapses or the backup flow is left
- **THEN** the UI MUST attempt to overwrite the clipboard entry
- **AND** if the Clipboard API rejects the copy or the clear, the UI MUST say so and offer manual transcription instead of failing silently

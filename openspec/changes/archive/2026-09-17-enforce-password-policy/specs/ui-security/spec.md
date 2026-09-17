## MODIFIED Requirements

### Requirement: Ephemeral Input State
The UI MUST NOT store sensitive user inputs (passwords, private keys) in persistent component state (e.g., React `useState`). This applies equally to values derived from a password for feedback purposes, such as strength meters, confirmation matching, and generated passphrases.

#### Scenario: Password Entry
- **GIVEN** a password input field
- **WHEN** the user types their password
- **THEN** the value MUST be managed via a DOM reference (`useRef`) or similar mechanism
- **AND** MUST NOT trigger re-renders that expose the value to dev tools

#### Scenario: Strength feedback without persisting the password
- **GIVEN** a new-password field showing policy feedback
- **WHEN** the strength verdict is rendered
- **THEN** only the verdict, score and violation codes MAY be held in component state
- **AND** the password itself MUST NOT be held in component state
- **AND** the feedback request MUST be debounced rather than issued on every keystroke

#### Scenario: Confirmation matching without persisting either value
- **GIVEN** a new-password field and its confirmation field
- **WHEN** the two values are compared
- **THEN** the comparison MUST read the current input values ephemerally
- **AND** only the boolean match result MAY be held in component state

#### Scenario: Generated passphrase is handed to the input, not to state
- **GIVEN** the user requests a generated passphrase
- **WHEN** the passphrase is applied to the form
- **THEN** it MUST be written directly to the input element
- **AND** MUST NOT be retained in component state, storage, or console output

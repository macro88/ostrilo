## MODIFIED Requirements

### Requirement: Ephemeral Input State

The UI MUST NOT store sensitive user inputs (passwords, private keys) in persistent component state (e.g., React `useState` or `useReducer` state). Where a controlled value is unavoidable, for example to drive a live password strength meter or a confirmation match, the UI SHALL treat that value as ephemeral: it MUST be cleared when the step that needs it completes, when the flow is left, on error, and on unmount. Clearing SHALL cover the input element's own value, not only the component state that mirrors it, on any surface whose document outlives the attempt.

Every input that accepts a password or private key MUST be excluded from the browser's credential machinery and from third-party password managers and spell-check services, so far as the available attributes allow. Those attributes are advisory and vendor conventions rather than enforcement; the obligation is to stop offering the field, not to guarantee that nothing captures it.

JavaScript strings are immutable and cannot be zeroized, so the requirement is to hold sensitive input for the shortest possible time and drop every reference to it promptly. It is not a claim that the value is erased from memory, and it is not a claim about what a script already running in the same realm can read.

This requirement previously carried the clause "MUST NOT trigger re-renders that expose the value to dev tools". It is deleted, and MUST NOT be reinstated: the stated mechanism is wrong. React DevTools reads component state whether or not a render occurs, and `document.getElementById('password').value` reads an uncontrolled input identically — so a `useRef` rewrite satisfied the letter of the clause while changing nothing about what a script in the realm can read. The realm-isolation concern it gestured at is addressed by splitting key handling into its own document, not by changing how a value is stored within one realm.

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

#### Scenario: Key import flow clears its password like the creation flow

- **GIVEN** the key import flow, which holds a password and a confirmation in reducer state
- **WHEN** the import succeeds, fails, or the flow unmounts
- **THEN** both values MUST be cleared from reducer state
- **AND** the flow MUST NOT render a later step with those values still held

#### Scenario: Strength feedback without persisting the password

- **GIVEN** a new-password field showing policy feedback
- **WHEN** the strength verdict is rendered
- **THEN** only the verdict, score and violation codes MAY be held in component state beyond the entry step
- **AND** the feedback request MUST be debounced rather than issued on every keystroke, because each request copies the password across the message boundary

#### Scenario: Confirmation matching without persisting either value

- **GIVEN** a new-password field and its confirmation field
- **WHEN** the two values are compared
- **THEN** only the boolean match result MAY be held in component state beyond the entry step
- **AND** both values MUST be cleared when the step completes, per the flow-exit scenario above

#### Scenario: Unlock screen password is not retained

- **GIVEN** the lock screen password input
- **WHEN** an unlock attempt succeeds or fails
- **THEN** the entered password MUST be cleared from component state

#### Scenario: Secret inputs are withheld from autofill and spell-check

- **GIVEN** any input that accepts a password or private key
- **WHEN** that input is rendered
- **THEN** it MUST set `autoComplete="off"` and `spellCheck={false}`
- **AND** it MUST carry the vendor opt-out attributes used elsewhere in the product for the same purpose
- **AND** these attributes MUST come from one shared declaration rather than being repeated per component

#### Scenario: Input element value is cleared where the document outlives the attempt

- **GIVEN** a password input on a surface whose document is not torn down after the attempt, such as the options page or the side panel
- **WHEN** the attempt completes, fails, or the component unmounts, or the page is hidden
- **THEN** the input element's `value` MUST be cleared in addition to any component state
- **AND** that teardown path MUST NOT call `setState`, because it runs while the component is being unmounted

#### Scenario: Clipboard is treated as sensitive input state

- **GIVEN** the UI has written key material to the system clipboard
- **WHEN** a bounded interval no longer than 60 seconds elapses, or the flow is left, whichever comes first
- **THEN** the UI MUST attempt to clear that clipboard entry
- **AND** the UI MUST have told the user beforehand that the clear will happen

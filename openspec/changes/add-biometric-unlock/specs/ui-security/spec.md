## MODIFIED Requirements

### Requirement: Ephemeral Input State

The UI MUST NOT store sensitive user inputs (passwords, private keys) in persistent component state (e.g., React `useState` or `useReducer` state). Where a controlled value is unavoidable, for example to drive a live password strength meter or a confirmation match, the UI SHALL treat that value as ephemeral: it MUST be cleared when the step that needs it completes, when the flow is left, on error, and on unmount. Clearing SHALL cover the input element's own value, not only the component state that mirrors it, on any surface whose document outlives the attempt.

Every input that accepts a password or private key MUST be excluded from the browser's credential machinery and from third-party password managers and spell-check services, so far as the available attributes allow. Those attributes are advisory and vendor conventions rather than enforcement; the obligation is to stop offering the field, not to guarantee that nothing captures it.

JavaScript strings are immutable and cannot be zeroized, so the requirement is to hold sensitive input for the shortest possible time and drop every reference to it promptly. It is not a claim that the value is erased from memory, and it is not a claim about what a script already running in the same realm can read.

The biometric ceremony document is a key-handling document and SHALL be listed as one. It SHALL hold the authenticator's pseudo-random-function output only as a byte buffer in a ref, never in component state and never as a string; it SHALL zeroize that buffer when the unlock or enrolment request settles, whether it succeeds, fails, or is cancelled, and again on unmount; it SHALL close itself once the request resolves; and it SHALL render no key list and load no three-dimensional rendering library.

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

#### Scenario: Generated passphrase is handed to the input, not to state

- **GIVEN** the user requests a generated passphrase
- **WHEN** the passphrase is applied to the form
- **THEN** it MUST be written directly to the input element
- **AND** MUST NOT be retained in component state, storage, or console output

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

#### Scenario: The ceremony document holds the authenticator output only in a ref

- **GIVEN** the biometric ceremony document has received a pseudo-random-function output from the authenticator
- **WHEN** the component tree is inspected
- **THEN** the output MUST be held only as a byte buffer in a ref
- **AND** it MUST NOT appear in component state, in a string, in storage, or in console output

#### Scenario: The ceremony document zeroizes the output when the request settles

- **GIVEN** the ceremony document has sent the pseudo-random-function output to the background
- **WHEN** the request resolves, rejects, or is cancelled
- **THEN** the ref's buffer MUST be filled with zeros
- **AND** the buffer MUST be filled with zeros again on unmount if it is still held

#### Scenario: The ceremony document closes itself when the request resolves

- **GIVEN** a biometric unlock or enrolment request in flight from the ceremony document
- **WHEN** that request resolves
- **THEN** the document MUST close its own window
- **AND** MUST NOT remain open holding the outcome

#### Scenario: The ceremony document carries no key list and no decorative renderer

- **WHEN** the ceremony document is rendered
- **THEN** it MUST render no key list, no npub, and no revealed key material
- **AND** it MUST NOT load a three-dimensional rendering library
- **AND** it MUST appear in the shared key-handling document list for the builds that contain it

## ADDED Requirements

### Requirement: The Lock Screen Keeps One Primary Action

The lock screen SHALL present password unlock as its single notched primary action. The biometric affordance SHALL be a ghost control and SHALL NOT be notched, so no screen carries two primaries. The affordance SHALL be rendered only when the extension reports that a usable factor is enrolled, the password rehearsal is not due, and this is not the first unlock of the browser session; in every other case it SHALL be absent rather than disabled.

#### Scenario: The biometric affordance is a ghost beside the notched primary

- **GIVEN** a lock screen offering both password and biometric unlock
- **WHEN** the screen is rendered
- **THEN** the password unlock action MUST be the only notched control on the screen
- **AND** the biometric affordance MUST be a ghost control

#### Scenario: No usable factor withdraws the affordance

- **GIVEN** the extension reports no enrolled factor, or a factor it reports as permanently unusable
- **WHEN** the lock screen renders
- **THEN** the biometric affordance MUST NOT be rendered
- **AND** no disabled biometric control MUST be rendered in its place

#### Scenario: A due rehearsal withdraws the affordance

- **GIVEN** the extension reports that the password rehearsal is due
- **WHEN** the lock screen renders
- **THEN** the biometric affordance MUST NOT be rendered
- **AND** the screen MUST show one line stating that the password is needed this time

#### Scenario: The first unlock of a browser session withdraws the affordance

- **GIVEN** the extension reports that this is the first unlock since the browser started or the extension updated
- **WHEN** the lock screen renders
- **THEN** the biometric affordance MUST NOT be rendered
- **AND** the screen MUST show one line stating that the first unlock uses the password

### Requirement: Enable-Time Disclosure Of The Biometric Factor

Before any biometric factor is enrolled, the enabling surface SHALL state, in its own copy and not behind a link or a disclosure toggle: that the password remains required and cannot be removed; that a biometric session cannot reveal or export a key; that deleting the credential in the platform's own credential manager loses only the shortcut and no key material; that a credential which syncs between devices makes this factor as strong as the account it syncs through; and that biometric unlock may be compelled in jurisdictions where disclosing a password may not. The copy SHALL NOT name a specific biometric modality — it SHALL NOT use "Touch ID", "Face ID", "Windows Hello", "fingerprint" or "face" — because which authenticator answers is not knowable at build time.

#### Scenario: All five statements are present before enrolment

- **GIVEN** a vault with no biometric factor enrolled
- **WHEN** the surface that enables the factor is rendered
- **THEN** it MUST state that the password remains required and cannot be removed
- **AND** it MUST state that a biometric session cannot reveal or export a key
- **AND** it MUST state that deleting the credential in the platform's credential manager loses only the shortcut
- **AND** it MUST state that a credential which syncs between devices makes this factor as strong as that account
- **AND** it MUST state that biometric unlock may be compelled where disclosing a password may not

#### Scenario: The disclosure is not hidden behind an affordance

- **WHEN** the enabling surface is rendered
- **THEN** the five statements MUST be visible without expanding a disclosure, opening a dialog, or following a link
- **AND** the enable action MUST NOT be reachable on a surface that omits them

#### Scenario: No copy names a biometric modality

- **WHEN** any biometric copy on the lock screen, the ceremony document, or the settings surface is inspected
- **THEN** it MUST NOT contain "Touch ID", "Face ID", "Windows Hello", "fingerprint" or "face"
- **AND** it MUST refer to the factor by what the user does, not by which sensor answers

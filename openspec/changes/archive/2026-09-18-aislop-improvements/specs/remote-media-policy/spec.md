## ADDED Requirements

### Requirement: Render Boundary Rejects Non-Https URLs Independently Of Validation

A surface that renders a remote-party URL SHALL apply the `https:`-only allowlist at
the point of rendering, independently of the validation the value already passed. A
value that fails the allowlist SHALL be rendered as though the field were empty: the
surface SHALL NOT display the URL text, and SHALL NOT offer a control that copies the
value or opens it in a browser tab.

This is defense in depth behind metadata validation, not a substitute for it. A
profile cached before the allowlist existed, or a record written by an earlier
version, can still carry a non-`https:` value, and reaching a render path is not
evidence that a value was validated.

#### Scenario: A non-https URL is presented as an empty field

- **GIVEN** a profile URL field whose value uses the `http:`, `javascript:`, `data:`, or `file:` scheme
- **WHEN** the field renders
- **THEN** the surface MUST render the empty-field control that invites the user to add a value
- **AND** the URL text MUST NOT appear anywhere in the rendered output
- **AND** no copy control MUST be rendered for that value
- **AND** no control that opens the value in a browser tab MUST be rendered

#### Scenario: An empty field and a rejected value are both inert but distinguishable

- **GIVEN** one URL field with an empty value and another whose value fails the allowlist
- **WHEN** both render
- **THEN** neither MUST expose a copy or open control
- **AND** the empty field MUST be treated as a field the user may still fill
- **AND** the rejected value MUST NOT be recoverable from the rendered output

#### Scenario: An allowed URL keeps its inspection affordances

- **GIVEN** a profile URL field whose value uses the `https:` scheme
- **WHEN** the field renders
- **THEN** the URL MUST be shown as monospace text
- **AND** a copy control MUST be rendered
- **AND** a control that opens the value in a new tab MUST be rendered
- **AND** the extension MUST NOT fetch the URL to render the field

#### Scenario: Opening is refused for a value that fails the allowlist

- **GIVEN** a URL field holding a value that fails the allowlist
- **WHEN** an open action is dispatched against that field
- **THEN** no browser tab MUST be opened
- **AND** the extension MUST NOT navigate to the value

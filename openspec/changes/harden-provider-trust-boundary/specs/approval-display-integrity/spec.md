## ADDED Requirements

### Requirement: Approved Payload Equals Signed Payload

The approval surface SHALL present the exact payload that will be signed. The extension SHALL NOT alter, normalize, or truncate event bytes between display and signing, and the display SHALL NOT be capable of misrepresenting those bytes.

#### Scenario: No mutation between approval and signing

- **GIVEN** a pending signing request is displayed in the approval detail view
- **WHEN** the user approves the request
- **THEN** the signed event SHALL carry the same `kind`, `content`, `tags`, and `created_at` bytes that were displayed
- **AND** the extension SHALL NOT modify the payload to make it displayable

#### Scenario: Raw JSON reflects the exact payload

- **GIVEN** a pending signing request is displayed
- **WHEN** the user opens the raw JSON view
- **THEN** the JSON SHALL represent the exact event fields that will be serialized for the event id
- **AND** the signing public key shown SHALL be the key bound to the request

#### Scenario: Payloads that cannot be validated never reach the dialog

- **GIVEN** a signing request whose event exceeds the accepted size bounds
- **WHEN** the background script validates the request
- **THEN** the request SHALL be rejected with `invalid_event`
- **AND** no approval entry SHALL be created for it

---

### Requirement: Full Origin Display With Scheme

Every approval surface that identifies the requesting site SHALL display the complete origin, including the URL scheme and any non-default port. The security-relevant part of the origin SHALL NOT be visually truncated, and the hostname SHALL be rendered in the punycode ASCII form produced by `URL.hostname`.

#### Scenario: HTTPS origin shows its scheme

- **GIVEN** a pending request from `https://primal.net`
- **WHEN** the approval detail view is displayed
- **THEN** the displayed origin SHALL include the `https://` scheme
- **AND** SHALL read `https://primal.net`

#### Scenario: Plaintext origin is visually distinct from its HTTPS counterpart

- **GIVEN** a pending request from `http://example.com`
- **AND** a separate pending request from `https://example.com`
- **WHEN** each approval detail view is displayed
- **THEN** the two displayed origins SHALL differ
- **AND** neither SHALL render as a bare `example.com`

#### Scenario: Non-default port is shown

- **GIVEN** a pending request from `https://example.com:8443`
- **WHEN** the approval detail view is displayed
- **THEN** the displayed origin SHALL include the `:8443` port

#### Scenario: Internationalized hostname stays in punycode

- **GIVEN** a pending request from an internationalized domain whose ASCII form begins with `xn--`
- **WHEN** the approval detail view is displayed
- **THEN** the hostname SHALL be displayed in its punycode ASCII form
- **AND** SHALL NOT be displayed as the Unicode form that permits homoglyph spoofing

#### Scenario: Long origins are not clipped

- **GIVEN** a pending request from an origin long enough to exceed the available width
- **WHEN** the approval detail view is displayed
- **THEN** the full origin SHALL remain readable through wrapping or an equivalent affordance
- **AND** SHALL NOT be replaced by a CSS-truncated string that hides the scheme or hostname

---

### Requirement: Non-HTTPS Origin Is Flagged

When a signing request arrives from an origin that is not HTTPS, the approval surface SHALL display an explicit warning that the connection is not encrypted and that the site's identity cannot be trusted.

#### Scenario: Plaintext origin shows a warning

- **GIVEN** a pending request from a non-HTTPS origin
- **WHEN** the approval detail view is displayed
- **THEN** a warning SHALL state that the connection is not encrypted
- **AND** the warning SHALL state that the request may not come from the site the user expects

#### Scenario: HTTPS origin shows no connection warning

- **GIVEN** a pending request from an HTTPS origin
- **WHEN** the approval detail view is displayed
- **THEN** no unencrypted-connection warning SHALL be displayed

---

### Requirement: True Payload Size Disclosure

The approval surface SHALL disclose the true size of the payload being approved, measured in UTF-8 bytes, and SHALL indicate when content extends beyond the visible region.

#### Scenario: Content byte length is displayed

- **GIVEN** a pending request whose content is 12,000 UTF-8 bytes
- **WHEN** the approval detail view is displayed
- **THEN** the content panel SHALL show the content size in bytes
- **AND** the displayed size SHALL be the UTF-8 byte length, not the JavaScript string length

#### Scenario: Overflowing content is marked as overflowing

- **GIVEN** a pending request whose content does not fit in the content panel's visible region
- **WHEN** the approval detail view is displayed
- **THEN** the view SHALL indicate that content continues beyond the visible region
- **AND** the user SHALL be able to reach the remainder by scrolling or expanding the panel

#### Scenario: Tag totals are displayed

- **GIVEN** a pending request with 240 tags
- **WHEN** the approval detail view is displayed
- **THEN** the tag section SHALL show the tag count
- **AND** SHALL show the total serialized size of the tags in bytes

---

### Requirement: Invisible And Direction-Control Characters Are Neutralized In Display

The approval surface SHALL render bidirectional control characters, zero-width characters, other Unicode format characters, and C0/C1 control characters other than newline and tab as visible escapes, and SHALL warn that such characters are present. The event bytes that get signed SHALL NOT be altered.

#### Scenario: Direction override is escaped

- **GIVEN** a pending request whose content contains `U+202E` RIGHT-TO-LEFT OVERRIDE
- **WHEN** the approval detail view renders the content
- **THEN** the character SHALL be shown as a visible escape identifying `U+202E`
- **AND** the rendered text SHALL NOT be reordered by the override

#### Scenario: Zero-width characters are escaped

- **GIVEN** a pending request whose content contains `U+200B`, `U+200D`, or `U+FEFF`
- **WHEN** the approval detail view renders the content
- **THEN** each such character SHALL be shown as a visible escape identifying its code point

#### Scenario: Tag values are neutralized the same way

- **GIVEN** a pending request whose tag values contain bidirectional or zero-width control characters
- **WHEN** the tag panel renders those values
- **THEN** the characters SHALL be shown as visible escapes

#### Scenario: Presence of hidden characters is announced

- **GIVEN** a pending request whose content or tags contain at least one escaped character
- **WHEN** the approval detail view is displayed
- **THEN** the view SHALL state that the payload contains hidden or direction-control characters
- **AND** SHALL state how many were found

#### Scenario: Signed bytes are unchanged

- **GIVEN** a pending request whose content contains `U+202E`
- **WHEN** the user approves the request
- **THEN** the signed event content SHALL contain the original `U+202E` character
- **AND** the computed event id SHALL match the original unescaped bytes

#### Scenario: Legitimate right-to-left text remains signable

- **GIVEN** a pending request whose content is ordinary Arabic or Hebrew text
- **WHEN** the request is validated and displayed
- **THEN** the request SHALL NOT be rejected for containing right-to-left text
- **AND** the content SHALL remain readable in the approval view

---

### Requirement: Signing Key Is Bound To The Request

Each pending approval request SHALL carry the signing public key that the extension bound to it when it was enqueued, and the approval surface SHALL display that key rather than the currently selected key.

#### Scenario: Displayed key comes from the pending request

- **GIVEN** a pending signing request enqueued while key A was selected
- **WHEN** the approval detail view displays the request
- **THEN** the "Signing as" row SHALL show key A's public key
- **AND** the value SHALL come from the pending request record

#### Scenario: Changing the active key does not change a pending request

- **GIVEN** a pending signing request bound to key A
- **WHEN** the user selects key B in the extension UI
- **AND** the approval detail view for that request is displayed
- **THEN** the "Signing as" row SHALL still show key A
- **AND** approving the request SHALL sign with key A

#### Scenario: Bound key matches the de-duplication hash

- **GIVEN** a pending request whose event id hash was computed with key A's public key
- **WHEN** the request is approved
- **THEN** the signed event `pubkey` SHALL be key A's public key
- **AND** the signed event `id` SHALL equal the displayed event id hash

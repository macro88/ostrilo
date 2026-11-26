## MODIFIED Requirements

### Requirement: Outbound Media Upload Destination Is Explicit

The extension SHALL NOT select an upload destination for the user. It MAY ship a curated list of candidate servers, defined once and restricted to `https:` origins. Any outbound upload of user media SHALL go to a server the user chose from that list, SHALL be disclosed to the user before every upload, and SHALL be confirmed by the user. The extension SHALL NOT contain a default destination, and SHALL NOT accept a destination typed by the user.

#### Scenario: No upload destination is selected by default

- **GIVEN** a fresh install
- **WHEN** the user opens the profile editor
- **THEN** no upload destination MUST be selected
- **AND** no request MUST be made to any server on the curated list
- **AND** choosing an image MUST open a dialog in which the user selects a destination, and MUST NOT send anything

#### Scenario: Destination is disclosed and confirmed before every upload

- **GIVEN** the user has chosen an image
- **WHEN** the upload dialog is open
- **THEN** the UI MUST name the host that will receive the image, and state that the host will see the image, the user's IP address and the user's public key
- **AND** the upload MUST proceed only after the user confirms
- **AND** the dialog MUST appear again for the next upload even if a destination was remembered

#### Scenario: Only listed https destinations are possible

- **WHEN** a destination is chosen, stored or used
- **THEN** it MUST be one of the curated servers
- **AND** every curated server's origin MUST use the `https:` scheme
- **AND** a destination that is not on the list, including any URL typed by the user, MUST be rejected

#### Scenario: Returned upload URL is validated before use

- **GIVEN** a server answers an upload with a blob descriptor
- **WHEN** the extension handles the response
- **THEN** the returned URL MUST pass the `https:`-only allowlist before it is written into the form field
- **AND** a non-conforming returned URL MUST be reported to the user as a failed upload
- **AND** the returned URL MUST NOT be fetched or rendered by the extension page

#### Scenario: Upload hosts are a declared egress

- **WHEN** the extension issues an upload request
- **THEN** the destination MUST be reachable under the `connect-src` policy the manifest declares
- **AND** that policy MUST name exactly the curated servers' origins besides secure WebSockets
- **AND** the extension MUST NOT make outbound requests to hosts outside the declared egress set

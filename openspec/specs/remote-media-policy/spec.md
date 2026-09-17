# remote-media-policy Specification

## Purpose

Constrain how URLs and media supplied by relays or remote services are validated, stored, and rendered, so privileged extension pages never fetch a relay-chosen host and only `https:` destinations are accepted.

## Requirements

### Requirement: Remote URL Scheme Allowlist

The extension SHALL accept a URL supplied by a remote party only when it uses the `https:` scheme. The allowlist SHALL be enforced at the validation boundary, before the value is cached, returned over RPC, or rendered.

#### Scenario: Only https URLs survive validation

- **GIVEN** relay-supplied profile metadata contains a `picture`, `banner`, or `website` value
- **WHEN** the metadata is validated
- **THEN** a value whose scheme is `https:` MUST be retained
- **AND** a value whose scheme is `http:`, `javascript:`, `data:`, `blob:`, `file:`, `ws:`, or `wss:` MUST be omitted from the validated metadata
- **AND** a value that does not parse as an absolute URL MUST be omitted
- **AND** a value longer than 512 characters MUST be omitted

#### Scenario: Rejected URL does not reject the whole profile

- **GIVEN** relay-supplied profile metadata contains a valid `name` and a `picture` value of `javascript:alert(1)`
- **WHEN** the metadata is validated
- **THEN** the `name` MUST be retained
- **AND** the `picture` field MUST be absent from the validated metadata
- **AND** the validation outcome MUST be recorded as a rejected field rather than a fetch failure

#### Scenario: Allowlist applies to user-entered values too

- **GIVEN** the user types a `picture` or `website` value in the profile editor
- **WHEN** the value is submitted through `profile.update`
- **THEN** the same `https:`-only allowlist MUST be applied
- **AND** a non-conforming value MUST be rejected with a field-level validation error rather than silently dropped

#### Scenario: Rendered links are constrained

- **GIVEN** validated profile metadata contains a `website` value
- **WHEN** the value is rendered as a link in an extension page
- **THEN** the link MUST target a new tab with `rel="noopener noreferrer"`
- **AND** the extension MUST NOT navigate a privileged extension page to the remote URL


### Requirement: Privileged Extension Pages Do Not Load Relay-Chosen Media

The extension SHALL NOT initiate a network request to a host chosen by a relay while rendering a privileged extension page. Relay-supplied avatar and banner URLs SHALL NOT be used as the source of an image element in the popup, side panel, options page, or approval window.

#### Scenario: Profile avatar uses a local fallback

- **GIVEN** validated profile metadata for the selected key contains a `picture` URL
- **WHEN** the profile surface renders the avatar
- **THEN** the extension MUST render the local seal avatar with the profile initial
- **AND** the extension MUST NOT set the relay-supplied URL as an image source
- **AND** no request MUST be made to the relay-supplied host

#### Scenario: Key selector avatars use a local fallback

- **GIVEN** the user manages several keys with relay-supplied `picture` URLs
- **WHEN** the key selector or the settings key list renders
- **THEN** each entry MUST render the local seal avatar with the key's profile initial
- **AND** no request MUST be made to any relay-supplied host
- **AND** the identity shown MUST remain distinguishable by display name and truncated npub

#### Scenario: Avatar URL remains inspectable without being fetched

- **GIVEN** validated profile metadata contains a `picture` URL
- **WHEN** the user views the profile surface
- **THEN** the URL MUST be available to the user as monospace text with a copy affordance
- **AND** viewing the image MUST require an explicit user action that opens the URL in an ordinary browser tab

#### Scenario: Extension pages declare no remote image sources

- **GIVEN** the extension Content Security Policy is declared by the companion change `harden-manifest-and-build`
- **WHEN** `img-src` is set to `'self' data:`
- **THEN** no extension page MUST depend on loading an image from a remote host
- **AND** this capability MUST NOT introduce a rendering path that would require widening `img-src`


### Requirement: Outbound Media Upload Destination Is Explicit

The extension SHALL NOT contain a hardcoded third-party upload destination. Any outbound upload of user media SHALL go to a destination that is configured, disclosed to the user before the upload, and restricted to `https:`.

#### Scenario: No upload destination is configured by default

- **GIVEN** a fresh install
- **WHEN** the user opens the profile editor
- **THEN** no upload destination MUST be configured
- **AND** the upload control MUST be unavailable
- **AND** the UI MUST explain that no image host is configured and that a URL can be pasted instead

#### Scenario: Configured destination is disclosed before upload

- **GIVEN** the user has configured an upload endpoint
- **WHEN** the user selects an image to upload
- **THEN** the UI MUST name the host that will receive the image before the request is sent
- **AND** the upload MUST proceed only after the user confirms

#### Scenario: Upload endpoint restricted to https

- **GIVEN** the user configures an upload endpoint
- **WHEN** the value is validated
- **THEN** only an `https:` URL MUST be accepted
- **AND** any other scheme MUST be rejected with a validation error

#### Scenario: Returned upload URL is validated before use

- **GIVEN** a configured upload service responds with a URL
- **WHEN** the extension handles the response
- **THEN** the returned URL MUST pass the `https:`-only allowlist before it is written into profile metadata
- **AND** a non-conforming returned URL MUST be reported to the user as a failed upload
- **AND** the returned URL MUST NOT be fetched or rendered by the extension page

#### Scenario: Upload host is a declared egress

- **GIVEN** an upload endpoint is configured
- **WHEN** the extension issues the upload request
- **THEN** the destination MUST be reachable under the `connect-src` policy declared by `harden-manifest-and-build`
- **AND** the extension MUST NOT make outbound requests to hosts outside the declared egress set


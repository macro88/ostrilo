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

The extension SHALL NOT initiate a network request to a host chosen by a relay while rendering a privileged extension page. Relay-supplied avatar and banner URLs SHALL NOT be used as the source of an image element in the popup, side panel, options page, or approval window. The one exception is the Profile page loading the user's own picture on an explicit save or refresh, defined by "Own Profile Picture Is Kept As A Local Copy"; everything else SHALL render only the local copy that exception produces, or the seal.

#### Scenario: Profile avatar uses a local fallback

- **GIVEN** validated profile metadata for the selected key contains a `picture` URL
- **WHEN** the profile surface renders the avatar
- **THEN** the extension MUST render the local seal avatar with the profile initial
- **AND** the extension MUST NOT set the relay-supplied URL as an image source
- **AND** no request MUST be made to the relay-supplied host

#### Scenario: Key selector avatars use a local fallback

- **GIVEN** the user manages several keys with relay-supplied `picture` URLs
- **WHEN** the key selector list or the settings key list renders
- **THEN** each entry MUST render the local seal avatar with the key's profile initial
- **AND** no request MUST be made to any relay-supplied host
- **AND** the identity shown MUST remain distinguishable by display name and truncated npub

#### Scenario: The header shows only a local copy

- **GIVEN** the selected key has a local copy of its picture
- **WHEN** the header renders
- **THEN** the header avatar MUST be an image whose source is a `data:` URL
- **AND** no request MUST be made to any host, whether the popup, the side panel or an approval window opened, the vault unlocked, or the key was switched
- **AND** a header whose key has no copy MUST render the seal

#### Scenario: Avatar URL remains inspectable without being fetched

- **GIVEN** validated profile metadata contains a `picture` URL
- **WHEN** the user views the profile surface
- **THEN** the URL MUST be available to the user as monospace text with a copy affordance
- **AND** viewing the image MUST require an explicit user action that opens the URL in an ordinary browser tab

#### Scenario: The image directive is a backstop, not the policy

- **GIVEN** the extension Content Security Policy declares `img-src 'self' data: https:`
- **WHEN** a surface other than the Profile page's explicit load renders an image
- **THEN** the source MUST be a `data:` URL or a bundled file, whatever the policy would permit
- **AND** `connect-src` MUST NOT be widened to carry the picture, so the only way an extension page reaches the image host is an image element
- **AND** this capability MUST NOT introduce a rendering path that depends on a remote image

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

### Requirement: Own Profile Picture Is Kept As A Local Copy

The extension SHALL show the user's own profile picture in the header from a small local copy, made only when the user saves their profile with a picture or presses Refresh picture on the Profile view. The Profile page SHALL load the picture URL itself, shrink it, and hand the encoded copy to the background through a validated UI-only RPC. The background SHALL store the copy and SHALL NOT fetch anything.

#### Scenario: Saving a profile with a picture makes one copy

- **GIVEN** the user saves their profile and the saved `picture` is non-empty
- **WHEN** the `profile.update` succeeds
- **THEN** the Profile page MUST load that URL exactly once
- **AND** the load MUST use `crossOrigin="anonymous"` and `referrerPolicy="no-referrer"`
- **AND** the URL MUST be `https:`, checked by the existing URL allowlist before the request
- **AND** the page MUST NOT retry, poll or reload the picture afterwards

#### Scenario: Refresh picture makes one copy per press

- **GIVEN** the Profile view shows a profile with an `https:` picture URL
- **WHEN** the user presses Refresh picture
- **THEN** the Profile page MUST load the URL exactly once and replace the copy on success
- **AND** a profile with no picture MUST NOT offer the control

#### Scenario: Saving a profile without a picture removes the copy

- **GIVEN** the selected key has a local copy
- **WHEN** the user saves a profile whose `picture` is empty
- **THEN** the copy for that key MUST be removed and the header MUST show the seal

#### Scenario: Nothing else loads an image

- **WHEN** the popup, the side panel, the options page or an approval window opens, the vault unlocks, or the user switches keys
- **THEN** no image request MUST be made to any host
- **AND** a failed refresh MUST NOT be retried in the background

#### Scenario: The copy is bounded

- **WHEN** the Profile page loads a picture
- **THEN** it MUST give up after 10 seconds
- **AND** it MUST refuse an image whose natural width or height exceeds 4096 pixels, without drawing it
- **AND** it MUST draw the centre-cropped square of the image onto a 96 by 96 canvas
- **AND** it MUST encode the result as `image/webp`, falling back to `image/png` where the browser has no webp encoder

#### Scenario: A picture that cannot be loaded keeps the seal

- **GIVEN** the load fails, the canvas is tainted, the load times out, the image is over the size limit, or the image cannot be encoded
- **WHEN** the Profile page settles
- **THEN** no copy MUST be stored and the header MUST keep the seal
- **AND** the Profile view MUST say so in a short note, using one generic note ("Ostrilo couldn't load this picture to keep a copy, so the header shows your seal.") for a failed load, a refused cross-origin read and a tainted canvas, because a browser reports them alike, and distinct notes for a timeout, an oversize image, a non-`https:` URL and an encoding failure
- **AND** a copy made from an earlier picture URL MUST be removed, because it would show a picture the user has replaced
- **AND** a copy made from the same URL MUST be kept

#### Scenario: The background stores a validated copy and never fetches

- **WHEN** the Profile page sends `avatar.save`
- **THEN** the RPC MUST be UI-only and refused while the vault is locked
- **AND** the public key MUST be 64 lowercase hex characters and belong to a key in the vault
- **AND** the source URL MUST pass the `https:` allowlist
- **AND** the image MUST be a `data:image/webp;base64,` or `data:image/png;base64,` URL of at most 64 KiB whose bytes begin with the declared format's header
- **AND** any other request MUST be refused with `invalid_params` or `key_not_found` and MUST store nothing
- **AND** the background MUST NOT make a network request to read, refresh or verify a picture

#### Scenario: One copy per key, with its source and time

- **GIVEN** a vault with several keys
- **WHEN** copies are saved, replaced and removed
- **THEN** the non-secret `storage.local` record MUST hold at most one entry per public key, each with its image, its source URL and the time it was made
- **AND** a save MUST drop entries whose public key is no longer in the vault

#### Scenario: Deleting a key removes its copy

- **GIVEN** a key with a local copy
- **WHEN** the vault deletes the key
- **THEN** the key MUST be zeroized and the selection repaired before the copy is removed
- **AND** a failure to remove the copy MUST NOT abort or undo the deletion

#### Scenario: The header never shows another identity's picture

- **GIVEN** two keys, one with a copy
- **WHEN** the user switches between them
- **THEN** the header MUST show only the selected key's own copy, or the seal, at every render
- **AND** the image MUST have fixed dimensions and alternative text naming the identity
- **AND** saving or refreshing on the Profile page MUST update the header without reloading the extension


## ADDED Requirements

### Requirement: Upload Servers Come From A Curated List, And None Is Selected By Default

The extension SHALL ship one ordered list of Blossom servers, each with an id, a display name and an `https:` origin, defined in a single domain-layer module. Every consumer of server identity (the upload dialog, the settings schema, the `blossom.authorizeUpload` schema and the generated manifest policy) SHALL read that module. A fresh install SHALL have no server selected and SHALL make no request to any server on the list.

#### Scenario: Fresh install contacts no server

- **GIVEN** a fresh install with no stored `blossomServer`
- **WHEN** the user opens the profile editor, edits fields and saves
- **THEN** no request MUST be made to any origin on the curated list
- **AND** no `blossom.authorizeUpload` call MUST be made

#### Scenario: A settings write may only name a listed server

- **WHEN** a `settings.update` patch sets `blossomServer`
- **THEN** a value that is the id of a listed server MUST be accepted
- **AND** any other value, including a URL, MUST be rejected with a validation error
- **AND** `uploadEndpoint` MUST NOT be accepted by the patch schema

#### Scenario: A stored server that left the list reads as unset

- **GIVEN** stored settings contain a `blossomServer` id that is not in the current list
- **WHEN** the settings are read
- **THEN** `blossomServer` MUST read as unset
- **AND** the upload dialog MUST preselect no server

#### Scenario: A stored upload endpoint is dropped

- **GIVEN** stored settings contain an `uploadEndpoint` value
- **WHEN** the settings are read
- **THEN** the value MUST NOT appear in the returned settings
- **AND** no request MUST ever be made to it

### Requirement: Every Upload Is Confirmed In A Dialog That Names The Host And What It Will See

Choosing a file SHALL open a confirmation dialog before the image is decoded, prepared, hashed, signed or sent. Only a header inspection MAY precede the dialog, and it SHALL read at most 4 KiB of the file, in slices. The dialog SHALL list the curated servers, SHALL name the chosen host, and SHALL state that the host will see the image, the user's IP address and the user's public key, that the image will be publicly reachable, and that a host may remove files. The dialog SHALL appear for every upload, whether or not a server was chosen before.

#### Scenario: Nothing happens before confirmation

- **GIVEN** the user has chosen a file
- **WHEN** the dialog is open
- **THEN** no `blossom.authorizeUpload` call MUST have been made
- **AND** no request MUST have been sent to any server
- **AND** no pixel data MUST have been decoded and no hash computed
- **AND** no more than 4 KiB of the file MUST have been read

#### Scenario: Upload is unavailable until a host is chosen

- **GIVEN** no server has been chosen
- **WHEN** the dialog opens
- **THEN** no server MUST be preselected
- **AND** the Upload action MUST be disabled until the user selects one

#### Scenario: A remembered server is preselected and still confirmed

- **GIVEN** the user previously confirmed an upload to server A
- **WHEN** they choose another file
- **THEN** the dialog MUST open with server A preselected
- **AND** the upload MUST NOT start until the user confirms

#### Scenario: Confirming stores the choice

- **WHEN** the user selects a server and confirms
- **THEN** `blossomServer` MUST be written with that server's id
- **AND** cancelling the dialog MUST NOT change `blossomServer`

#### Scenario: Cancelling sends nothing

- **WHEN** the user cancels the dialog, presses Escape, or clicks outside it
- **THEN** no request MUST be sent
- **AND** no `blossom.authorizeUpload` call MUST be made
- **AND** the form field MUST keep its previous value

#### Scenario: The dialog says whether the file will be re-encoded

- **WHEN** the dialog opens for a still image
- **THEN** it MUST state that the image will be re-encoded and that embedded details such as location will be removed
- **WHEN** the dialog opens for an image that will be uploaded unchanged
- **THEN** it MUST state that the image will be uploaded unchanged and that details embedded in the file remain

### Requirement: Image Type Is Judged From The File's Bytes

The extension SHALL accept only JPEG, PNG, GIF and WebP, identified by their byte signatures. The type label supplied by the browser or the file's extension SHALL NOT be used to accept a file. SVG SHALL be refused. A file larger than 5 MiB, and an empty file, SHALL be refused before any other step. The judgement SHALL be made by the header inspection, before the dialog opens, reading at most 4 KiB in total: the signature, the WebP flags, and for a PNG at most 256 chunk headers up to its first image-data chunk.

#### Scenario: A valid image with a wrong label is accepted by its bytes

- **GIVEN** a file whose bytes are a PNG and whose reported type is `application/octet-stream`
- **WHEN** the user chooses it
- **THEN** it MUST be accepted as a PNG

#### Scenario: A mislabelled non-image is refused

- **GIVEN** a file whose reported type is `image/png` and whose bytes are an HTML document
- **WHEN** the user chooses it
- **THEN** it MUST be refused with "Choose a JPEG, PNG, GIF or WebP image."
- **AND** the dialog MUST NOT open

#### Scenario: SVG is refused

- **GIVEN** an SVG file
- **WHEN** the user chooses it
- **THEN** it MUST be refused with the same message

#### Scenario: Size limits are enforced first

- **GIVEN** a file of 5 MiB plus one byte, and an empty file
- **WHEN** the user chooses each
- **THEN** each MUST be refused with a message naming the limit or the empty file
- **AND** neither MUST be decoded

#### Scenario: Inspection reads a bounded header only

- **WHEN** the user chooses a JPEG, PNG, GIF or WebP file of any size up to the limit
- **THEN** the header inspection MUST read no more than 4 KiB of it
- **AND** it MUST NOT decode pixels or compute a hash

#### Scenario: A PNG whose chunks cannot be walked is refused

- **GIVEN** a PNG with more than 256 chunk headers before its first image-data chunk
- **WHEN** the header inspection runs
- **THEN** the file MUST be refused with "This image could not be checked."
- **AND** the dialog MUST NOT open

#### Scenario: A file replaced while the dialog is open is refused

- **GIVEN** the header inspection accepted a PNG and the dialog is open
- **WHEN** the file's contents are replaced with an HTML document and the user confirms
- **THEN** preparation MUST read the file once, check its signature again and refuse it
- **AND** nothing MUST be signed or sent

### Requirement: Still Images Are Re-Encoded Without Embedded Metadata

After the user confirms the dialog and before hashing, a JPEG, PNG or still WebP SHALL be read once into memory, have its signature checked again, and be decoded and re-encoded onto a canvas, with its longest side capped at 2048 pixels, in the same type. The output SHALL contain no EXIF, XMP or text-chunk metadata and SHALL keep the image's displayed orientation. A GIF, a WebP whose container flags animation, and a PNG that contains an `acTL` chunk SHALL be uploaded unchanged. A file that does not decode SHALL be refused. The prepared bytes SHALL also be at most 5 MiB.

#### Scenario: Location metadata does not leave the machine

- **GIVEN** a JPEG containing EXIF GPS coordinates
- **WHEN** the image is prepared
- **THEN** the prepared bytes MUST NOT contain the EXIF segment
- **AND** the bytes sent to the server MUST be the prepared bytes

#### Scenario: Orientation is preserved

- **GIVEN** a JPEG whose EXIF orientation requires a 90 degree rotation
- **WHEN** the image is prepared
- **THEN** the prepared image MUST display upright without relying on an orientation tag

#### Scenario: Large images are capped

- **GIVEN** a still image whose longest side is 4000 pixels
- **WHEN** the image is prepared
- **THEN** the longest side of the prepared image MUST be 2048 pixels and its aspect ratio MUST be unchanged

#### Scenario: Animated images are not flattened

- **GIVEN** an animated GIF, an animated WebP and an animated PNG
- **WHEN** each is prepared
- **THEN** each MUST be sent byte-for-byte unchanged
- **AND** the dialog MUST say that embedded details remain

#### Scenario: An undecodable file is refused

- **GIVEN** a file that begins with a JPEG signature and contains no decodable image
- **WHEN** the image is prepared
- **THEN** it MUST be refused and nothing MUST be sent

#### Scenario: Re-encoding that grows past the limit is refused

- **GIVEN** a still image whose re-encoded output exceeds 5 MiB
- **WHEN** the image is prepared
- **THEN** it MUST be refused with a message naming the limit

#### Scenario: Preparation makes no network request

- **WHEN** an image is decoded and re-encoded
- **THEN** no network request MUST be made

### Requirement: Upload Authorisation Is A Narrow, UI-Only, Lock-Gated RPC Method

The extension SHALL expose `blossom.authorizeUpload` in a UI-only `blossom` namespace. The method SHALL take exactly a public key, a lowercase hex SHA-256 and a server id, and SHALL return exactly an `authorization` header value. The background SHALL build the event itself as kind 24242 with content `Upload profile image` and the tags `t=upload`, `x=<hash>`, `server=<host of the listed server>` and `expiration=<now + 300>`, where `now` is a single reading of the clock taken by the background, and with `created_at` equal to `now - 10`. It SHALL sign the event with the named key and SHALL return `Nostr ` followed by the base64url encoding, without padding, of the signed event's JSON. The method SHALL NOT accept a kind, a tag list, content or an expiry from the caller.

#### Scenario: The event is built by the background

- **WHEN** `blossom.authorizeUpload` is called with a held public key, a valid hash and a listed server id
- **THEN** the decoded token MUST be a signed kind 24242 event whose tags are exactly `t=upload`, `x=<hash>`, `server=<host>` and `expiration` equal to `now` plus 300
- **AND** its `created_at` MUST equal `now` minus 10
- **AND** its `content` MUST be `Upload profile image`
- **AND** its `pubkey` MUST be the named key and its id and signature MUST verify

#### Scenario: The token satisfies the time rules for every server

- **GIVEN** a fixed clock reading `now`
- **WHEN** a token is built
- **THEN** `created_at` MUST be earlier than `now` and `expiration` MUST be later than `now`
- **AND** both MUST come from the same reading of the clock
- **AND** the policy MUST be identical for every server on the list, with no per-host exception

#### Scenario: The caller cannot choose what is signed

- **WHEN** the request carries any parameter other than `pubkey`, `sha256` and `serverId`
- **THEN** it MUST be rejected with the validation error code
- **AND** nothing MUST be signed

#### Scenario: An unlisted server is refused

- **WHEN** `serverId` is not the id of a listed server
- **THEN** the request MUST be rejected with the validation error code
- **AND** nothing MUST be signed

#### Scenario: A malformed hash is refused

- **WHEN** `sha256` is not 64 lowercase hexadecimal characters
- **THEN** the request MUST be rejected with the validation error code

#### Scenario: Only a held key can authorise

- **WHEN** `pubkey` is not a key the vault holds
- **THEN** the request MUST be rejected and nothing MUST be signed

#### Scenario: A locked vault refuses

- **GIVEN** the vault is locked
- **WHEN** `blossom.authorizeUpload` is requested
- **THEN** the router MUST refuse it with the existing locked-vault code
- **AND** nothing MUST be signed

#### Scenario: A web page cannot reach it

- **GIVEN** a message with `sender.tab` present
- **WHEN** it requests `blossom.authorizeUpload`
- **THEN** the router MUST respond with `unknown_namespace` and dispatch to no handler

#### Scenario: The token is not retained

- **WHEN** an authorisation has been returned
- **THEN** the token MUST NOT be written to storage, and MUST NOT appear in any log or console output

#### Scenario: Each authorisation is recorded in the activity log

- **WHEN** an authorisation is returned
- **THEN** the activity log MUST contain an entry with origin `extension://profile`, kind 24242 and a signed result
- **AND** the entry MUST NOT appear in the origin filter's list of origins

### Requirement: The Upload Request Is Made By The Page, With Fixed Hygiene

The page SHALL send `PUT <server origin>/upload` with the headers `Authorization`, `Content-Type` (the prepared type) and `X-SHA-256` (the lowercase hex hash), and the prepared bytes as the body. The request SHALL omit credentials and the referrer, SHALL NOT use the cache, and SHALL refuse redirects. It SHALL be cancellable by the user and SHALL abort after 60 seconds. At most 16 KiB of the reply body SHALL be read. The background SHALL make no network request for an upload.

#### Scenario: Request shape

- **WHEN** the user confirms an upload to a listed server
- **THEN** exactly one `PUT` MUST be sent, to that server's origin at `/upload`
- **AND** its `Authorization` MUST be the value returned by `blossom.authorizeUpload` for the same hash and server
- **AND** its `X-SHA-256` MUST equal the hash of the body

#### Scenario: No cookies, no referrer, no redirects

- **WHEN** the request is sent
- **THEN** it MUST carry no cookies and no referrer
- **WHEN** the server answers with a redirect
- **THEN** the request MUST fail and the token MUST NOT be sent to the redirect target

#### Scenario: Cancelling aborts the request

- **GIVEN** an upload is in progress
- **WHEN** the user presses Cancel
- **THEN** the request MUST be aborted
- **AND** the form field MUST keep its previous value
- **AND** the outcome MUST NOT be reported as a failure

#### Scenario: A slow server times out

- **WHEN** no reply arrives within 60 seconds
- **THEN** the request MUST be aborted and reported as "Could not reach `<host>`."

#### Scenario: The reply is bounded

- **WHEN** a server streams a reply longer than 16 KiB
- **THEN** reading MUST stop at 16 KiB
- **AND** the upload MUST be reported as an unexpected reply

#### Scenario: The background stays off the network

- **WHEN** an upload runs from start to finish
- **THEN** the background context MUST make no network request

### Requirement: An Upload Is One Cancellable Operation Bound To Its Key And Field

Confirming the dialog SHALL start one upload operation, bound to the public key the editor is editing and the image field the upload belongs to at that moment. At most one operation SHALL run at a time. Cancel, unmounting the field, a change of the selected key, and the start of another upload SHALL each cancel the operation as a whole. Cancellation SHALL take effect at the next stage boundary (hashing, authorisation, request, field write), and no later stage SHALL run. A result that arrives after cancellation SHALL be discarded. A field write SHALL be applied only if the operation is still the current one, the editor is still editing the bound key, and the target is the bound field.

#### Scenario: Cancelling during preparation or hashing

- **GIVEN** the user has confirmed and the image is being prepared or hashed
- **WHEN** the user presses Cancel
- **THEN** no `blossom.authorizeUpload` call MUST be made
- **AND** no request MUST be sent
- **AND** the form field MUST keep its previous value
- **AND** no failure MUST be reported

#### Scenario: Cancelling while the authorisation is pending

- **GIVEN** `blossom.authorizeUpload` has been called and has not returned
- **WHEN** the user presses Cancel and the call then returns a token
- **THEN** no request MUST be sent
- **AND** the token MUST be discarded, and MUST NOT be stored or logged
- **AND** the form field MUST keep its previous value

#### Scenario: A reply that arrives after cancellation is discarded

- **GIVEN** the user cancelled while the request was in flight
- **WHEN** a reply nevertheless arrives
- **THEN** it MUST NOT be checked, written to the field or shown

#### Scenario: Unmounting at any stage

- **WHEN** the field unmounts while the operation is in any stage
- **THEN** no later stage MUST run
- **AND** no request MUST be sent after the unmount
- **AND** no field write or state update MUST follow it

#### Scenario: Changing the selected key

- **GIVEN** an operation bound to key A is in preparation, authorisation or upload
- **WHEN** the selected key changes to key B
- **THEN** the operation MUST be cancelled
- **AND** nothing MUST be written to key B's form
- **AND** if the request had not yet been sent, it MUST NOT be sent

#### Scenario: The authorisation uses the key bound at confirmation

- **GIVEN** the user confirmed an upload while editing key A
- **WHEN** the authorisation call is made
- **THEN** its `pubkey` MUST be key A, taken from the operation and not re-read from the current selection

#### Scenario: Replacing an in-flight upload

- **GIVEN** an upload is in flight
- **WHEN** another upload begins
- **THEN** the first MUST be cancelled before the second starts
- **AND** the first operation's late reply MUST write nothing
- **AND** only the second operation MAY write to a field

#### Scenario: The interface does not offer overlap

- **WHEN** an operation is running
- **THEN** Upload MUST be disabled on both the picture field and the banner field
- **AND** Cancel MUST appear on the field that owns the operation only

#### Scenario: An upload writes only to its own field

- **GIVEN** an operation started on the banner field
- **WHEN** it completes successfully
- **THEN** only the banner field MUST change
- **AND** the picture field MUST keep its value

### Requirement: The Server's Reply Is Verified Before It Is Used

A reply with status 200 or 201 SHALL be parsed as a blob descriptor. The extension SHALL accept it only if `sha256` equals the hash computed locally, `size` equals the prepared byte length, and `url` passes the `https:`-only allowlist (at most 512 characters) and contains the hash in its path. Additional fields SHALL be ignored. On any failure nothing SHALL be written to the form field. The returned URL SHALL NOT be requested or rendered by the page, and the upload SHALL NOT publish anything: the user saves the profile separately. These checks establish that the reply is consistent with the bytes that were sent. They do not establish that the server stored the blob or will keep serving it, and the interface SHALL NOT claim that they do.

#### Scenario: A valid descriptor fills the field

- **GIVEN** a 201 reply whose `sha256` and `size` match and whose `url` is `https://<host>/<hash>.png`
- **WHEN** the reply is handled
- **THEN** the form field MUST hold that URL
- **AND** no event MUST have been published

#### Scenario: A 200 for an existing blob is also success

- **GIVEN** the server answers 200 with a matching descriptor
- **WHEN** the reply is handled
- **THEN** it MUST be treated as success

#### Scenario: A hash mismatch is rejected

- **GIVEN** a descriptor whose `sha256` differs from the local hash
- **WHEN** the reply is handled
- **THEN** the upload MUST be reported as an unexpected reply
- **AND** the form field MUST keep its previous value

#### Scenario: A size mismatch is rejected

- **GIVEN** a descriptor whose `size` differs from the prepared byte length
- **WHEN** the reply is handled
- **THEN** the upload MUST be reported as an unexpected reply

#### Scenario: A URL without the hash is rejected

- **GIVEN** a descriptor whose `url` does not contain the hash
- **WHEN** the reply is handled
- **THEN** the upload MUST be reported as an unexpected reply

#### Scenario: A non-https or over-long URL is rejected

- **GIVEN** a descriptor whose `url` uses `http:`, `data:` or `javascript:`, or is longer than 512 characters
- **WHEN** the reply is handled
- **THEN** the upload MUST be reported as an unexpected reply

#### Scenario: Extra fields are ignored

- **GIVEN** a descriptor that also carries `magnet` and `ipfs` fields
- **WHEN** the reply is handled
- **THEN** it MUST be accepted if the checks above pass

#### Scenario: The URL is not requested

- **WHEN** a descriptor is accepted
- **THEN** the page MUST NOT make a request to the returned URL and MUST NOT render it as an image source

### Requirement: Failures Are Reported In Fixed Words

The extension SHALL map an upload failure to fixed text chosen by status, and SHALL NOT display text written by the server, including the `X-Reason` header.

#### Scenario: Status maps to fixed copy

- **WHEN** the server answers 400, 401, 402, 403, 409, 413, 415 or 429
- **THEN** the message MUST be, respectively: "The host did not accept this image.", "The host did not accept the upload authorisation.", "The host charges for uploads.", "The host's rules do not allow this upload.", "The host reports the bytes did not match. Try again.", "The image is larger than the host allows.", "The host does not accept this type of image.", "The host is limiting uploads. Try again later."

#### Scenario: Other failures read as unreachable

- **WHEN** the request fails with another status, a network error, a blocked cross-origin response or a refused redirect
- **THEN** the message MUST be "Could not reach `<host>`."

#### Scenario: Server text is never displayed

- **GIVEN** a failing reply carrying an `X-Reason` header and a body containing text
- **WHEN** the failure is shown
- **THEN** neither the header nor the body text MUST appear in the interface

### Requirement: One Image Field Serves The Picture And The Banner

The profile editor SHALL use one image field component for both the picture and the banner. The field SHALL keep a URL input that accepts a pasted `https:` address, and SHALL offer an Upload action beside it. A failed or cancelled upload SHALL leave the field's value as it was. The field SHALL NOT preview the image.

#### Scenario: Both fields can upload

- **WHEN** the profile editor is open
- **THEN** the picture field and the banner field MUST each offer Upload

#### Scenario: Pasting a URL still works

- **WHEN** the user pastes an `https:` address into either field and saves
- **THEN** it MUST be accepted without any upload

#### Scenario: A failed upload does not clear the field

- **GIVEN** the field holds a URL
- **WHEN** an upload to a host fails
- **THEN** the field MUST still hold the same URL
- **AND** the failure message MUST be shown beside the field

#### Scenario: Uploading state is honest

- **WHEN** an upload is in progress
- **THEN** the field MUST show an indeterminate "Uploading" state and a Cancel action
- **AND** it MUST NOT show a percentage or progress bar that does not reflect transferred bytes

#### Scenario: Success does not overclaim

- **WHEN** a reply passes the checks and the field is filled
- **THEN** the message MUST read "Uploaded to `<host>`. Save your profile to use it."
- **AND** it MUST NOT say that the image was verified, or that it is guaranteed to stay available

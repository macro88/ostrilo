## Context

The profile editor takes a pasted URL for the picture and a pasted URL for the banner. A dead upload path sits beside the picture field: `ImageUploadField` posts multipart to a `uploadEndpoint` that nothing can set (`proposal.md` lists the defects). Meanwhile three rules already govern this ground and this design has to live inside them:

- **`remote-media-policy`** says the extension has no hardcoded third-party upload destination, discloses the host before any upload, accepts only `https:`, and never fetches or renders the URL an upload service returns. The one remote image an extension page loads is the user's own picture, once, on Save or Refresh picture (`src/ui/lib/avatar-capture.ts`).
- **The manifest CSP** is `connect-src wss: https://nostr.build`, asserted exactly by `tests/security/manifest-assertions.test.ts`. An extension page can reach relays and one declared upload host, and nothing else on `https:`.
- **`docs/development-standards.md`** forbids new background network behaviour without product approval, keeps primitives behind ports (`tests/security/crypto-single-implementation.test.ts` fails on a second SHA-256), and requires typed RPC with the canonical error codes.

Blossom, as far as this change uses it (BUD-02 and BUD-11, read for this design):

- `PUT /upload` with the raw bytes as the body. `Content-Type` and `X-SHA-256` (lowercase hex) are sent by the client. The server answers `201` for a new blob or `200` for one it already has, with a descriptor `{url, sha256, size, type, uploaded}`.
- Authorisation is an `Authorization: Nostr <token>` header. The token is a signed kind 24242 event, encoded as base64url without padding. It carries `t=upload`, an `expiration` in the future, an optional `x` per blob hash and an optional `server` per domain. `created_at` must be in the past. The `content` is a readable sentence.
- Servers are expected to send CORS headers, which is what lets an extension page call one without a host permission.

## Goals / Non-Goals

**Goals:**

- Upload a profile picture or banner to a Blossom server the user chose, from the profile editor, in one dialog.
- Keep every existing egress rule intact: no default server, host named before each upload, `https:` only, nothing fetched or rendered from the result, no background network request.
- Keep the new signing authority as small as possible: one method that can produce one kind of event, for one purpose.
- Let the extension check that the server's reply is consistent with the bytes it was sent. That is not proof that the server stored them (decision 8).
- Leave no EXIF location data in a photo the user uploads.

**Non-Goals:**

- Everything under "Not in this change" in the proposal. In particular, a user-typed server, and any upload from outside the profile editor.
- A remote or auto-updating server list. A list fetched at runtime is configuration the extension did not ship, and a network contact `PRIVACY.md` would have to describe.
- Image editing: no crop, no rotate, no filters.

## Decisions

### 1. The page makes the request; the background only signs

The profile editor is an extension page, and the CSP that matters is the one for extension pages. The flow is: the page prepares the image and hashes it, asks the background for an `Authorization` value, sends the `PUT`, and validates the answer. The background holds the key and never touches the network for this feature.

*Alternative: the background uploads.* It would need the bytes over RPC, up to 5 MB through structured clone, and it would be a background network behaviour the standards forbid without approval. It would also put the response parsing, the cancellation and the progress in the privileged context, for no gain.

*Alternative: the page signs.* It would need the private key. Not available to any UI surface, by design.

### 2. One RPC method that can build one event

`blossom.authorizeUpload` is UI-only (`blossom` joins the UI-only namespaces) and lock-gated.

```
params   { pubkey: hex64, sha256: hex64 (lowercase), serverId: <id from the curated list> }
result   { authorization: "Nostr <base64url>" }
```

The background builds the event. The page supplies no tag, no kind and no content, so the method cannot be used to get any other event signed:

| Field | Value |
|---|---|
| `kind` | `24242` |
| `content` | `Upload profile image` |
| `tags` | `["t","upload"]`, `["x",<sha256>]`, `["server",<host>]`, `["expiration",<now + 300>]` |
| `created_at` | `now − 10` seconds |

- `serverId` is resolved against the curated list in the domain layer. An id not in the list is refused as invalid params, so the `server` tag, and with it the token's scope, can only ever name a vetted host.
- `pubkey` must be a key the vault holds, as `avatar.*` already requires. It signs through `KeyVaultService.signEvent(event, keyId)`, which recomputes the event id, so the handler never computes one itself.
- The signed event is encoded and returned as a header value. The page never receives the event as an object to alter.
- A token leaks one capability: uploading that one blob to that one host for five minutes. That is why it is short-lived, scoped by `x` and `server`, and not stored.
- No approval prompt. The user started this in the extension's own UI and has just confirmed the host. It is not a site request, so site policy does not apply. The activity log records it anyway (decision 10).
- No new error code. A malformed request uses the existing validation code, and a locked vault is refused by the router's existing gate.

*Alternative: a general `vault.signEvent` for UI callers.* It would turn a compromised extension page into a signing oracle. The narrow method costs about 60 lines and keeps the privileged surface enumerable, which `tests/security/lock-gate.test.ts` and `rpc-privilege-boundary.test.ts` already assume.

*Alternative: an ephemeral key for the upload.* It would stop the host learning which npub uploaded. But the picture's URL goes into that npub's public kind 0, so the association is published anyway, and the host sees the IP address either way. An ephemeral key would also lose per-key quotas and later deletion. Rejected. The dialog tells the user the host will see their public key.

**The token's clock policy is one rule for every server.** The background reads the clock once, as `now`, and sets `created_at = now − 10` and `expiration = now + 300`, from the named constants `AUTH_BACKDATE_SECONDS` and `AUTH_TTL_SECONDS`. BUD-11 requires `created_at` in the past and `expiration` in the future. Stamping `created_at` at `now` would fail on any server whose clock is slightly behind the user's. With the backdate, a user clock up to 9 seconds fast still passes. The token is usable for the 300 seconds after `now`, not 310.

The vetting gate (task 1) runs every candidate against exactly this policy. A server that refuses it does not qualify. There is no per-host exception, and the constants are not adjusted during the gate: changing either one is a change to the spec and to its tests. Tests inject a fixed clock.

**Why 10 and not 60 (measured on 2026-11-13).** The first draft of this policy used 60. The gate showed that nostrcheck.me refuses a token whose `created_at` is about a minute old. It accepted backdates of 0 to 45 seconds and refused 55 and 60. The one 58-second pass was a fast round trip, which fits a 60-second freshness window measured at the server. A backdate of 60 sits on that boundary, and a slow upload would cross it. Ten seconds keeps `created_at` in the past, as BUD-11 requires, and leaves a wide margin under a 60-second window. All three listed servers accept it (`blossom-server-vetting.md`). This is a revision of the spec made because of the measurement, and it applies to every server alike.

### 3. A curated list in the domain layer, and the CSP generated from it

`src/domain/blossom/servers.ts` exports an ordered list of `{ id, name, origin }`, with `origin` a bare `https://host`. Every consumer reads that one constant:

- the consent dialog, which lists them;
- the settings schema, which accepts `blossomServer` only as one of the ids;
- the RPC schema for `serverId`;
- `wxt.config.ts`, which builds `connect-src` as `wss:` plus these origins;
- `manifest-assertions.test.ts`, which asserts the built manifest's `connect-src` equals `wss:` plus exactly the list, so the policy and the list cannot drift.

The path is always `/upload` (BUD-02), so the list stores no path.

`wxt.config.ts` runs in Node and the list is plain data in a TypeScript module. If importing from `src/domain` into the config proves awkward, the builder generates the origin list from a small JSON file both read. The test above holds either way.

The settings field stores an id, never a URL. A stored id that a later release removed from the list reads as unset: the user is asked again, and nothing is sent to a host that is no longer vetted.

*Alternative: `connect-src https:` and a user-typed server.* One CSP line and no list to maintain. It also ends the guarantee that an extension page can reach only relays and declared upload hosts, which is what stops a compromised dependency opening an arbitrary HTTPS channel (`docs/extension-manifest.md`). Rejected for this change, as a separate decision.

*Alternative: `optional_host_permissions`, requested per server at runtime.* It does not help: the CSP `connect-src` applies to extension pages regardless of host permissions, and a runtime permission prompt is a heavier flow for a "pick a host" step.

### 4. A consent dialog on every upload, with the host chosen inside it

Choosing a file starts a header inspection (decision 5). A file that passes opens a dialog. Nothing is decoded, hashed, signed or sent until the user confirms:

- A radio group of the curated servers (name and host). With none remembered, none is preselected and Upload is disabled. With a remembered one, it is preselected.
- What the host will see: the image, the user's IP address and the user's public key. The image will be public at an address anyone can open, and a host may remove files or refuse to delete them, so the user should keep the original.
- Whether this file will be re-encoded (decision 5) or sent as it is.
- Cancel and Upload. Escape and clicking outside cancel.

Choosing and confirming writes `blossomServer`, which is only a preselection for next time. The dialog always appears. No separate settings screen is added: the only place the choice is made is the place it matters.

Built on the existing Radix dialog primitive and `docs/design/DESIGN_RULES.md`. It replaces `window.confirm`, which cannot list options and renders unstyled in a side panel.

*Alternative: a settings row to pick a server.* It hides the consent moment inside a setting, and the user would still need a confirmation at upload time. One surface is simpler.

### 5. Inspect the header before the dialog, prepare the image after it, and judge it by its bytes

The dialog has to refuse a non-image before it opens and say whether the file will be re-encoded, so something must look at the file first. The split is explicit:

- **Stage one, before the dialog: header inspection.** `inspectImage(file)` reads at most 4 KiB of the file, in slices, and nothing more. It decodes no pixels, computes no hash, signs nothing and sends nothing. It answers three questions: is this one of the four types, is it within the size limit, and will it be re-encoded or sent as it is.
- **Stage two, after the user confirms: preparation.** Reading the whole file, decoding, re-encoding, hashing, signing and sending all happen here.

Stage one:

1. **Sniff the type from the first bytes**: JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), GIF (`GIF87a` or `GIF89a`), WebP (`RIFF`, four size bytes, `WEBP`). `file.type` is a label the operating system or the user's extension chose and is not trusted. Anything else, SVG included, is refused with "Choose a JPEG, PNG, GIF or WebP image."
2. **Size**: the 5 MB cap applies to the chosen file, read from `file.size` with no read of the content, and again to the prepared output.
3. **Animation**: a GIF is treated as possibly animated and is uploaded unchanged. A WebP whose `VP8X` flags set the animation bit, and a PNG with an `acTL` chunk, are uploaded unchanged too. Re-encoding them through a canvas would silently flatten them to one frame. The WebP flag sits in the first 30 bytes. The PNG check walks chunk headers (8 bytes each, at most 256) up to the first image-data chunk. A PNG that does not reach one within that bound is refused rather than guessed at, because "unchanged" would keep its metadata and "re-encoded" might flatten an animation.

Stage two:

4. **Stills are re-encoded**: the file is read once into memory and its signature is checked again, so a file replaced while the dialog was open is refused. `createImageBitmap` then decodes those bytes (no network request), drawn onto a canvas with the longest side capped at 2048 px, then encoded as the same type (JPEG and WebP at quality 0.9, PNG lossless). Orientation is applied by the decoder, so removing the EXIF orientation tag leaves the picture upright. A file that does not decode is refused, which also catches a file that has a valid-looking header and nothing behind it.
5. The prepared bytes and their MIME type are what get hashed and sent.

Re-encoding drops EXIF (GPS, device, time), XMP and text chunks. That is the reason to do it: the extension's whole premise is that it does not leak, and a phone photo carries the place it was taken. The 2048 px cap keeps a banner sharp and a 4000 px camera image well inside a free host's size limit.

The dialog says plainly when a file will go as it is: "This image is animated, so it will be uploaded unchanged. Any details embedded in the file stay in it."

*Alternative: strip EXIF by parsing the container.* No quality loss, but it means writing and testing parsers for four formats' metadata structures, in a security-sensitive context, to avoid a re-encode. A canvas re-encode also proves the bytes decode as an image.

*Alternative: refuse animated images.* Simpler. But the existing field accepts GIFs, and refusing them would be a regression for the people who use one.

*Alternative: no metadata handling.* Quickest to build, and it would publish location data from a camera roll on a public host. Rejected.

### 6. Hashing goes through the existing port

The page hashes the prepared bytes with `NobleSha256`, imported the way `src/ui/features/backup/key-backup-envelope.ts` imports `VaultKdf` and `WebCryptoAesGcm`. `crypto.subtle.digest` would be a second SHA-256 implementation, which `tests/security/crypto-single-implementation.test.ts` exists to forbid. A synchronous hash of at most 5 MB is short enough not to need a worker. The task list asks for a measurement to confirm it.

### 7. The request

```
PUT <origin>/upload
Authorization: Nostr <base64url token>
Content-Type:  <prepared MIME type>
X-SHA-256:     <hex>
body:          the prepared Blob
```

- `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `cache: "no-store"`, `redirect: "error"`. The token must never follow a redirect to another host, and no cookie belongs on it.
- `AbortController`: the user's Cancel aborts it, and a 60-second timeout aborts it too. Cancel and timeout are reported differently. Cancelling the whole operation, not only this request, is decision 13.
- The reply body is read up to 16 KiB and no further, so a hostile server cannot stream an unbounded body into the page.
- `200` and `201` are both success.
- Failures map to fixed copy and never echo the server's text. `X-Reason` is free text written by the remote party, and BUD-02 says clients must not act on it, so it is not shown at all:

  | Status | Copy |
  |---|---|
  | 400 | The host did not accept this image. |
  | 401 | The host did not accept the upload authorisation. |
  | 402 | The host charges for uploads. |
  | 403 | The host's rules do not allow this upload. |
  | 409 | The host reports the bytes did not match. Try again. |
  | 413 | The image is larger than the host allows. |
  | 415 | The host does not accept this type of image. |
  | 429 | The host is limiting uploads. Try again later. |
  | other, or no response | Could not reach `<host>`. |

### 8. The descriptor is untrusted until checked

The reply is parsed with a loose schema (extra fields ignored, since servers may add `magnet`, `ipfs` and others) and then checked against what the page already knows:

- `sha256` equals the hash the page computed.
- `size` equals the prepared byte length.
- `url` passes `isAllowedRemoteUrl` (`https:` only, at most 512 characters), and its path contains the hash. BUD-02 says the URL is the BUD-01 `GET /<sha256>` address including an extension, so a conforming server passes.
- `type` is read but not relied on.

Any failure is "The host returned an unexpected reply." and nothing is written into the field. On success the URL goes into the form field through the same `onChange` a typed URL uses, so it passes `profile.update`'s validation again at Save. The upload publishes nothing, and the page does not request the URL. The existing Save and Refresh picture flow is the only thing that loads it, as it is for a pasted URL.

These checks show that the descriptor is consistent with what the page sent: the server names the same hash and size, and hands back an address built on that hash. They do not show that the server stored the blob or will keep serving it. A server could return a correct descriptor and discard the bytes. The interface says "Uploaded to `<host>`", never "verified". The first time anything requests the address is the existing Save flow's picture load, which already reports a picture that cannot be loaded.

What the hash does buy over nostr.build's reply is that a wrong or substituted answer is detectable: a server cannot hand back someone else's blob or a URL for a different file without failing the check.

### 9. Settings: `blossomServer` replaces `uploadEndpoint`

`blossomServer?: <list id>` in `AppSettings`, in the same device-local `appSettings` item, never synced. `uploadEndpoint` leaves the type and the patch schema. A stored `uploadEndpoint` is dropped when settings are read, through the same legacy-value handling `SettingsService` uses for the old default relay. No screen ever set it, so no real data is lost.

### 10. An activity entry for each authorisation

Each successful `blossom.authorizeUpload` writes an entry with origin `extension://profile` (the origin `profile.update` already uses, `profile-rpc.ts:115`), kind 24242 and result "signed". The log shows every time the extension signed something the user did not see as a signing prompt. `ActivityOriginsResponseSchema` already keeps `extension://` origins out of the origin filter (`schemas.ts:380-389`). The entry means "a token was issued", not "the upload succeeded": the page makes the request and the background cannot know the outcome, and the entry's wording stays within that.

### 11. Component shape

```
src/domain/blossom/
  servers.ts          curated list, ids, bounds
  auth-event.ts       builds the unsigned kind 24242 event, encodes the header
  descriptor.ts       zod schema + the checks against the local hash and size
  image-sniff.ts      type, animation and size judgement from bytes
src/application/services/blossom-auth.service.ts   signs for a held key, writes the activity entry
src/infrastructure/messaging/handlers/blossom-rpc.ts
src/ui/lib/prepare-image.ts                          decode, cap, re-encode (beside avatar-capture.ts)
src/ui/features/profile/
  hooks/useBlossomUpload.ts                          the state machine, one operation at a time (decision 13): idle, inspecting, choosing, preparing, authorising, uploading, done, failed, cancelled
  components/ProfileImageField.tsx                   URL input + Upload button; used for picture and banner
  components/UploadConsentDialog.tsx
```

`ProfileImageField` renders the same markup for both fields and takes the form field name. `useBlossomUpload` owns the sequence and the cancellation, so the component stays presentational and the sequence can be tested without a DOM. The pure parts (event builder, descriptor checks, sniffing) live in the domain layer and are tested with fixed vectors.

### 12. Testing without a real server

The CSP only allows the curated origins, so a local fixture server on another host would be blocked by the same policy the test is protecting. Playwright intercepts the request to a curated origin at the browser-context level and answers it as a BUD-02 server would, including a preflight. That exercises the real CSP, the real RPC and the real dialog, with no test-only CSP entry (`tests/security/test-seam-safety.test.ts` would object to one). The vetting gate in task 1 is the only step that talks to real servers, and it is a manual measurement recorded in a file, not a CI check.

### 13. One upload is one operation, with one owner

The hook holds a single operation slot. Confirming the dialog creates an operation that records `{ id, pubkey, field, controller }`: the key the editor is editing, the image field the upload belongs to, and an `AbortController`. Every stage after the dialog belongs to that operation: preparing, hashing, authorising, uploading and verifying.

- **Cancellation reaches every stage.** The user's Cancel, unmounting the field, switching the selected key, and starting another upload each cancel the operation. The operation is checked at every stage boundary: before hashing, before the RPC call, before `fetch`, and before the field write. After a cancel, no later stage runs.
- **What cannot be recalled is discarded.** A canvas decode and an RPC call take no abort signal. If one is running when the cancel arrives, it finishes and its result is dropped: the prepared bytes are released, and the token is neither stored, logged nor sent. A token already signed for a cancelled upload cannot be unsigned. It names one blob and one host and expires within five minutes, and the activity entry says only that a token was issued (decision 10).
- **The operation is bound to its key and its field.** The `pubkey` passed to `blossom.authorizeUpload` is the one captured at confirmation, never re-read from the current selection. The result is written only if the operation is still the current one, the editor is still editing that key, and the target is that field. Anything else is dropped without a message, so a late reply cannot put a URL into another key's profile form, or into the other image field.
- **Latest wins, and the interface prevents the race.** While an operation runs, Upload is disabled on both fields and Cancel appears on the field that owns it. If a second operation begins anyway, it cancels the first, and the first can no longer write.
- **Cancelling is not failing.** A cancelled operation shows no error and leaves the field as it was. A timeout is a failure, reported as "Could not reach `<host>`."

*Alternative: let the picture and the banner upload at the same time.* It needs two cancellation contexts and two sets of bound state for a case nobody asked for. One network operation at a time is easier to reason about.

*Alternative: rely on the request's `AbortController` alone.* It covers only the last stage. Preparation and the authorisation call come before it, so a cancel during either would still go on to send a request.

## Risks / Trade-offs

- **A host on the list disappears, starts charging, or breaks CORS** → The list is a shipped constant, so a dead host surfaces as "Could not reach `<host>`" and the user picks another. Removal and replacement ship in a release. A remote list is rejected (Non-Goals). Requiring two independent operators at the vetting gate means one failure never removes the feature.
- **A blob can vanish, so the profile picture 404s** → Disclosed in the dialog. The Refresh picture flow already reports a picture that cannot be loaded and keeps the local copy. Not solvable here, because Ostrilo does not host.
- **The hash-in-path check refuses a conforming server with an unusual URL** → BUD-02 defines the URL as the hash address plus extension. The vetting gate refuses a server whose descriptor does not satisfy the check, so a non-conforming server never reaches the list.
- **The file picker may dismiss a toolbar popup.** Some browser and platform combinations close an extension popup when the native file dialog takes focus, which would lose an unsaved profile draft. → Task 1 checks it on macOS Chrome and on Firefox, from every surface that hosts the profile editor. If it fails on one, that surface offers "Open in a tab to upload" instead of the Upload button, and the field still accepts a pasted URL. The design does not assume the answer.
- **Re-encoding loses quality or changes a file** → Quality 0.9 and a 2048 px cap keep a profile picture visually unchanged. The dialog states what happens. Animated files are never re-encoded.
- **Another in-flight change edits the same specs** → `add-nip65-relay-lists` and `add-biometric-unlock` also modify `rpc-privilege-boundary`'s namespace sentence, and `add-biometric-unlock` modifies `extension-manifest-policy`. The change that archives later rebases its delta onto the earlier one. This change touches only the `connect-src` scenario of the manifest requirement and adds one name to the namespace list.
- **A site can still ask Ostrilo to sign a kind 24242** → Unchanged, and out of scope. That path goes through the site approval flow and its trust policy. This change adds no way for a site to reach `blossom.authorizeUpload`, which is UI-only.
- **A token can be signed for an upload that is then cancelled** → It cannot be recalled. It is scoped to one blob and one host, lives at most five minutes, is never stored or logged, and no request follows a cancel (decision 13).
- **The file changes between the header inspection and the upload** → Preparation reads the file once and checks the signature again. A file whose bytes no longer match is refused (decision 5).
- **A 5 MB canvas decode is slow on a weak machine** → It runs after the consent click, behind a "Preparing" state, and can be cancelled. The 2048 px cap bounds the canvas.

## Migration Plan

1. Land the vetting gate's result first (`blossom-server-vetting.md`). The list in `servers.ts` is whatever that file records.
2. Ship the settings change: `blossomServer` added, `uploadEndpoint` removed and dropped on read. No user-visible effect until the field ships.
3. Ship the CSP change with the list. A fresh install's only new reachable hosts are the curated ones, and nothing contacts them until the user starts an upload.
4. Rollback is reverting the change. The only stored value it adds is a list id that an older build ignores.

No stored format changes, no envelope or vault involvement.

## Open Questions

- **Which servers qualify.** Resolved by task 1: three independent operators pass (`blossom-server-vetting.md`).
- **Whether any candidate refuses the token's clock policy.** Resolved by task 1: one did at a 60-second backdate, so the constant became 10 (decision 2). All listed servers accept it.
- **Whether the file picker survives in the toolbar popup.** Still open. Task 1.4 needs a person at a real browser, because Playwright intercepts the file chooser and never shows the native dialog.

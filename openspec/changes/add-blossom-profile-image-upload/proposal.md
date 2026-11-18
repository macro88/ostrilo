## Why

The profile editor can only take a pasted image URL. Anyone who wants a picture or banner has to host it somewhere first, and then paste the address. For a signer whose users are often new to Nostr, that is the step most likely to stop them.

An upload path exists in the code, and it cannot be used:

- **Nothing can turn it on.** `uploadEndpoint` is undefined by default (`src/domain/types.ts:204`) and no screen sets it, so `ImageUploadField` never shows its button (`src/ui/features/profile/components/ImageUploadField.tsx:63-64`).
- **It speaks the wrong protocol.** It sends a multipart POST and expects a nostr.build reply shaped `{status, data: [{url}]}` (`ImageUploadField.tsx:123`, `:142`). Nostr's own media-server protocol is Blossom: a `PUT` of the raw bytes, authorised by a signed kind 24242 event, answered with a descriptor that names the blob by its SHA-256.
- **It leaves a stale hole in the policy.** `connect-src` still names `https://nostr.build` (`wxt.config.ts:31`), from when that host was hardcoded. `docs/extension-manifest.md` and `tests/security/manifest-assertions.test.ts` defend it as "the upload host".
- **Its progress bar is invented.** It ticks to 90% on a timer (`ImageUploadField.tsx:71-73`), whatever the network is doing.

Blossom is the right fit for the same reason Nostr is: a blob's address is its hash, so the extension can check that the server's reply agrees with what it sent. That is a consistency check, not proof that the server stored the blob.

## What Changes

- **A curated list of Blossom servers, none selected.** A short, fixed list of public servers lives in the domain layer. A fresh install has none chosen and makes no upload request. The user picks one in the upload dialog, at the moment they first upload. The list's contents come from the vetting gate below, not from this document.
- **One image field for picture and banner.** `ImageUploadField` becomes `ProfileImageField`: the URL input stays, with an Upload button beside it. The banner, today a bare URL box (`ProfileEditForm.tsx:173-178`), gets the same field.
- **A consent dialog on every upload.** It replaces `window.confirm`. It names the host, offers the curated list, and says what that host will see: the image, the user's IP address and the user's public key. Upload stays disabled until a host is chosen. The last choice is remembered and preselected, but the dialog still appears every time. It opens after a header-only look at the file (at most 4 KiB, no decoding) that refuses non-images and tells the user whether the file will be re-encoded. Decoding, hashing, signing and sending all wait for the confirmation.
- **Image preparation in the page, before anything leaves the machine.** The file's type is checked from its bytes, not the browser's label. JPEG, PNG and WebP are re-encoded through a canvas, which drops EXIF location data and other embedded metadata and caps the longest side. GIF is uploaded as it is, because re-encoding would flatten an animation. SVG is refused. The 5 MB input cap stays.
- **A narrow signing method.** New UI-only, lock-gated RPC `blossom.authorizeUpload`. The page sends the SHA-256 of the prepared bytes, the chosen server and the key. The background builds a kind 24242 event itself (`t=upload`, `x=<hash>`, `server=<host>`, `created_at` 10 seconds in the past, an `expiration` five minutes ahead, readable content), signs it and returns only the `Authorization` header value. The page cannot use this method to get any other event signed.
- **The page makes the `PUT`.** The background still never makes a request for this feature. The request carries no cookies and no referrer, refuses redirects, and can be cancelled.
- **The server's answer is checked, not trusted.** The returned `sha256` must equal the hash the page computed, `size` must equal the byte length, and the URL must contain the hash and pass the existing `https:` allowlist. That shows the reply agrees with what was sent. It does not prove the server stored the blob, and the interface says "Uploaded", not "verified". The result fills the field. It is never fetched or rendered at that point, and it publishes nothing: the user still presses Save.
- **A real upload state, and one cancellable operation.** An indeterminate "Uploading" state with a Cancel button. The fake progress bar goes. Cancel, unmounting the editor, switching the selected key, or starting another upload ends the whole operation, not just the request: no later stage runs, nothing is sent, and a late result is discarded. Each operation is bound to the key and field it started on, and only one runs at a time.
- **Policy follows the code.** `connect-src` drops `https://nostr.build` and lists exactly the origins of the curated servers, generated from the same constant so the two cannot drift. No new permission is declared: Blossom servers send CORS headers by specification, so a page `fetch` needs no host permission.
- **The dead path is removed.** `uploadEndpoint` leaves the settings type and schema, and a stored value is dropped on read. It is replaced by `blossomServer`, which holds a list id and is never a URL.
- **An activity entry per authorisation.** Origin `extension://profile`, kind 24242, following `profile.update`'s precedent, so the log shows every time the extension signed something on the user's behalf.
- **Docs.** `PRIVACY.md` gains the new network use. Also updated: `docs/extension-manifest.md`, `docs/relay-trust-boundary.md`, `docs/developers_readme.md`, `docs/rpc-architecture.md`, `docs/design-review/README.md`, and the UX-002 row in `docs/roadmap.md`.

**Product approval.** This adds a network destination the user's keys have never talked to. `docs/development-standards.md` requires explicit product approval for new network behaviour. Accepting this proposal approves exactly one thing: a user-started upload to a server the user chose from the curated list. It does not approve any request the user did not start, and it does not approve a default server.

### Vetting gate

The list is chosen by measurement, in the way `add-biometric-unlock` measures before committing. Task group 1 probes real servers from a built extension page. A server enters the list only if it:

- answers over `https:` with the CORS headers a page `fetch` needs, including the preflight for `PUT` with `Authorization`;
- accepts an anonymous-looking upload of a small image with a kind 24242 token and returns a valid descriptor, with no account or payment;
- states a size limit of at least 5 MB, or accepts a 5 MB blob in the probe;
- returns a URL a browser can load as an image.

At least two independent operators must qualify, so that no single host is a dependency of the feature. If fewer than two do, the change stops and the decision comes back to the owner. It is not quietly narrowed to one host.

### Not in this change

- A general upload facility: a media tab, upload history, a gallery, or non-image files.
- Uploads from anywhere but the profile editor.
- A user-typed server. Letting the user paste any `https:` host would need `connect-src https:`, which gives up the rule that an extension page reaches only relays and a declared set of upload hosts. It is a separate decision with its own argument.
- Deleting, listing or mirroring blobs; `HEAD /upload` pre-checks (BUD-06); paid uploads (BUD-07); NIP-96.
- Previewing the uploaded image in an extension page. The existing rule stands: the one remote image load is the user's own picture, once, on Save or Refresh picture.
- Changing how a website's request for a kind 24242 signature is evaluated. That policy is unchanged.
- Proof of work for relays (PROTO-012), which is a separate matter.

## Capabilities

### New Capabilities

- `blossom-image-upload`: the curated server list and the empty default; the consent dialog and what it discloses; image preparation (type from bytes, metadata removal, dimension cap, SVG refused); the `blossom.authorizeUpload` method, the kind 24242 event it builds and its UI-only, lock-gated scope; the `PUT` and its request hygiene; validation of the server's descriptor; error outcomes; the single cancellable operation, bound to its key and field; the activity entry.

### Modified Capabilities

- `remote-media-policy`: "Outbound Media Upload Destination Is Explicit" currently forbids any hardcoded third-party destination and requires a configured endpoint. It becomes: no default destination, a shipped candidate list is permitted, the user chooses from it, disclosure names the host and what it will see, and the returned URL and descriptor are validated.
- `extension-manifest-policy`: the `connect-src` requirement drops `https://nostr.build` and lists exactly the curated origins, still without `'self'`, plaintext `ws:` or `http:`. The "declared upload host" scenario is rewritten for a set of hosts.
- `rpc-privilege-boundary`: "Page-Reachable RPC Namespaces Are Explicitly Limited" lists `blossom` among the UI-only namespaces.
- `settings-storage-locality`: the persisted-settings list names the chosen image host where it named the upload endpoint.

## Impact

- **Domain:**
  - New `src/domain/blossom/`: the curated server list, the descriptor schema, the upload-authorisation event builder, image-type sniffing, and bounds (5 MB input, 2048 px edge, five-minute expiry).
  - `src/domain/types.ts`: `uploadEndpoint` removed, `blossomServer` added.
- **Application:** a small upload-authorisation service that signs through `KeyVaultService.signEvent` for an explicit key, and writes the activity entry.
- **Infrastructure:**
  - New `blossom-rpc.ts` handler, and the RPC union in `rpc.ts`.
  - `schemas.ts`: the new params schema, with `uploadEndpoint` removed from the settings patch.
  - `rpc-router.ts`: lock-gate classification and the UI-only namespace list.
  - The settings reader drops a stored `uploadEndpoint`.
  - The SHA-256 uses the existing `NobleSha256` adapter, imported the way `src/ui/features/backup/key-backup-envelope.ts` imports its adapters. No new primitive and no new dependency.
- **UI:**
  - `ProfileImageField` replaces `ImageUploadField`.
  - A consent dialog, a `useBlossomUpload` hook, and an image-preparation helper next to `src/ui/lib/avatar-capture.ts`.
  - `ProfileEditForm` uses the field for both images.
- **Manifest:** `wxt.config.ts` builds `connect-src` from the curated list. Permissions are unchanged: `storage`, `windows`, `alarms` and the existing set.
- **Tests:**
  - `manifest-assertions.test.ts`: the exact `connect-src`, and that it matches the constant.
  - `lock-gate.test.ts` and `rpc-privilege-boundary.test.ts`: the new method.
  - `validation-schemas.test.ts`, `image-upload-field.test.tsx` and `remote-media-policy.test.tsx`: replaced or rewritten.
  - New tests for the authorisation event, descriptor validation and image preparation.
  - A Playwright journey against a local fixture server that speaks BUD-02.
- **Docs:** `PRIVACY.md` (it currently says Ostrilo has no image upload), `docs/extension-manifest.md`, `docs/relay-trust-boundary.md`, `docs/developers_readme.md`, `docs/rpc-architecture.md`, `docs/design-review/README.md`, and `docs/roadmap.md`.
- **Both builds.** Nothing here is Chromium-only. `pnpm run build:firefox` is part of verification, because the `connect-src` list reaches both manifests.

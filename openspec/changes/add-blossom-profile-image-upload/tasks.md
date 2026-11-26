## 1. Vet The Servers Before Writing Any Product Code

The vetting gate in `proposal.md` governs this group. Nothing in groups 2 to 8 starts until 1.7 records a verdict. If fewer than two independent operators qualify, stop and return to the owner. Do not narrow the change to one host.

- [x] 1.1 Compile a candidate list of public Blossom servers from the Blossom project's own documentation and a current web search. Record for each: operator, host, whether it requires an account or payment, any stated size limit, and where the claim came from. Do not rely on a name remembered from before this change.
- [x] 1.2 Build a throwaway unpacked extension page, outside `src/` and not committed, whose CSP `connect-src` lists the candidate origins. It generates a fresh ephemeral key (never a key from the user's vault), makes a tiny valid PNG, and runs the probes in 1.3.
- [x] 1.3 For each candidate, from that extension page, record:
  - whether the CORS preflight for `PUT` with `Authorization`, `Content-Type` and `X-SHA-256` succeeds;
  - whether `PUT /upload` with a kind 24242 token built exactly as design Decision 2 describes (`created_at` = now − 10, `t`, `x`, `server`, `expiration` = now + 300, base64url without padding) is accepted;
  - the status, and whether the descriptor satisfies the checks in design Decision 8 (matching `sha256` and `size`, `url` containing the hash, `https:`);
  - whether the returned URL loads as an image in a browser;
  - whether a 5 MiB blob is accepted;
  - what status and `X-Reason` a refusal produces.
- [x] 1.4 Open a file chooser from every surface that hosts the profile editor (toolbar popup, side panel, options page) on macOS Chrome and on Firefox. Record whether the surface survives the native dialog with its unsaved form state intact. Deferred: do this against the real Upload button once 6.5 lands, with a person at real Chrome and Firefox. Playwright intercepts the file chooser and never shows the native dialog, so it cannot answer this. It decides only 6.7. Result: checked by hand in Chrome and Firefox; no surface needed the fallback.
- [x] 1.5 Time `NobleSha256` on a 5 MiB buffer on this machine and record it. If it is long enough to block the page noticeably, decide whether to move hashing to a worker before group 5.
- [x] 1.6 A candidate that refuses a token under the 10-second backdate and 300-second expiry policy does not qualify. Record it as refused, with the status it returned. Do not special-case a host, and do not change the constants during the gate: changing either is a revision to the spec and its tests.
- [x] 1.7 Write everything into `openspec/changes/add-blossom-profile-image-upload/blossom-server-vetting.md`, following the `kdf-measurements.md` precedent, with a verdict: proceed with these servers, or stop. Record the list that `servers.ts` will hold, in order.
- [x] 1.8 Delete the throwaway page and its build output.

## 2. Domain And Settings

- [x] 2.1 Write failing tests for the curated list: ids are unique and kebab-case, every origin is a bare `https://` origin with a lowercase host and no path, and the list is non-empty.
- [x] 2.2 Add `src/domain/blossom/servers.ts` with the list from 1.7, plus a lookup by id.
- [x] 2.3 Write failing tests for `src/domain/blossom/auth-event.ts`: exactly the four tags in order, `created_at` equal to `now` minus 10 and `expiration` equal to `now` plus 300 under an injected clock (and `created_at` earlier than `now`, `expiration` later), content `Upload profile image`, header prefix `Nostr `, base64url without padding or `+` `/` `=`, and a decode round trip. Include one fixed vector.
- [x] 2.4 Implement `auth-event.ts`. It builds the unsigned event only. Signing stays in the application layer.
- [x] 2.5 Write failing tests for `src/domain/blossom/descriptor.ts`: a matching descriptor passes. Each of these fails: hash mismatch, size mismatch, `url` without the hash, `http:`, `data:`, `javascript:`, a URL over 512 characters, a missing field. Extra fields pass.
- [x] 2.6 Implement `descriptor.ts` with a loose zod schema, reusing `isAllowedRemoteUrl` from `src/domain/profile/types.ts`.
- [x] 2.7 Write failing tests for `src/domain/blossom/image-sniff.ts`, which judges a header read of at most 4 KiB and never the whole file: JPEG, PNG, GIF and WebP signatures accepted despite a wrong label. An HTML document labelled `image/png` and an SVG are refused. An empty file and a file of 5 MiB plus one byte are refused. A WebP with the `VP8X` animation flag and a PNG containing `acTL` are reported animated. A GIF is reported animated. A PNG with more than 256 chunk headers before its first `IDAT` is refused. The inspector takes a slice reader, and a test asserts it never reads more than 4 KiB in total.
- [x] 2.8 Implement `image-sniff.ts`. Add the bounds as named constants in `src/domain/blossom/constants.ts`: 5 MiB input and output, 2048 px edge, `AUTH_TTL_SECONDS` 300, `AUTH_BACKDATE_SECONDS` 10, 60 s request timeout, 16 KiB reply, 4 KiB header inspection, 256 PNG chunk headers.
- [x] 2.9 Replace `uploadEndpoint` with `blossomServer` in `src/domain/types.ts` and `src/infrastructure/validation/schemas.ts`, accepting only list ids. Reading settings drops a stored `uploadEndpoint` and reads an id that is no longer listed as unset, through the legacy-value handling in `SettingsService`.
- [x] 2.10 Rewrite the `uploadEndpoint` cases in `tests/unit/infrastructure/validation-schemas.test.ts`. Add tests for the dropped endpoint and the unknown id. Confirm `tests/security/settings-locality.test.ts` still passes.

## 3. Background: Authorisation Service And RPC

- [x] 3.1 Write failing tests for `BlossomAuthService`:
  - signs through `KeyVaultService.signEvent(event, keyId)` for the named key;
  - refuses a key the vault does not hold;
  - returns a header whose decoded event verifies;
  - writes one activity entry with origin `extension://profile`, kind 24242 and a signed result;
  - the token appears in no log call and no storage write.
- [x] 3.2 Implement `src/application/services/blossom-auth.service.ts`.
- [x] 3.3 Add `blossom.authorizeUpload` to the RPC union in `src/infrastructure/messaging/rpc.ts`. Add a strict zod params schema in `schemas.ts`: `pubkey` hex64, `sha256` lowercase hex64, `serverId` one of the list ids, and no other key accepted.
- [x] 3.4 Write failing handler tests: a valid call, an extra parameter rejected, an unlisted `serverId` rejected, an uppercase or short hash rejected, an unheld key rejected. Every rejection uses the existing validation code, and no new error code is added (`docs/rpc-error-codes.md` and its test stay green).
- [x] 3.5 Implement `src/infrastructure/messaging/handlers/blossom-rpc.ts`. Add a test that `fetch` is never called during a handler run.
- [x] 3.6 Register the `blossom` namespace in `rpc-router.ts`, UI-only and lock-gated: not in `PAGE_REACHABLE_NAMESPACES`, not in `LOCKED_REACHABLE_METHODS`. Extend `tests/security/rpc-privilege-boundary.test.ts` with a tab-sender refusal that returns `unknown_namespace` and signs nothing. Confirm `tests/security/lock-gate.test.ts` refuses the method while locked.
- [x] 3.7 Wire the service and handler in `src/extension/background.ts`, and add the call to `src/infrastructure/messaging/client.ts`.
- [x] 3.8 Confirm the activity origin filter does not list `extension://profile` for the new entries.

## 4. Manifest Policy

- [x] 4.1 Write failing assertions in `tests/security/manifest-assertions.test.ts`: the `https:` origins in `connect-src` equal the curated list exactly, `https://nostr.build` is absent, no bare `https:` scheme source and no wildcard host appear, and `wss:` remains. Do this for both Chrome and Firefox manifests.
- [x] 4.2 Build `connect-src` in `wxt.config.ts` from the curated list and remove `https://nostr.build`. If importing from `src/domain` into the config does not work, generate the origin list from a small JSON file that `servers.ts` also reads, and keep the equality test from 4.1.
- [x] 4.3 Run `pnpm run build` and `pnpm run build:firefox`, and confirm the manifest assertions and `tests/security/build-output.ts` pass for both.
- [x] 4.4 Update `docs/extension-manifest.md`: the CSP table row, the paragraph about the single upload host, and the manual verification step that mentions nostr.build.

## 5. Page: Image Preparation And The Upload Hook

- [x] 5.1 Write failing tests for `src/ui/lib/prepare-image.ts`, following the injectable-canvas seam in `src/ui/lib/avatar-capture.ts` because jsdom has no decoder:
  - a still image is re-encoded in the same type and its longest side capped at 2048;
  - an animated image is passed through byte-for-byte;
  - the file is read once and its signature checked again, so a file replaced after the header inspection is refused;
  - an undecodable file is refused;
  - an output over 5 MiB is refused;
  - no network request is made.
- [x] 5.2 Implement `prepare-image.ts` with `createImageBitmap` on the local file.
- [x] 5.3 Write failing tests for `useBlossomUpload`, with a stubbed `fetch` and the RPC client:
  - before consent only the header inspection has run: at most 4 KiB read, and no decode, hash, RPC call or `fetch`;
  - the sequence is prepare, hash, authorise, `PUT`, verify;
  - the request has the exact method, URL, headers and options in design Decision 7, and the `Authorization` equals the RPC result;
  - Cancel aborts and is not reported as a failure;
  - the 60-second timeout aborts, using fake timers;
  - a redirect fails the request;
  - the reply is read to at most 16 KiB;
  - each status in the spec maps to its fixed copy;
  - `X-Reason` and body text never reach the state;
  - each descriptor failure leaves the field's value unchanged;
  - the operation contract of design Decision 13:
    - a cancel during preparation or hashing makes no RPC call and sends no request;
    - a cancel while the authorisation call is pending sends no request, and the late token is dropped, never stored or logged;
    - a reply that arrives after a cancel is discarded;
    - unmounting at each stage causes no request, no field write and no state update;
    - a key change mid-operation cancels it and writes nothing to the other key's form;
    - the RPC receives the key captured at confirmation;
    - starting a second upload cancels the first, and the first one's late reply writes nothing;
    - an operation started on the banner never writes the picture, and the reverse.
- [x] 5.4 Implement `src/ui/features/profile/hooks/useBlossomUpload.ts` using `NobleSha256`, imported as `key-backup-envelope.ts` imports its adapters. Add no dependency, and confirm `tests/security/crypto-single-implementation.test.ts` stays green.
- [x] 5.5 Add a test that the page never requests the returned URL after a successful upload.

## 6. Interface

- [x] 6.1 Re-read `docs/design/DESIGN_RULES.md` before starting, and use only the shared primitives and tokens. No gradients, accent rails or retired class names.
- [x] 6.2 Write failing tests for `UploadConsentDialog`: the Upload action is disabled until a server is chosen, a remembered server is preselected, Escape and an outside click cancel with nothing sent, confirming writes `blossomServer`, cancelling does not, and the disclosure names the host, the image, the IP address and the public key. The re-encode and unchanged variants carry their different sentences.
- [x] 6.3 Implement `UploadConsentDialog` on the existing Radix dialog primitive, with a radio group of the curated servers. Return focus to the Upload button on close.
- [x] 6.4 Write failing tests for `ProfileImageField`: it renders for both picture and banner, a pasted URL still works, an in-flight upload shows an indeterminate state with Cancel and no percentage, a failure shows its message beside the field and leaves the value alone, and there is no image preview. Upload is disabled on both fields while an operation runs, and Cancel appears on the owning field only. The success message reads "Uploaded to `<host>`. Save your profile to use it." and does not claim verification.
- [x] 6.5 Implement `ProfileImageField.tsx` and use it for both fields in `ProfileEditForm.tsx`. Remove the `uploadEndpoint` prop and its plumbing.
- [x] 6.6 Delete `ImageUploadField.tsx`. Rewrite `tests/unit/ui/features/profile/image-upload-field.test.tsx` and the upload cases in `remote-media-policy.test.tsx` for the new field and the new requirement.
- [x] 6.7 Apply the outcome of 1.4: on any surface where the file chooser dismisses the page, replace the Upload action there with "Open in a tab to upload". Leave pasting a URL working on every surface. Not needed: the manual check found no surface that closes.

## 7. End-To-End And Design Review

- [x] 7.1 Write a Playwright journey that intercepts a curated origin at the browser-context level and answers the `OPTIONS` preflight and the `PUT` as a BUD-02 server would. It covers choose file, dialog, confirm, field filled, Save, and a kind 0 published carrying the URL.
- [x] 7.2 Add negative journeys: a reply whose hash differs leaves the field unchanged, a refused redirect, a cancelled upload, switching to another key mid-upload (nothing is written to the other key's form), and a refused preflight. Assert that no `securitypolicyviolation` fires.
- [x] 7.3 Add the dialog states (nothing chosen, one chosen, uploading, failed) to the axe scan's surface list, in both themes, and fix any serious or critical finding.
- [x] 7.4 Run `pnpm run build`, then `node docs/design-review/capture-screenshots.mjs` and the same with `OSTRILO_DESIGN_REVIEW_THEME=dark`, against the populated vault. Judge the profile editor and the dialog at popup and side-panel widths, with a long server name and a long URL in the field. Record what the review found in `docs/design-review/README.md`.
- [x] 7.5 Do one real upload by hand to a vetted server with a throwaway key and a harmless image, and confirm the whole path against a live host. This is a manual check and is not added to CI.

## 8. Documentation

- [x] 8.1 Update `PRIVACY.md`, "Images and uploads": replace the sentence saying Ostrilo has no image upload. State that an upload happens only when the user starts it, to a host they pick from a named list, after a confirmation that names what the host will see. State that photos are re-encoded to remove embedded metadata, that animated images are sent unchanged, and that nothing runs in the background.
- [x] 8.2 Update `docs/relay-trust-boundary.md` and `docs/developers_readme.md` (both still describe nostr.build), `docs/rpc-architecture.md` (the `blossom` namespace) and `docs/ostrilo-settings-permissions-v1.md` if it lists the upload endpoint.
- [x] 8.3 Update the UX-002 row in `docs/roadmap.md` to say the picture can be uploaded to a Blossom server from the editor, and add an entry under Unreleased in `CHANGELOG.md`.
- [x] 8.4 Verify every local link and reference in the changed docs.

## 9. Verification

- [x] 9.1 `pnpm run compile`
- [x] 9.2 `pnpm run lint`, because imports under `src/` were added.
- [x] 9.3 `pnpm run test:coverage`, covering the unit, integration and security suites and the coverage thresholds.
- [x] 9.4 `pnpm run build` and `pnpm run build:firefox`, and the manifest and bundle assertions on both.
- [x] 9.5 The Playwright suite (`pnpm run test:e2e`), including the axe scan.
- [x] 9.6 The dependency audit. Confirm `package.json` and `pnpm-lock.yaml` gained no dependency.
- [x] 9.7 `pnpm run doctor`. Address findings in the changed files and report the score.
- [x] 9.8 `pnpm run slop:changes`, and `pnpm run slop:ci` to reproduce the gate locally.
- [x] 9.9 `openspec validate add-blossom-profile-image-upload --strict`.
- [x] 9.10 List the standards-sensitive areas touched (signing surface, CSP, settings, RPC boundary, privacy text) and every command that could not run, with its exact error.

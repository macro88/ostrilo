## 1. Relay Validation Primitives

- [x] 1.1 Add a `src/domain/relay/` module holding named bound constants: max frame 131072 bytes, max accepted events per subscription 20, max content 8192 bytes, max 50 tags of at most 10 elements of at most 1024 bytes, `created_at` future tolerance 900 seconds, max notice text 200 characters, max relay-supplied URL 512 characters, max configured relays 10, fetch deadline 5000 ms, reconnect attempt cap 5.
- [x] 1.2 Add a Zod schema for the NIP-01 relay-to-client message envelope covering `EVENT`, `EOSE`, `OK`, `NOTICE`, `CLOSED`, and `AUTH`, with subscription IDs constrained to `^[a-zA-Z0-9_-]{1,64}$`.
- [x] 1.3 Add a Zod schema for a relay-supplied NIP-01 event enforcing the field bounds from 1.1, with `id` and `pubkey` as 64-character lowercase hex and `sig` as 128-character lowercase hex.
- [x] 1.4 Add a `verifyRelayEvent` helper that recomputes the event ID via `computeEventId` and verifies the signature via `verifyEventSignature` from `src/domain/utils/crypto.ts`, returning a discriminated result rather than throwing.
- [x] 1.5 Add a filter-match helper that checks a candidate event's `pubkey` against `filter.authors` and `kind` against `filter.kinds` when those fields are present.

## 2. Relay Adapter Verification Boundary

- [x] 2.1 Guard `NostrRelayAdapter.handleMessage` on raw message length before calling `JSON.parse`, discarding frames over 128 KB.
- [x] 2.2 Validate the parsed envelope against the schema from 1.2 and discard unknown or malformed message types instead of casting.
- [x] 2.3 Validate the `EVENT` payload against the schema from 1.3 before it is treated as a `NostrEvent`.
- [x] 2.4 Apply the filter-match helper using the filter already stored with the subscription, and drop events whose author or kind was not requested.
- [x] 2.5 Apply `verifyRelayEvent` and invoke `onEvent` only for events whose recomputed ID and signature both verify.
- [x] 2.6 Track accepted events per subscription, stop accepting after 20, and close the subscription at the cap.
- [x] 2.7 Truncate relay `NOTICE` text to 200 characters and stop logging raw relay payloads in the adapter's error paths.
- [x] 2.8 Document the strengthened `INostrRelay` contract in `src/application/ports/relay.ts`: `onEvent` is only ever called with a verified event matching the subscription filter. `src/application/ports/` is outside this change's assigned file set. The contract is documented in the class doc comments on `NostrRelayAdapter` and `RelayManager`, and in `docs/relay-trust-boundary.md`; the port's own prose still needs the one-paragraph edit. — Completed: the port now states the four guarantees an implementation must make before calling onEvent (parsed and bounded, id recomputed, signature verified, filter matched) and that it must bound delivery.
- [x] 2.9 Add the defensive author and kind re-check in `ProfileService` so the application layer does not rely solely on the adapter.

## 3. Secure Relay Transport

- [x] 3.1 Tighten `isValidRelayUrl` in `src/domain/utils/validation.ts` to accept only `wss:`, require a non-empty hostname, and reject embedded credentials.
- [x] 3.2 Add a `RelayUrlSchema` in `src/infrastructure/validation/schemas.ts` that refines through `isValidRelayUrl`, and replace `AppSettingsPatchSchema.relays`'s `z.array(z.url())` with an array of that schema bounded to 10 entries. `src/infrastructure/validation/schemas.ts` is outside this change's assigned file set. `RelayUrlSchema` and `RelayUrlListSchema` are implemented and tested in `src/domain/relay/url.ts`; wiring them in is a two-line import-and-substitute in `schemas.ts`. — Completed: AppSettingsPatchSchema.relays is now RelayUrlListSchema, so a non-wss:, credentialed, over-long or over-numerous relay is refused at the write rather than only at the connect.
- [x] 3.3 Reject non-`wss:` relay URLs in `NostrRelayAdapter` before opening a WebSocket, reporting a relay configuration error.
- [x] 3.4 Replace the local `startsWith("wss://")` check in `src/ui/features/settings/components/shared/RelayList.tsx` with the shared validator and keep the user-facing copy aligned with the enforced rule.
- [x] 3.5 Add the relay-count bound to `normalizeRelayUrls` in `src/extension/background.ts` and keep it as defense in depth. `src/extension/` is outside this change's assigned file set. `RelayManager.setRelayAdapters` now sanitises and bounds its input through `sanitizeRelayUrls`, so a cleartext or over-long list cannot open a connection even if it reaches that far. — Completed: normalizeRelayUrls delegates to sanitizeRelayUrls, so there is one sanitizer with the count bound rather than two that can drift.
- [x] 3.6 Add a settings migration that drops stored non-`wss:` relays and restores `DEFAULT_RELAY_URLS` when no valid relay remains. The migration belongs in `SettingsService` / `background.ts`, both outside this change's assigned file set. Stored `ws://` entries are already dropped at use time by the tightened `isValidRelayUrl` and by `sanitizeRelayUrls`; the default-list restore still needs the settings-layer edit. — Completed: SettingsService.get() sanitizes the stored list on read and restores DEFAULT_RELAY_URLS when nothing valid survives, so the stored list and the connected list are the same list.

## 4. Subscription Lifecycle And Reconnection

- [x] 4.1 Restructure `ProfileService.fetchProfileFromRelay` around a single `settle()` function that clears the timer, closes the subscription, and resolves at most once behind a boolean guard.
- [x] 4.2 Arm the 5-second deadline in the promise body before calling `subscribe`, so a subscribe that never resolves cannot hang the fetch.
- [x] 4.3 Close the subscription on the EOSE path, which currently resolves without closing.
- [x] 4.4 Wrap the event and EOSE handlers so a thrown error settles the fetch with a null or partial result instead of being swallowed by the adapter's catch.
- [x] 4.5 Move the `events.reduce` selection in `parseProfileEvents` inside its `try` block so a malformed payload cannot throw out of the callback.
- [x] 4.6 Remove the subscription handler from the adapter registry on EOSE so the registry drains.
- [x] 4.7 Add up to 20 percent jitter to the reconnect backoff and cap consecutive attempts at 5 in `handleDisconnect`.
- [x] 4.8 On giving up reconnection, clear subscriptions and settle any dependent fetch, and reset the attempt counter after a successful reconnect.

## 5. Profile Cache Isolation And Bounds

- [x] 5.1 Switch `ProfileService`'s cache reads and writes from `this.storage.local` to `this.storage.session`.
- [x] 5.2 Measure the serialised cache before committing a write and evict oldest-first by `fetchedAt` until it fits within 262144 bytes and 50 entries.
- [x] 5.3 Wrap cache writes so any failure, including a quota error, is caught and logged and never surfaces as a profile fetch error, while the freshly fetched metadata is still returned.
- [x] 5.4 Add a startup purge that removes the legacy `profileCache` record from `browser.storage.local`, discarding any already-poisoned entries. Implemented as `ProfileService.purgeLegacyLocalCache()`, a one-shot that runs on the first cache access and is exposed publicly so `background.ts` can also call it at startup once that file is free to edit.

## 6. Profile Metadata Validation Bounds

- [x] 6.1 Change `ProfileMetadataSchema` in `src/domain/profile/types.ts` from `z.looseObject` to a strict object so unknown relay-supplied keys are dropped rather than stored.
- [x] 6.2 Replace the scheme-agnostic `isValidUrl` check with an `https:`-only allowlist bounded to 512 characters, and apply it to `picture`, `banner`, and `website` in both the schema path and the partial-validation fallback.
- [x] 6.3 Add the remaining field bounds: `display_name` 50 characters, `nip05` and `lud16` 254 characters, `lud06` 512 characters.
- [x] 6.4 Enforce a 4096-byte serialised ceiling on validated metadata, omitting the largest optional fields before caching rather than caching an oversized profile.
- [x] 6.5 Surface rejected fields from validation so the profile editor can tell the user which value was dropped, instead of silently omitting it. `validateProfileMetadataDetailed` returns `rejectedFields`.
- [x] 6.6 Confirm `ProfileRpcHandler.handleUpdate` still returns field-level validation errors for user-entered values under the strict schema. Confirmed: it calls `ProfileMetadataSchema.safeParse` directly and maps each issue to an `INVALID_PARAMS` detail, so a non-`https:` picture is now a field-level error rather than a silent drop. No change required.

## 7. Remote Media Rendering Policy

- [x] 7.1 Stop passing `profile.picture` to an image source in `src/ui/features/profile/components/ProfileSummary.tsx` and render the seal avatar with the profile initial.
- [x] 7.2 Stop passing the avatar URL to `AvatarImage` in `src/ui/components/layout/KeySelector.tsx` at both the trigger and the list item, keeping `AvatarFallback` as the rendered avatar.
- [x] 7.3 Stop passing the avatar URL to `AvatarImage` in `src/ui/features/settings/components/shared/KeySelectorCard.tsx`.
- [x] 7.4 Render the `picture` URL, when present, as monospace text with a copy affordance, and make viewing the image an explicit action that opens an ordinary browser tab. New `RemoteUrlField` component.
- [x] 7.5 Render `website` as a link that opens in a new tab with `rel="noopener noreferrer"`, and remove any preview that would load an entered image URL inside an extension page.
- [x] 7.6 Keep every surface aligned with `docs/design/DESIGN_RULES.md`, using the seal avatar, mono treatment for cryptographic data, and no new hex values.

## 8. Avatar Upload Destination

- [x] 8.1 Remove the hardcoded `https://nostr.build/api/v2/upload/files` from `src/ui/features/profile/components/ImageUploadField.tsx`.
- [x] 8.2 Add an upload endpoint setting that is empty by default and validated as an `https:` URL. `ImageUploadField` and `ProfileEditForm` now take an `uploadEndpoint` that is undefined by default and is only honoured when it parses as an `https:` URL, so the security property holds today. The persisted *setting* needs `AppSettings` in `src/domain/types.ts` and `AppSettingsPatchSchema` in `src/infrastructure/validation/schemas.ts`, both outside this change's assigned file set. — Completed: AppSettings.uploadEndpoint added, validated as https: only (empty clears it) in AppSettingsPatchSchema. Undefined by default: no destination, no outbound request.
- [x] 8.3 Hide or disable the upload control when no endpoint is configured, with copy explaining that no image host is configured and a URL can be pasted instead.
- [x] 8.4 Name the destination host to the user and require confirmation before the image is sent.
- [x] 8.5 Validate the URL returned by the upload service against the `https:`-only allowlist before writing it into profile metadata, and report a non-conforming response as a failed upload.

## 9. Relay Query Partitioning

- [x] 9.1 Add a per-install random salt in extension storage used to derive a stable relay assignment for each pubkey.
- [x] 9.2 Partition `ProfileService.getAllProfiles` so each managed pubkey is queried on exactly one assigned relay, with filters carrying exactly one entry in `authors` and `limit: 1`.
- [x] 9.3 Allow at most one alternate-relay retry when an assigned relay fails, and never retry a background-hydration pubkey on every relay.
- [x] 9.4 Keep explicit user-initiated refresh of a single pubkey able to fan out to all configured relays without including any other managed pubkey.
- [x] 9.5 Add relay settings copy stating that a single configured relay sees every identity the extension queries, and that partitioning only helps with more than one relay.
- [x] 9.6 Verify the `useProfileMetadata` call sites in `KeySelector` and `KeySelectorCard` do not reintroduce an all-keys fan-out per relay. They call `profile.get` per pubkey, which previously fanned out to every relay for every key. Partitioning is therefore applied inside `getProfile` on the non-forced path rather than only in `getAllProfiles`, so the hook's call sites are covered without editing `src/ui/hooks/`.

## 10. Tests

- [x] 10.1 Add a security test proving a forged relay event is rejected: a kind `0` event claiming the user's own pubkey with an attacker-chosen `name` and `picture` and an invalid signature must be discarded, must not enter the cache, and must not change the displayed identity. `tests/security/relay-event-forgery.test.ts`.
- [x] 10.2 Add adapter tests for the size guard, envelope schema rejection, event schema rejection, author mismatch, kind mismatch, event-ID mismatch, and the 20-event cap. `tests/integration/relay-adapter-trust.test.ts`.
- [x] 10.3 Add a test proving `["EVENT", subId, null]` does not hang `getProfile` and that the fetch settles exactly once.
- [x] 10.4 Add tests proving the EOSE path closes the subscription and that reconnection stops after 5 consecutive failures.
- [x] 10.5 Update `tests/unit/domain/utils.test.ts` and `tests/unit/domain/domain-utils.test.ts`, which both currently assert `ws://localhost:8080` is a valid relay URL, and add cases for credentials, empty hostname, and non-`wss:` schemes.
- [x] 10.6 Add schema tests proving `AppSettingsPatchSchema` rejects `http:`, `ws:`, and other non-`wss:` relay entries and rejects lists longer than 10. The equivalent tests exist against `RelayUrlSchema` and `RelayUrlListSchema` in `tests/unit/domain/relay-trust-boundary.test.ts`; they move to `AppSettingsPatchSchema` when 3.2 lands. — Completed: the http:/ws:/credentialed/over-long/over-numerous cases now assert against AppSettingsPatchSchema itself, alongside the upload-endpoint cases.
- [x] 10.7 Add profile validation tests proving `http:`, `data:`, and `javascript:` URLs are dropped, unknown relay-supplied keys are dropped, and oversized metadata is reduced before caching. `tests/unit/domain/profile-metadata-bounds.test.ts`.
- [x] 10.8 Add cache tests proving writes target `storage.session`, never `storage.local`, that the 256 KB budget is enforced before commit, that a failed cache write does not fail the fetch, and that the legacy `browser.storage.local` `profileCache` record is purged at startup.
- [x] 10.9 Add partitioning tests proving no relay receives every managed pubkey when more than one relay is configured, that assignment is stable, and that explicit single-key refresh may fan out.
- [x] 10.10 Add UI tests proving no extension page sets a relay-supplied URL as an image source and that the seal fallback renders instead. `tests/unit/ui/features/profile/remote-media-policy.test.tsx`.
- [x] 10.11 Add upload tests proving the control is unavailable with no endpoint configured and that a non-`https:` response URL is rejected.

## 11. PRD And Documentation

- [x] 11.1 Add a first-class PRD requirement in `docs/v2-prd.md` covering relay input validation and the remote media policy. Added as `SEC-020` (relay input validation and trust boundary) and `SEC-021` (remote media and outbound egress policy). Note: the `SEC` series had already grown to `SEC-019` by the time this landed.
- [x] 11.2 Note in the PRD relay entry that CSP `img-src` and `connect-src` are delivered by `harden-manifest-and-build`, not by this change.
- [x] 11.3 Update relay and profile developer documentation only where the externally visible behaviour changed: `wss://`-only relays, verified relay events, no remote avatar loading, and the configured upload destination. `docs/relay-trust-boundary.md`.

## 12. Verification

- [x] 12.1 Run `openspec validate validate-relay-and-remote-data --strict`.
- [x] 12.2 Run `pnpm run compile`.
- [x] 12.3 Run the focused Vitest suites.
- [x] 12.4 Run the new forged-relay-event security test and confirm it fails when verification is removed and passes with it wired in. Demonstrated by reverting the `verifyEventSignature` call, the storage-area move, the `https:` allowlist, and the deadline ordering, one at a time.
- [x] 12.5 Run `pnpm test` for the full unit, integration, and security suites.
- [x] 12.6 Run `pnpm run build` and `pnpm run build:firefox`.
- [x] 12.7 Run React Doctor. `npx react-doctor@latest` remains forbidden; `restore-security-test-assurance` has since pinned the binary, so `node_modules/.bin/react-doctor --scope changed` is what was run.

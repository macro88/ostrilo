## Why

Profile hydration turned Ostrilo into a WebSocket client of arbitrary Nostr relays, but relay output is still treated as trustworthy input by the process that holds the private keys. `NostrRelayAdapter.handleMessage` JSON-parses a relay frame and casts the payload straight to `NostrEvent`, and `ProfileService.parseProfileEvents` then picks the highest `created_at` and parses its content. Nothing verifies the Schnorr signature, recomputes the event ID, or checks that the event's author is the pubkey that was requested — even though `verifyEventSignature` already exists in `src/domain/utils/crypto.ts` and is simply not called here.

A single hostile or compromised relay can therefore poison the profile cache for the user's own pubkey and change the name and avatar shown for their identity. That is not cosmetic: the key selector and the profile surfaces are how a user confirms which identity they are about to sign with. The same untrusted channel picks image URLs that privileged extension pages load directly, writes unbounded metadata into the same `browser.storage.local` area that holds the encrypted key vault, and can be reached over cleartext `ws://` because only one React component enforces `wss://`.

## What Changes

- Add a validation boundary for everything a relay sends: a schema for the relay message envelope, a schema for NIP-01 events, mandatory event-ID recomputation, mandatory Schnorr signature verification via the existing `verifyEventSignature`, and rejection of any event whose author or kind does not match the subscription that asked for it. An unverified relay event never reaches the cache or the UI.
- Bound every relay-controlled quantity with concrete limits: WebSocket message size, events accepted per subscription, event content length, tag count and tag element size, validated metadata size, and total cached profile size.
- Isolate the profile cache from the encrypted key vault so relay-driven cache growth can never make a key write fail, and purge the legacy cache entries that were stored without verification.
- **BREAKING** Require `wss://` at every layer instead of relying on a downstream filter: tighten `isValidRelayUrl`, give `AppSettingsPatchSchema.relays` a real relay-URL schema instead of `z.array(z.url())`, and reject non-`wss://` URLs in the relay adapter itself. Stored `ws://` relays are dropped on migration.
- Restrict relay-supplied URLs to an `https://` scheme allowlist at the validation boundary, and stop loading relay-chosen remote images in privileged extension pages so a hostile relay cannot collect the user's IP address and a visit signal on every render.
- Fix the subscription lifecycle: close subscriptions on EOSE, guarantee the profile fetch promise always settles even when a relay sends a malformed payload, and cap reconnect attempts so a hostile relay cannot hold a permanent reconnect loop in the background worker.
- Partition profile queries across configured relays so one relay does not learn the user's whole identity set.
- Make the avatar upload destination explicit and configurable instead of a hardcoded third-party host, and validate the URL that the upload service returns before it enters profile metadata.

Content Security Policy `img-src` and `connect-src` declarations belong to the companion change `harden-manifest-and-build`, which owns `wxt.config.ts`. This change specifies the behaviour those directives enforce and does not edit the manifest.

## Capabilities

### New Capabilities

- `relay-trust-boundary`: How relay input is validated, verified, and bounded before it can affect extension state — envelope and event schemas, signature and author checks, size and count limits, `wss://`-only transport, subscription lifecycle, and per-relay query partitioning.
- `remote-media-policy`: What the extension is allowed to fetch or render from a URL that a remote party chose — the `https://` scheme allowlist for relay-supplied URLs, the rule that privileged extension pages do not load relay-chosen remote images, and the policy for the outbound avatar upload destination.

### Modified Capabilities

- `profile-metadata`: Reconcile the profile capability with the new trust boundary. `Security Considerations` must require signature and author verification rather than only React escaping; `Profile Metadata Type Definition` must require `https://` URLs and bounded field sizes instead of "any parseable URL"; `Profile Service`, `Nostr Relay Adapter Implementation`, `Relay Query Strategy`, and `Error Handling` must reflect verification, partitioning, subscription closure, and always-settling fetches; `Profile Cache Storage` must move off the key-vault storage area and enforce a byte cap; `Performance Optimization` must account for verification cost and partitioned queries; and `ProfileView UI Integration` must stop mandating that a relay-supplied picture URL be rendered.

## Impact

- `src/infrastructure/relay/nostr-relay.adapter.ts`: message size guard, envelope and event validation, filter-match enforcement, verification before `onEvent`, `wss://` guard in the constructor, reconnect attempt cap.
- `src/infrastructure/relay/relay-manager.ts`: inherits the verified-event contract, gains per-relay query partitioning support and bounded relay counts.
- `src/application/services/profile.service.ts`: defensive author and kind re-check, subscription closure on EOSE, a deadline that always settles the fetch promise, partitioned `getAllProfiles`, cache writes moved to an isolated storage area with a byte cap and best-effort failure handling.
- `src/domain/profile/types.ts`: `ProfileMetadataSchema` becomes bounded and `https://`-only, and stops passing unknown relay-supplied keys through verbatim.
- `src/domain/utils/validation.ts`: `isValidRelayUrl` no longer accepts `ws:`.
- `src/infrastructure/validation/schemas.ts`: new relay message, relay event, and relay URL schemas; `AppSettingsPatchSchema.relays` validated as relay URLs with an array bound.
- `src/extension/background.ts`: `normalizeRelayUrls` remains defense in depth and gains a relay-count bound; startup purges the legacy unverified profile cache.
- `src/ui/features/profile/components/ProfileSummary.tsx`, `src/ui/components/layout/KeySelector.tsx`, `src/ui/features/settings/components/shared/KeySelectorCard.tsx`: stop rendering relay-supplied `picture` URLs in privileged pages; use the existing seal and initial fallback.
- `src/ui/features/profile/components/ImageUploadField.tsx`: hardcoded `https://nostr.build/api/v2/upload/files` replaced by a configured, user-visible destination with a validated response URL.
- `src/ui/features/settings/components/shared/RelayList.tsx`: reuse the shared relay-URL validator instead of a local `startsWith("wss://")` check.
- Tests: `tests/integration/relay-adapter.test.ts`, `tests/integration/relay-manager.test.ts`, `tests/integration/profile-cache.test.ts`, `tests/unit/application/services/profile.service.test.ts`, `tests/unit/domain/utils.test.ts` and `tests/unit/domain/domain-utils.test.ts` (both currently assert `ws://localhost:8080` is a valid relay URL), plus a new security test proving a forged relay event is rejected.
- Coordination: `harden-manifest-and-build` declares CSP `img-src` and `connect-src`; `restore-security-test-assurance` owns pinning React Doctor locally.

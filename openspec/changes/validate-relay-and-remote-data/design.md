## Context

Ostrilo's background service worker holds the encrypted key vault and performs every signing operation. Since profile hydration shipped, that same worker is also a WebSocket client of arbitrary Nostr relays. The relay is an untrusted remote party, but its output is currently consumed as if it were trustworthy.

The current state, verified against the source:

- `NostrRelayAdapter.handleMessage` (`src/infrastructure/relay/nostr-relay.adapter.ts:118-176`) does `JSON.parse(data)` with no size guard, checks only that the result is an array of length ≥ 2, and in the `EVENT` branch casts the third element straight to `NostrEvent` before handing it to the subscription callback. There is no schema, no event-ID recomputation, no signature check, and no comparison against the filter that created the subscription.
- `ProfileService.parseProfileEvents` (`src/application/services/profile.service.ts:200-218`) picks the event with the highest `created_at` and `JSON.parse`es its content. `validateProfileMetadata` then shapes the result. Nothing has established that the event was signed by the key it claims.
- `verifyEventSignature` already exists at `src/domain/utils/crypto.ts:447`, alongside `computeEventId` at line 384. Neither is called on the relay path. The capability is present; it is simply not wired up.
- The consequence is that a hostile or compromised relay can supply a kind:0 event claiming the user's own pubkey and rewrite the name and avatar the extension shows for that identity. The key selector (`src/ui/components/layout/KeySelector.tsx`), the settings key list (`src/ui/features/settings/components/shared/KeySelectorCard.tsx`), and the profile surface (`src/ui/features/profile/components/ProfileSummary.tsx`) are how a user confirms which identity is about to sign. Poisoning them is an integrity problem for signing, not a cosmetic one.

Four further problems come from the same trust gap:

- `validateProfileMetadata`'s URL check is `new URL(url)` inside `isValidUrl` (`src/domain/profile/types.ts:34-41`). It constrains nothing about the scheme, so `http:`, `data:`, and `javascript:` all pass. The retained value is then set directly as an image source at `ProfileSummary.tsx:31`, `KeySelector.tsx:122` and `:183`, and `KeySelectorCard.tsx:112`. `wxt.config.ts` declares no `content_security_policy` at all, so there is no `img-src` backstop. A relay therefore chooses a host that receives the user's IP address and a visit signal every time a privileged extension page renders.
- `ProfileMetadataSchema` is a `z.looseObject` (`src/domain/profile/types.ts:57-93`), so on the success path unknown relay-supplied keys pass through verbatim with no size bound, and `saveCache` (`src/application/services/profile.service.ts:233-238`) writes the whole record to `browser.storage.local` — the same area that holds `encryptedKeys` (`src/application/services/key-vault.service.ts:13,44`). If that quota is exhausted, `saveKeys` rejects, and in `createKey` the `finally { zeroize(sk) }` block destroys the freshly generated secret that was never persisted. A relay-driven storage exhaustion is therefore adjacent to a key-loss scenario.
- Cleartext relays are accepted. `isValidRelayUrl` (`src/domain/utils/validation.ts:104-111`) returns true for both `ws:` and `wss:`, and it is the filter used by `normalizeRelayUrls` (`src/extension/background.ts:47-65`). `AppSettingsPatchSchema.relays` (`src/infrastructure/validation/schemas.ts:43`) is only `z.array(z.url())`, which accepts any parseable URL. `NostrRelayAdapter` checks the URL not at all. The single place that actually requires `wss://` is a `startsWith` string check in a React component, `RelayList.handleAdd` (`src/ui/features/settings/components/shared/RelayList.tsx:24-27`). So: the UI is the only gate on scheme, the schema lets non-websocket URLs into stored settings, the background filter quietly drops them at use time, and the adapter will connect to anything it is handed.
- Subscriptions leak and fetches can hang. `fetchProfileFromRelay` (`src/application/services/profile.service.ts:159-195`) resolves on EOSE but never calls `close(subId)` on that path, so the adapter's `subscriptions` map never empties; `handleDisconnect` (`nostr-relay.adapter.ts:181-211`) only returns early when that map is empty and has no attempt cap, so a relay can hold a permanent 30-second reconnect loop. Worse, the 5-second timeout is armed inside `.then((subId) => ...)`, and `parseProfileEvents` reduces over `events` outside its `try`. A relay that sends `["EVENT", subId, null]` makes `events.reduce` throw a `TypeError` from inside the EOSE callback; that throw is swallowed by `handleMessage`'s catch, `clearTimeout` has already run, and the outer promise never settles. `getProfile` awaits forever.

Two privacy problems are structural rather than defects:

- `getAllProfiles` (`src/application/services/profile.service.ts:75-93`) calls `getProfile` for every managed key, and each call subscribes through the shared `RelayManager`, which fans out to every configured relay over the same connections. Each relay therefore sees a `REQ` for every pubkey the user manages, correlating identities the user deliberately kept separate. `useProfileMetadata(pubkeys)` in `KeySelector` triggers the same fan-out from the UI side.
- `ImageUploadField` posts the user's chosen image to a hardcoded `https://nostr.build/api/v2/upload/files` (`src/ui/features/profile/components/ImageUploadField.tsx:75`) and then trusts the URL that service returns. That destination is not declared, configurable, or disclosed, and it contradicts the project constraint that the extension makes no external API calls for core functionality.

Constraints this design must respect: hexagonal layering (domain has no dependencies, infrastructure may depend on domain and application); a background bundle budget; MV3 service-worker statelessness; Chrome MV3 and Firefox MV2 parity; and `docs/design/DESIGN_RULES.md`, which already specifies seal-shaped avatars with initial fallbacks and monospace treatment for cryptographic data.

## Goals / Non-Goals

**Goals:**

- Establish one validation boundary that every relay byte crosses, so that an unverified relay event can never reach the profile cache, the RPC boundary, or an extension page.
- Give every relay-controlled quantity an explicit numeric bound.
- Make relay-derived storage incapable of causing a key write to fail.
- Remove the IP-leak channel created by rendering relay-chosen image URLs in privileged pages.
- Require `wss://` consistently, with the schema and the domain validator agreeing rather than deferring to a downstream filter.
- Make every relay-backed fetch settle, every subscription close, and every reconnect loop terminate.
- Reduce what a single relay learns about the user's identity set.
- Make the outbound upload destination explicit and off by default.

**Non-Goals:**

- No CSP or manifest edits. `harden-manifest-and-build` owns `wxt.config.ts` and will declare `img-src 'self' data:` and a `connect-src` that permits `wss:` relays plus any configured upload host. This change specifies the behaviour those directives enforce and must not require a wider policy.
- No NIP-42 relay authentication, no NIP-65 relay-list discovery, no relay reputation or scoring.
- No consent-gated remote avatar fetching in this slice. The design records how it would work and why it is deferred.
- No caching of image bytes, no image downscaling, no OffscreenCanvas work.
- No change to the NIP-07 signing path, policy evaluation, or the approval queue.
- No change to how keys are encrypted or stored beyond removing the shared-quota interaction.
- No React Doctor run in this change; `npx react-doctor@latest` currently fails to install because pnpm blocks `semver@6.3.1` with `ERR_PNPM_TRUST_DOWNGRADE`, and pinning it locally belongs to `restore-security-test-assurance`.

## Decisions

### Decision 1: Verify at the adapter, using the subscription's own filter as the expectation

`NostrRelayAdapter` becomes the single choke point. Before it invokes `onEvent`, in this order:

1. Reject the raw frame if it exceeds 128 KB, before `JSON.parse`.
2. Validate the envelope against a relay-message schema; the type must be one of `EVENT`, `EOSE`, `OK`, `NOTICE`, `CLOSED`, `AUTH`, and any subscription ID must match `^[a-zA-Z0-9_-]{1,64}$`.
3. Validate the event payload against a bounded NIP-01 event schema.
4. Check the event against the filter stored with the subscription: `pubkey` must be in `filter.authors` when that is present, and `kind` must be in `filter.kinds` when that is present.
5. Recompute the event ID with `computeEventId` and compare it to `event.id`.
6. Verify the signature with `verifyEventSignature`.
7. Stop accepting events for that subscription after 20 accepted events, and close it.

The adapter already stores `filter` alongside the callbacks (`nostr-relay.adapter.ts:21-28`), so the expectation is available without changing the `INostrRelay` signature. The port's contract is strengthened in prose: `onEvent` is only ever called with an event whose ID and signature verify and which matches the subscription filter. `RelayManager` inherits this for free, and `ProfileService` keeps a cheap defensive re-check of author and kind.

**Rationale:** Putting verification at the transport edge means there is exactly one place to audit and no path around it. Checking against the subscription filter rather than a caller-supplied expectation also fixes the general case — a relay answering a request for one author with data about another — not just the profile case. Ordering the cheap checks before the Schnorr verification means a flooding relay cannot buy expensive curve operations with cheap bytes.

**Alternative considered:** Verify in `ProfileService`, where the requested pubkey is known explicitly. That leaves the port emitting unverified events, so every future consumer of `INostrRelay` would have to remember to verify. It also spreads crypto calls through the application layer. Rejected.

**Alternative considered:** Verify in `RelayManager` only. `RelayManager` is optional in the composition — `NostrRelayAdapter` is exported directly from `src/infrastructure/relay/index.ts` and can be constructed alone — so a consumer could bypass it. Rejected.

### Decision 2: Bounds are named constants in the domain, not scattered literals

Relay message and event schemas go in a new domain module (`src/domain/relay/`), alongside the verifier that composes `computeEventId` and `verifyEventSignature`. `src/domain/profile/types.ts` already imports Zod, so a domain-owned schema is consistent with the existing layering.

The numbers:

| Bound | Value |
|---|---|
| Max relay WebSocket frame | 131072 bytes (128 KB) |
| Max accepted events per subscription | 20 |
| Max event `content` | 8192 bytes |
| Max `tags` arrays / elements per tag / bytes per element | 50 / 10 / 1024 |
| `created_at` future tolerance | 900 seconds |
| Max relay `NOTICE` text retained for logging | 200 characters |
| Max validated metadata, serialised | 4096 bytes |
| Max profile cache entries | 50 |
| Max profile cache bytes | 262144 bytes (256 KB) |
| Max configured relays | 10 |
| Max relay-supplied URL length | 512 characters |
| Profile fetch deadline | 5000 milliseconds |
| Reconnect attempts before giving up | 5 |

`ProfileMetadataSchema` changes from `z.looseObject` to a strict object so unknown relay-supplied keys are dropped rather than stored. The partial-validation fallback in `validateProfileMetadata` already only copies known fields, so this makes the two paths agree.

**Rationale:** 8 KB of content and 4 KB of validated metadata are generous for kind:0 — a real profile is 1–2 KB — while 50 entries at 4 KB stays inside the 256 KB budget. 128 KB per frame is far above anything a kind:0 subscription needs and still cheap to check with a length comparison before parsing.

**Alternative considered:** Keep `looseObject` and bound only total serialised size. That preserves forward compatibility with new NIP fields but keeps arbitrary attacker-chosen keys in a record the UI iterates over. Rejected; adding a field to the schema is a one-line change when a NIP warrants it.

### Decision 3: One `wss://`-only rule, enforced at four layers

- `isValidRelayUrl` drops `ws:` and additionally requires a non-empty hostname and no embedded credentials.
- `src/infrastructure/validation/schemas.ts` gains a `RelayUrlSchema` that refines through `isValidRelayUrl`, and `AppSettingsPatchSchema.relays` becomes an array of that schema with a maximum length of 10. `z.array(z.url())` goes away.
- `NostrRelayAdapter` refuses to open a WebSocket for a non-`wss:` URL.
- `RelayList` replaces its `startsWith("wss://")` check with the shared validator so the message the user sees and the rule the system enforces cannot drift.

`normalizeRelayUrls` in `background.ts` stays as defense in depth and gains the relay-count bound.

**Rationale:** The current arrangement is the worst of both worlds: the UI is the only real gate, invalid values persist in stored settings and are displayed back to the user, and the thing that actually opens the socket validates nothing. Making the schema and the domain validator agree means a value that reaches storage is a value the adapter will accept.

No `ws://localhost` development exemption is added. There is no dev-relay workflow in the repository, and an exemption is a permanent hole for a temporary convenience. If one is needed later it should be an explicit build-time flag, not a runtime string match.

**Alternative considered:** Leave `isValidRelayUrl` permissive and enforce `wss:` only in the adapter. That keeps invalid data in settings and keeps the UI and the storage layer disagreeing. Rejected.

### Decision 4: Move the profile cache to `browser.storage.session` and give it a measured byte budget

`ProfileService` writes to `this.storage.session` instead of `this.storage.local`. Before committing a write it serialises the cache, measures it, and evicts oldest-first by `fetchedAt` until the result is within 256 KB and 50 entries. Cache writes are wrapped so any failure — quota or otherwise — is caught, logged, and never surfaced as a fetch error; the freshly fetched metadata is still returned for the current request.

`StorageSuite` already exposes a `session` area (`src/infrastructure/storage/adapters.ts:20-26`) and `KeyVaultService` already uses it for lock state, so this is available on Chrome MV3 and Firefox MV2 without new plumbing.

Quota-exhaustion behaviour is then well defined: relay-derived bytes live in a different area from `encryptedKeys`, so no volume of relay data can make `saveKeys` reject. That matters because `createKey` and `importKey` zeroize the private key in a `finally` block; a rejected `saveKeys` destroys a secret that was never persisted. Removing the shared quota removes that adjacency without touching `KeyVaultService`.

**Rationale:** A byte cap alone bounds our own contribution but still places attacker-influenced data in the vault's quota, where it competes with key writes. A separate area makes the isolation structural rather than arithmetic. Doing both gives defense in depth.

**Trade-off:** `storage.session` is cleared when the browser restarts, so the first profile view after each browser start costs one relay round trip per identity in view. For a cache with a 1-hour TTL that is an acceptable price, and it has a security benefit: no relay-derived data survives a restart, so a poisoned entry cannot persist.

**Alternative considered:** Keep the cache in `storage.local` with the byte cap only. Survives restarts, but relay-influenced data keeps sharing the quota with key material. Rejected.

**Alternative considered:** A dedicated IndexedDB store. More code, another storage abstraction outside `StoragePort`, and no benefit over session storage for a short-TTL cache. Rejected.

### Decision 5: Privileged extension pages do not load relay-chosen images

`ProfileSummary`, `KeySelector`, and `KeySelectorCard` stop passing `profile.picture` to an image source. They render the existing seal avatar with the profile initial, which `DESIGN_RULES.md` §5 and §7 already specify as the canonical avatar treatment. The `picture` URL remains visible as monospace text with a copy affordance, consistent with how the codebase treats npub values, and viewing the image requires an explicit user action that opens it in an ordinary browser tab.

**Rationale:** The URL is chosen by an untrusted party and rendered in a page that holds the signing session. A CSP `img-src` cannot help here, because the problem is not which scheme is used but that the host is attacker-selected; any policy permissive enough to show real avatars is permissive enough to leak the user's IP address and a per-render visit signal. Proxying is not available — Ostrilo has no server, and adding one contradicts the local-only premise. That leaves fetching into a bounded data URI behind explicit consent, or not rendering. Not rendering is chosen for this change because it is the only option with zero egress, it needs no new consent surface, and the fallback it falls back to is already the house avatar style, so the UI loses very little.

The consent-gated data-URI path is recorded, not built: the background worker would fetch the image at profile-fetch time only with an explicit opt-in, downscale it, store it under a separate bounded budget, and serve it as a `data:` URI so `img-src 'self' data:` still holds. It is deferred because it needs image downscaling in a service worker, a second cache with its own eviction, and a consent surface — three things that do not belong in a change whose purpose is to close a verification gap.

**Alternative considered:** Keep loading remote images and rely on `img-src https:`. That declares the leak rather than fixing it. Rejected.

### Decision 6: One `settle()` guard per fetch, with the deadline armed first

`fetchProfileFromRelay` is restructured so that a single `settle(result)` function clears the timer, closes the subscription if one was opened, and resolves at most once, guarded by a boolean. The deadline is armed in the promise body before `subscribe` is called, so a `subscribe` that never resolves cannot hang the fetch. EOSE, the accepted-event cap, and the deadline all route through `settle`. Everything inside the event and EOSE handlers is wrapped so a throw becomes a settled null result rather than a swallowed exception and an unresolved promise. `parseProfileEvents` reduces inside its `try` rather than outside it.

In the adapter, EOSE removes the subscription handler, `handleDisconnect` adds up to 20 percent jitter and stops after 5 consecutive failures, and on giving up it clears subscriptions so the reconnect loop cannot outlive the work that justified it.

**Rationale:** The current hang is not a timeout that is too long; it is a promise with no path to resolution. A single settle point with a guard makes "always settles" a property of the structure rather than of every branch being right.

**Alternative considered:** Wrap the fetch in `Promise.race` with a timeout. That settles the caller but leaks the subscription and the reconnect loop behind it. Rejected as a partial fix.

### Decision 7: Assign each pubkey to one relay, seeded per install

Background hydration assigns each managed pubkey to exactly one relay from the configured list, using a stable mapping derived from the pubkey and a per-install random salt held in extension storage. Filters carry exactly one entry in `authors`. On failure the pubkey may be retried on one alternate relay, never on all of them. An explicit user-initiated refresh of the selected key may fan out to every relay, because that fetch concerns a single identity and adds no correlation beyond that identity.

**Rationale:** Sending every pubkey to every relay is the maximally correlating choice and it is what the code does today. One relay per pubkey is the minimally correlating choice that still uses the configured set. Salting the mapping per install stops the assignment from being globally predictable, so relays cannot collude on a known partition.

**Trade-off and honest limit:** With the default relay list of a single relay (`DEFAULT_RELAY_URLS = ["wss://relay.primal.net"]`), partitioning cannot help at all — one relay necessarily sees every query. Relay settings must say so plainly rather than implying a protection that does not exist in that configuration. Partitioning also costs coverage: a profile that exists only on an unassigned relay will not be found during background hydration, so some identities will show the fallback avatar and label until the user refreshes them explicitly. That is the intended shape of the trade — routine hydration favours privacy, explicit refresh favours completeness.

**Alternative considered:** Query all relays but stagger requests over time. Timing separation does not prevent correlation by a relay that simply records the pubkeys it is asked about. Rejected.

### Decision 8: The upload destination becomes configuration, and defaults to none

The hardcoded `https://nostr.build/api/v2/upload/files` is removed from `ImageUploadField`. The destination becomes a setting that is empty by default; with no destination configured the upload control is unavailable and the UI explains that no image host is configured and a URL can be pasted instead. When configured, the endpoint must be `https:`, the host is named to the user before the image is sent, and the URL the service returns must pass the same `https:`-only validator before it is written into profile metadata. The returned URL is never fetched or rendered by the extension.

**Rationale:** Sending a user's image to a third party is a decision the user should make, not a constant in a component. It is also the only outbound non-relay egress in the codebase and it is currently undeclared, which makes `connect-src` impossible to write tightly. Defaulting to none keeps the project's "no external services" constraint true for a fresh install.

**Alternative considered:** Keep `nostr.build` as a default with a disclosure banner. Simpler, but it makes an outbound third-party dependency the out-of-the-box behaviour of a key-management tool. Rejected.

**Alternative considered:** Remove upload entirely and accept URLs only. Smallest surface, and acceptable, but it removes a working feature for users who have a host they trust. The configured-and-empty default achieves the same default posture without deleting the capability.

### Decision 9: CSP is declared by the companion change

`img-src 'self' data:` and a `connect-src` covering `wss:` relays plus any configured upload host are declared in `wxt.config.ts` by `harden-manifest-and-build`. This change must leave the extension in a state where that policy is sufficient — which Decision 5 guarantees — and must not introduce a rendering or fetch path that would require widening it.

**Rationale:** Two changes editing `wxt.config.ts` would conflict, and the manifest hardening change owns that file. Behaviour and policy are specified in the place that owns each.

## Risks / Trade-offs

- [Risk] Signature verification adds latency to profile loads. → Mitigation: verification runs only on cache miss, cheap checks reject before any curve operation, at most 20 verifications occur per subscription, and the budget is capped at 50 ms per fetch. `@noble/curves` is already in the background bundle, so there is no new dependency cost.
- [Risk] Users whose profile pictures are hosted on non-conforming URLs — plain `http:`, or a `data:` URI — will see their avatar field silently disappear. → Mitigation: rejected fields are surfaced as field-level validation state rather than swallowed, so the profile editor can tell the user which value was dropped and why. The seal-and-initial fallback is the house avatar style, so the surface still reads as intentional.
- [Risk] Removing remote avatars entirely is a visible feature regression for users who expect to see their picture. → Mitigation: the URL remains visible and copyable, opening it is one explicit action, and the deferred consent-gated data-URI path is recorded so the capability can return without reopening the leak.
- [Risk] Partitioning increases relay round-trips in aggregate and can leave some identities unhydrated. → Mitigation: one alternate-relay retry on failure, explicit refresh still fans out for a single identity, and relay settings state the coverage trade-off. With one configured relay the change is a no-op and the UI says so.
- [Risk] Already-poisoned cache entries would otherwise survive the fix and keep displaying attacker-chosen names and avatars. → Mitigation: the legacy `profileCache` record in `browser.storage.local` is deleted at startup and nothing is migrated; every profile is re-fetched and verified on next use.
- [Risk] Dropping `ws://` breaks any user who configured a cleartext or local relay. → Mitigation: migration removes those entries and restores the default list if nothing valid remains, and the settings copy states the requirement. Two existing unit test files (`tests/unit/domain/utils.test.ts` and `tests/unit/domain/domain-utils.test.ts`) currently assert `ws://localhost:8080` is valid and must be updated together, or the change will appear to pass while one of them fails.
- [Risk] Moving the cache to session storage means it is empty after every browser restart, which can look like a regression in profile load time. → Mitigation: the TTL is one hour, so the cache was already short-lived, and the first fetch after restart is bounded by the 5-second deadline.
- [Risk] A strict `ProfileMetadataSchema` will drop fields from future NIPs that the schema does not yet know about. → Mitigation: adding a field is a one-line schema change, and the alternative is storing attacker-chosen keys. Validation warnings should name the dropped keys so the gap is visible.
- [Risk] Making the upload destination empty by default will read as a broken button to anyone who used the previous hardcoded host. → Mitigation: the control is not shown as broken; it is replaced by copy explaining that no image host is configured and that a URL can be pasted, with a pointer to the setting.
- [Risk] The `settle()` refactor of `fetchProfileFromRelay` touches the code path every existing profile test exercises. → Mitigation: the existing suites in `tests/unit/application/services/profile.service.test.ts` cover cache hit, miss, expiry, force fetch, multi-event selection, invalid JSON, timeout, and LRU eviction; they run as the regression net for this refactor before new cases are added.

## Migration Plan

1. Land the domain schemas, the verifier, and the bounds first. They are pure additions with no behavioural effect until they are wired in.
2. Wire verification into `NostrRelayAdapter`. At this point forged and mismatched events stop reaching consumers.
3. Tighten `isValidRelayUrl`, add `RelayUrlSchema`, update `AppSettingsPatchSchema`, and update both duplicated domain util test files in the same commit. Add the settings migration that drops non-`wss:` relays and restores the default list when nothing valid remains.
4. Restructure `fetchProfileFromRelay` around a single `settle()`, close subscriptions on EOSE, and cap reconnection.
5. Move the cache to `browser.storage.session`, add the measured byte budget, and add the startup purge of the legacy `browser.storage.local` `profileCache` record. The purge is the data migration; there is nothing to preserve, because no existing entry was ever verified.
6. Tighten `ProfileMetadataSchema` to a bounded strict object with `https:`-only URLs.
7. Change the UI surfaces to stop loading relay-supplied images, and replace the hardcoded upload destination with the configured, empty-by-default one.
8. Rollback: each step is independently revertible. Reverting steps 1 and 2 restores the previous unverified behaviour without any data change. Reverting step 5 leaves a stale `browser.storage.session` record that expires by TTL and is discarded on browser restart. Reverting step 3 leaves stored settings holding only `wss:` relays, which the previous permissive validator also accepts.

## Open Questions

- Should the per-install partitioning salt be regenerated when the relay list changes, or held stable so a relay cannot learn a pubkey's assignment by observing a reconfiguration?
- Should relay settings expose a per-relay trust marker, so a user can mark one relay as the only one permitted to answer for a given identity, or is that scope for a later relay-policy change?
- When a relay is dropped for repeated verification failures, should that be surfaced in the activity log as a security event, or kept to console diagnostics until a relay-health surface exists?
- Should the upload destination be a free-form URL setting, or a short curated list of hosts the user picks from, given that a free-form value is itself an egress the user could get wrong?

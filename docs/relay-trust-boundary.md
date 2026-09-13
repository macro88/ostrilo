# Relay Trust Boundary And Remote Media Policy

How Ostrilo treats data that comes from a Nostr relay, and what it will and will
not fetch from a URL a remote party chose.

This document covers the behaviour that changed in `validate-relay-and-remote-data`.
For the normative requirements see
`openspec/specs/relay-trust-boundary/`, `openspec/specs/remote-media-policy/`
and `openspec/specs/profile-metadata/`.

## The premise

The background service worker holds the encrypted key vault and performs every
signing operation. It is also a WebSocket client of arbitrary relays. A relay is
an untrusted remote party: it chooses the bytes, it chooses the timing, and it
can lie about who signed what.

That matters beyond aesthetics. The key selector, the settings key list and the
profile surface are how a user confirms which identity is about to sign. A relay
that can rewrite the name and avatar shown for a pubkey can make the user sign
with the wrong key on purpose.

## What crosses the boundary

Every inbound frame passes through `NostrRelayAdapter`, cheapest check first, so
a flooding relay cannot buy expensive curve operations with cheap bytes:

1. **Size.** Frames over 131072 bytes are discarded before `JSON.parse` runs.
2. **Envelope.** The parsed value must match the NIP-01 relay-to-client schema:
   one of `EVENT`, `EOSE`, `OK`, `NOTICE`, `CLOSED`, `AUTH`, with any
   subscription ID matching `^[a-zA-Z0-9_-]{1,64}$`.
3. **Event shape.** `id` and `pubkey` are 64 lowercase hex characters, `sig` is
   128, `kind` is 0-65535, `created_at` is no more than 900 seconds ahead of the
   clock, `content` is at most 8192 bytes, and `tags` is at most 50 arrays of at
   most 10 elements of at most 1024 bytes.
4. **Subscription match.** `pubkey` must be in the filter's `authors` and `kind`
   in the filter's `kinds`, when those fields are present. A relay cannot answer
   a question about one author with data about another.
5. **Event ID.** Recomputed from the event's own fields and compared to `id`.
6. **Signature.** Verified with `verifyEventSignature` from
   `src/domain/utils/crypto.ts`.

Only then is `onEvent` called. That is the port's contract:
`INostrRelay.onEvent` is only ever invoked with a verified event matching the
subscription filter. `RelayManager` inherits it; `ProfileService` re-checks
author and kind anyway, so the application layer does not depend solely on the
adapter being right.

The bounds live in one place, `src/domain/relay/constants.ts`, so the whole
budget a relay can spend can be read at once.

## Transport: `wss://` only

`ws://` is refused, including for localhost. Four layers agree:

- `isValidRelayUrl` in `src/domain/utils/validation.ts` accepts `wss:` with a
  non-empty hostname and no embedded credentials, and nothing else.
- `RelayUrlSchema` and `RelayUrlListSchema` in `src/domain/relay/url.ts` refine
  through that validator and bound the list at 10 entries.
- `NostrRelayAdapter.connect` refuses to open a socket for anything else,
  reporting a relay configuration error.
- `RelayList` in Settings validates with the shared validator rather than a
  local `startsWith` check, so the message the user sees and the rule the
  extension enforces cannot drift apart.

Stored `ws://` relays from earlier versions are dropped: `sanitizeRelayUrls`
filters them out wherever a stored list is read, and `RelayManager` will not
construct an adapter for one.

There is deliberately no development exemption. There is no dev-relay workflow
in this repository, and an exemption would be a permanent hole for a temporary
convenience.

## Subscription lifecycle

- Subscriptions close on EOSE, on the accepted-event cap (20), and on the
  5-second fetch deadline. The adapter's registry drains rather than growing.
- `ProfileService.fetchProfileFromRelay` is built around one `settle()` behind a
  boolean guard. The deadline is armed **before** `subscribe` is called, so a
  subscribe that never resolves cannot hang the fetch, and a handler that throws
  settles the fetch instead of disappearing into the adapter's catch.
- Reconnection uses exponential backoff from 1s to 30s with up to 20 percent
  jitter, stops after 5 consecutive failures, and on giving up clears its
  subscriptions and signals EOSE so nothing is left waiting. A successful
  connection resets the counter.

## Profile cache

Relay-derived profile data lives in `browser.storage.session`, which holds no key
material. It is never written to `browser.storage.local`, which holds
`encryptedKeys` and the vault envelope. That removes an adjacency worth naming:
if relay-driven growth exhausted the local quota, `saveKeys` would reject, and a
rejected `saveKeys` inside `generateKey` propagates out while the `finally` block
zeroizes the freshly generated secret that was never persisted.

Before each write the cache is serialised and measured, then trimmed
oldest-first by `fetchedAt` until it fits 50 entries and 262144 bytes. A single
validated profile is bounded to 4096 bytes by shedding optional fields; `name`
is shed last, because telling identities apart is the point of caching a profile.

Cache writes are best effort. A failure - quota or otherwise - is caught and
logged, and the freshly fetched metadata is still returned to the caller.

The legacy `profileCache` record in `browser.storage.local` is deleted on first
use and nothing is migrated. No entry in it was ever signature-checked.

## Profile metadata validation

`ProfileMetadataSchema` is strict, not loose: a key the schema does not define is
dropped rather than stored. Adding a field when a NIP warrants it is a one-line
change; keeping arbitrary relay-chosen keys in a record the UI iterates over is a
standing liability.

URL fields (`picture`, `banner`, `website`) are retained only when the scheme is
`https:` and the value is at most 512 characters. `http:`, `data:`,
`javascript:`, `blob:` and `file:` are all dropped. The same allowlist applies to
values the user types: `profile.update` returns a field-level validation error
rather than silently discarding them.

`validateProfileMetadataDetailed` reports which fields were dropped, so a user
whose avatar is on a plain `http:` host can be told why it disappeared.

## Remote media: privileged pages fetch nothing

No extension page sets a relay-supplied URL as an image source. The popup, side
panel, options page and approval window all render the local seal avatar with the
profile initial, which `docs/design/DESIGN_RULES.md` already specifies as the
canonical avatar treatment.

A CSP `img-src` cannot fix this, because the problem is not the scheme but that
the host is attacker-selected: any policy permissive enough to show real avatars
is permissive enough to leak the user's IP address and a per-render visit signal
to a host a relay chose. Ostrilo has no server to proxy through.

The URL stays useful: it is rendered as monospace text with a copy affordance,
the same treatment npub values get, and opening the image is an explicit action
that opens an ordinary browser tab. `website` renders as a link with
`rel="noopener noreferrer"` in a new tab.

A consent-gated path that fetches the image in the background worker, downscales
it, and serves it as a bounded `data:` URI is recorded in the change's design and
deliberately not built here.

CSP `img-src 'self' data:` and the `connect-src` allowlist are declared in
`wxt.config.ts` by the companion change `harden-manifest-and-build`. This change
guarantees no rendering path needs a wider policy.

## Avatar upload destination

There is no hardcoded upload host. `ImageUploadField` takes an `uploadEndpoint`
that is undefined by default, so a fresh install makes no outbound request to
anyone but the configured relays. With none configured the upload control is not
shown and the UI explains that a URL can be pasted instead.

When an endpoint is configured it must be `https:`. The host is named on the
control and again in a confirmation before the image is sent. The URL the service
returns must pass the same `https:`-only allowlist before it enters profile
metadata, and the extension never fetches or renders it.

## Query partitioning

Routine profile hydration assigns each managed pubkey to exactly one configured
relay, using a stable mapping derived from the pubkey and a per-install random
salt held in extension storage. Filters carry exactly one entry in `authors` and
`limit: 1`. On failure a pubkey may be retried on one alternate relay, never on
all of them.

An explicit refresh - `profile.get` with `forceFetch: true` - may query every
configured relay, because that fetch concerns a single identity the user is
already looking at and adds no correlation beyond it.

**The honest limit:** with one configured relay, partitioning does nothing. That
relay necessarily sees every identity the extension queries, and relay settings
say so plainly rather than implying a protection that does not exist in that
configuration. Partitioning also costs coverage: a profile that exists only on an
unassigned relay will not be found during background hydration, and that identity
shows the fallback avatar and label until the user refreshes it explicitly.

## Where to look

| Concern | File |
|---|---|
| Bounds | `src/domain/relay/constants.ts` |
| Message and event schemas | `src/domain/relay/schemas.ts` |
| Verification | `src/domain/relay/verify.ts` |
| Relay URL rules | `src/domain/relay/url.ts`, `src/domain/utils/validation.ts` |
| Relay assignment | `src/domain/relay/partition.ts` |
| Transport gate | `src/infrastructure/relay/nostr-relay.adapter.ts` |
| Multi-relay behaviour | `src/infrastructure/relay/relay-manager.ts` |
| Fetch lifecycle and cache | `src/application/services/profile.service.ts` |
| Metadata validation | `src/domain/profile/types.ts` |

Tests: `tests/security/relay-event-forgery.test.ts`,
`tests/integration/relay-adapter-trust.test.ts`,
`tests/unit/domain/relay-trust-boundary.test.ts`,
`tests/unit/application/services/profile.service.trust.test.ts`,
`tests/unit/ui/features/profile/remote-media-policy.test.tsx`.

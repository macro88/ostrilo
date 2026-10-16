## Why

Ostrilo keeps one flat relay list per install (`settings.relays`) and uses it for everything. The rest of Nostr has moved to NIP-65: each identity publishes a kind 10002 relay list naming the relays it writes to and reads from, and clients look for a user's events on that user's write relays. Ostrilo neither reads nor publishes that list. Three problems follow:

- **Profile edits go to the wrong place.** `ProfileService.updateProfile` publishes kind 0 to the install's list (`src/application/services/profile.service.ts:196-202`), not to the relays the identity publishes from. A client following the outbox model may never see the change.
- **A key made in Ostrilo has no relay list at all.** We expect most Ostrilo users to be new to Nostr, so the key they create here is often their first. Without a relay list, the first client they open has to guess where to find them.
- **The default is one relay.** `DEFAULT_RELAY_URLS = ["wss://relay.primal.net"]` (`src/domain/types.ts:290`) is a single point of failure. It also disables the per-key lookup partitioning added by `validate-relay-and-remote-data`. That change's own design says so (`openspec/changes/archive/2026-09-17-validate-relay-and-remote-data/design.md:156`), and so does the Relays tab (`src/ui/features/settings/components/shared/RelayList.tsx:122`).

This is roadmap row PROTO-009 ("NIP-65 relay lists", Should, not started).

## What Changes

- **Three default relays.** `DEFAULT_RELAY_URLS` becomes `wss://relay.primal.net`, `wss://relay.damus.io` and `wss://nos.lol`. An install whose stored list is exactly the old single-relay default is moved to the new list, through the legacy-default mechanism `SettingsService` already has (`src/application/services/settings.service.ts:25-41`).
- **The settings list gets a narrower role.** It is now the *discovery relays*: where Ostrilo looks for relay lists and profiles, where routine profile lookups go, and the source of a new key's starter list. The stored field keeps its name (`relays`), so no settings migration is needed. The UI and docs name it for what it does.
- **Read a key's relay list.** Fetch the selected key's kind 10002 only when the user acts: opening the Relays tab, refreshing, or publishing. Parse it as untrusted input with explicit bounds, and cache it in session storage the way the profile cache is. Routine background lookups do not change: they stay on the discovery relays, split per key.
- **Show and edit it.** The Relays tab shows the selected key's relay list with read and write markers, lets the user edit it, and publishes it.
- **Publish without overwriting.** Kind 10002 is replaceable: whichever version is newest wins. So every publish starts from a fresh lookup across all discovery relays and the key's known write relays. It refuses when the list changed elsewhere since the edit began. It also refuses when a list was found but could not be read, so a list Ostrilo could not parse is never replaced blind. `created_at` always moves forward. The event goes to the new write relays, the old write relays and the discovery relays. The UI reports which relays accepted it, and the activity log records it.
- **Starter relay list.** When Ostrilo generates a key (full onboarding, Quick start, or Add Key), it signs and publishes a kind 10002 naming the discovery relays as read and write. A new key cannot already have a list, so this cannot overwrite anything. It does not block onboarding. It is attempted once: retrying later could overwrite a list another app has published since. If it fails, the Relays tab shows that the key has no list and offers to publish one. For an **imported** key, Ostrilo never publishes automatically. When no list is found, the Relays tab offers a starter list and says plainly that publishing replaces any list held on relays Ostrilo did not ask.
- **Profile publishes follow the relay list.** A kind 0 goes to the key's write relays plus the discovery relays. With no relay list, it goes to the discovery relays, as today.
- **Reach relays outside the settings list.** `RelayManager` can only reach the relays in settings today (`src/infrastructure/relay/relay-manager.ts:155-187`). It gains targeted subscribe and publish over an explicit URL set, using short-lived connections. Their number is bounded, and each is closed when its operation finishes. A loopback, private or link-local host taken from a relay list is never connected to, unless the user also added that address to the discovery relays.
- **Discard a stale cached list after a site signature.** When a website asks Ostrilo to sign a kind 10002 and Ostrilo signs it, the cached list for that key is dropped. Signing does not prove the site published the event, so the next read fetches it again.
- **New UI-only RPC namespace `relayList`:** `relayList.get`, `relayList.publish` and `relayList.publishStarter`.
- **Docs:** `PRIVACY.md` gains the new network uses: looking up relay lists, publishing them, and the automatic starter publish. Also updated: `docs/relay-trust-boundary.md`, `docs/developers_readme.md`, `docs/ostrilo-settings-permissions-v1.md`, and the PROTO-009 row in `docs/roadmap.md`.

**Product approval.** The starter publish is network activity the user does not click for. `docs/development-standards.md` requires explicit product approval for new background network behaviour. Accepting this proposal is that approval, and the change must not ship that behaviour without it.

**Not in this change:**

- Showing what a site's kind 10002 adds and removes on the approval screen (the SEC-008 remainder).
- Changing medium trust's automatic signing of kind 10002.
- NIP-07 `getRelays`.
- Reading other users' relay lists.
- Sending routine background profile lookups to write relays.
- NIP-42 relay auth.
- DM relay lists (kind 10050).
- Adding a dedicated indexer relay to the defaults.

## Capabilities

### New Capabilities

- `relay-list-metadata`: the three-relay default and its migration; parsing a kind 10002 under explicit bounds; the found / none / unreadable / unreachable outcome of a lookup; user-initiated lookup and the session cache; editing and publishing without overwriting; the starter list for generated keys, and the offer for imported keys; publish routing; bounded short-lived connections and refusing non-routable hosts; dropping the cache after a site-signed kind 10002; activity logging.

### Modified Capabilities

- `profile-metadata`:
  - "Profile Service": a kind 0 publish goes to the key's write relays plus the discovery relays.
  - "Relay Query Strategy": an explicit refresh of one identity may also ask that identity's write relays. Routine lookups are unchanged.
- `relay-trust-boundary`:
  - "Relay Input Is Untrusted" extends to the relay-list cache and the `relayList.*` RPC results.
  - "Relay Data Is Isolated From Key Material" extends to cached relay lists.
- `ui-options-page`: "Relays Tab" shows the selected key's relay list with read and write markers, publishing and the starter-list action, and the discovery relays as a separate section.
- `rpc-privilege-boundary`: "Page-Reachable RPC Namespaces Are Explicitly Limited" lists `relayList` among the UI-only namespaces.

## Impact

- **Domain:**
  - `src/domain/types.ts` (`DEFAULT_RELAY_URLS`)
  - New `src/domain/relay/relay-list.ts`: parsing, bounds, routing selection, non-routable host check
  - `src/domain/relay/constants.ts`: new bounds
- **Application:**
  - New `src/application/services/relay-list.service.ts`
  - `src/application/services/profile.service.ts`: publish routing, refresh routing
  - `src/application/services/settings.service.ts`: legacy default set
  - `src/application/ports/relay.ts`: targeted operations, per-relay publish results, lookup outcome
- **Infrastructure:**
  - `src/infrastructure/relay/relay-manager.ts`: short-lived connections
  - `src/infrastructure/relay/nostr-relay.adapter.ts`: report events that matched the filter but were rejected
  - New `relay-list-rpc.ts` handler
  - `vault-rpc.ts`: starter publish after `vault.generate`
  - `nostr-rpc.ts`: cache drop after a kind 10002 signature
  - `rpc-router.ts` and `rpc.ts`: namespace and types
  - `client.ts`: UI calls
- **Extension wiring:** `src/extension/background.ts`
- **UI:** `RelaysTab.tsx`, `RelayList.tsx`, and a new relay-list editor. Onboarding and Add Key copy that discloses the starter publish.
- **Storage:** a new session-storage relay-list cache (relay-derived, bounded, never in `storage.local`). Nothing new is written to `storage.local`.
- **Tests:** unit and security suites for parsing and bounds; integration tests for publish routing and the overwrite guards; e2e against the in-process fixture relay. The e2e fixtures and the design-review screenshot runner must point the discovery relays at the fixture relay **before** any key is created. Otherwise the starter publish would reach public relays from CI.
- **Manifest:** none. `connect-src wss:` already covers relay hosts the user did not type (`docs/extension-manifest.md:103-115`), and this change adds no permission.

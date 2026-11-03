## Context

Relays reach Ostrilo through one path today. `settings.relays` is a flat, device-local list, bounded at 10 and `wss://` only. `background.ts:266-282` feeds it into one shared `RelayManager`, and `ProfileService` uses that manager for two things: fetching kind 0 for managed keys, and publishing kind 0 edits. `RelayManager` can reach only the relays it was built with: `subscribeOn` answers with an empty EOSE for any other URL (`relay-manager.ts:162-168`). Kind 10002 appears in the code only as an event a website asks Ostrilo to sign. Medium trust signs it without asking (`trust-definitions.ts:59`).

Four existing commitments constrain this change:

- **Relay data is untrusted** (`relay-trust-boundary`). Every event is size-checked, schema-checked, matched against the filter and signature-verified before use, and relay-derived data never touches `storage.local`.
- **Routine lookups are split per key** (`validate-relay-and-remote-data`, Decision 7). Each managed pubkey is assigned to one relay by a salted hash. Only a user-initiated refresh of one identity may ask every relay.
- **No new background network behaviour without product approval** (`docs/development-standards.md`). The automatic starter publish is exactly that, and the proposal is where the approval is recorded.
- **`connect-src wss:`** (`docs/extension-manifest.md:103-115`). Any `wss:` host is reachable once the code asks for it. The manifest does not narrow which hosts. The code does.

Stakeholders: users new to Nostr who create their first key here (the starter list); users who bring a key from another client (the overwrite risk); the privacy posture in `PRIVACY.md`.

## Goals / Non-Goals

**Goals:**

- Three discovery relays by default, with installs on the old single-relay default moved over.
- Every key generated in Ostrilo gets a relay list at creation, so the first client a new user opens can find them.
- The user can see, edit and publish the selected key's relay list, with read and write markers.
- Profile and relay-list publishes reach the relays the identity actually uses.
- Ostrilo never replaces a relay list it did not read, or could not read.
- Background privacy stays as it is: no relay is contacted in the background that is not already contacted today, and the per-key split still holds.

**Non-Goals:**

- Approval-screen diff for a site's kind 10002, and any change to medium trust's automatic signing of 10002. Both are follow-ups (SEC-008, and a policy change that needs its own UX argument).
- NIP-07 `getRelays`. It stays deliberately absent (`SECURITY.md`).
- Reading other users' relay lists, or acting as an outbox-routing client for anything except the user's own kind 0 and kind 10002.
- Sending routine background lookups to write relays (see Decision 3).
- NIP-42 auth, kind 10050 DM relays, and adding a dedicated indexer relay to the defaults.

## Decisions

### Decision 1: Three discovery relays, migrated through the existing legacy-default set

`DEFAULT_RELAY_URLS` becomes `["wss://relay.primal.net", "wss://relay.damus.io", "wss://nos.lol"]`. `["wss://relay.primal.net"]` joins `LEGACY_DEFAULT_RELAY_SETS` (`settings.service.ts:25`), so an install still holding the old default exactly is rewritten on read. That is the same mechanism that moved users off the previous three legacy sets.

**Rationale:** Three relays let the per-key split do something, remove the single point of failure, and are the three general-purpose relays with the widest reach among the candidates considered. Five was considered and rejected. A background lookup asks the assigned relay plus at most one alternate, so with five relays it covers 2 of 5 rather than 2 of 3. That means fewer profiles found in the background. Every extra default is also another operator who sees the user's IP beside their pubkey on each publish. `relay.momostr.pink` ranks high by volume but is a Mastodon-to-Nostr bridge, and volume is not the test for a signer's default.

**Trade-off:** The migration cannot tell "never changed the default" from "chose Primal on purpose". Both hold the same list. Moving both is accepted: it was the shipped default, and removing two relays takes two clicks.

### Decision 2: Two lists with two roles, and no settings migration

- **Discovery relays:** the existing `settings.relays`, unchanged in storage. They answer "where do I look?": routine profile lookups, relay-list lookups, and the source of a starter list.
- **Relay list:** a key's kind 10002, which lives on the network. Ostrilo caches it in `storage.session` under `relayListCache`, keyed by pubkey, and never writes it into settings.

**Rationale:** The relay list is public, per identity, and authoritative on the network. Copying it into device-local settings would create a second source of truth that drifts the moment another client edits the list. Keeping the field name `relays` avoids a settings version bump and keeps a rollback harmless.

**Alternative considered:** Replace `settings.relays` with per-key lists. Rejected: a key with no list still needs somewhere to look, and that place is the discovery relays.

### Decision 3: Relay lists are fetched only on a user action, never during routine background lookups

`RelayListService.lookup(pubkey)` runs only for:

- the selected key when the Relays tab opens or the user refreshes it;
- a publish (profile or relay list) by the selected key;
- an explicit profile refresh.

Each of these concerns one identity the user is looking at, so the existing rule lets it ask every discovery relay, plus that key's write relays from the cache. Background profile hydration does not change: it still uses the discovery relays only, one assigned relay per key, with one alternate.

**Rationale:** This adds no background network traffic and keeps every guarantee of `Profile Query Partitioning Across Relays`. The outbox model pays off on writes, where the risk of sending to the wrong place is real. Background reads of the user's own kind 0 are already well served by the discovery relays.

**Alternative considered:** Route background hydration through each key's write relays. Rejected for now, for two reasons. First, keys bootstrapped from the same defaults share write relays, so salted assignment over each key's own list could send several of the user's identities to one relay. That weakens the current guarantee. Second, it would contact, without any click, relays the user never added to the discovery list. Revisit it with its own privacy argument if stale profiles become a reported problem.

### Decision 4: Parsing a kind 10002 is a pure domain function with explicit bounds

`parseRelayList(event)` in `src/domain/relay/relay-list.ts`:

- **What counts:** only `["r", url]` and `["r", url, "read" | "write"]` tags. No marker means read and write. `content` is ignored.
- **URL checks:** each URL must pass `isValidRelayUrl` and the 512-character bound, and is normalised before de-duplication (lower-case scheme and host, trailing slash removed). Duplicates merge their markers.
- **Dropped tags:** a tag with an unknown marker, an invalid URL, or extra elements is dropped and counted. The result carries `droppedCount`, so the UI can say that publishing will remove N unreadable entries.
- **Size bound:** at most `MAX_RELAY_LIST_ENTRIES` (20) accepted entries. More than that is treated as unreadable (Decision 5), because silently truncating and then republishing would delete the excess.
- **Non-routable entries:** each entry carries `routable: boolean` (Decision 8). Non-routable entries are kept, shown and republished. They are never connected to.

**Rationale:** The adapter already guarantees the event is genuine. What it cannot guarantee is that a list signed by the user is sensible: a medium-trust site can obtain that signature without a prompt. Parsing in the domain layer keeps it testable without sockets and puts every bound in one auditable place, as `RELAY_BOUNDS` already does.

### Decision 5: A lookup has four outcomes, and only two of them allow a publish

| Outcome | Meaning | Edit | Starter |
|---|---|---|---|
| `found` | At least one verified 10002 was accepted; the newest wins | yes, from this base | no |
| `none` | Every relay asked answered EOSE with no event, and nothing was discarded | no | yes, with confirmation |
| `unreadable` | A frame on the subscription was discarded (bounds, schema, signature), or a parsed list exceeded `MAX_RELAY_LIST_ENTRIES` | no | no |
| `unreachable` | Not every relay asked answered before the deadline, and none of those that did returned a list. A relay that never answered may hold one | no | no |

`none` and `unreadable` look identical today. The adapter logs a discarded event and moves on (`nostr-relay.adapter.ts:269-277`). This change adds a per-subscription discard count to the adapter and makes it visible to the subscriber, including frames that fail envelope validation when their subscription ID can still be read.

**Rationale:** This distinction is what makes a starter publish safe. A real list with 51 tags exceeds `MAX_EVENT_TAGS` and is discarded before signature verification. Without the signal it would read as `none`, and Ostrilo would offer to replace a real list with three relays. The cost is that a hostile relay can send a forged frame and force `unreadable`, which blocks publishing from Ostrilo for that key. That only denies a feature, it destroys nothing, and the UI says what happened.

### Decision 6: Every publish is guarded against overwriting

`RelayListService.publish(keyId, entries, baseEventId | null)`:

1. **Look up fresh** (Decision 3 fan-out). If the newest event's ID differs from `baseEventId`, answer with status `changed` and return the newer list. The editor reloads it and keeps the user's unpublished edits for them to re-apply. If the outcome is `unreadable` or `unreachable`, answer with status `blocked` and that outcome. These are statuses in a successful response, not RPC error codes: the namespace is UI-only, and adding canonical codes would cost the full error-code protocol for nothing a page can see.
2. **Sign:** `created_at = max(now, base.created_at + 1)`, so a skewed clock cannot produce an event that loses to the one it replaces.
3. **Publish** to the union of the new write relays, the old write relays and the discovery relays, de-duplicated, routable only, and bounded by `MAX_PUBLISH_RELAYS` (16). The old write relays are included so clients reading from them see the change.
4. **Report** per-relay accepted or failed results. Success means at least one relay accepted, as for profile publishes today. The UI shows "Published to N of M relays".
5. **Record:** update the cache from the published event and write an activity entry with origin `extension://relays` and kind 10002. `ActivityOriginsResponseSchema` already keeps internal origins out of the filter list (`schemas.ts:380-389`).

Before publishing, the editor enforces at least one write relay and at most `MAX_RELAY_LIST_ENTRIES` entries. Guidance text recommends two to four write relays, as NIP-65 does.

### Decision 7: A starter list is published automatically only for keys Ostrilo generated

After `vault.generate` succeeds, the handler calls `RelayListService.publishStarter(keyId)` and does not await it. The RPC response, and so onboarding, never waits on a relay. The starter list is the discovery relays at that moment, each as an `r` tag with no marker (read and write). On a fresh install those are the three defaults.

- It runs once. Failure is logged without the payload and not retried. A retry minutes or days later could land after the user has opened another client that published its own list, and it would overwrite that list. If the key cannot sign (the vault locked first), it is skipped.
- It skips the overwrite lookup, because a key generated microseconds ago has no list anywhere. That is also why this is the only automatic publish.
- **Imported keys:** never automatic. When the Relays tab's lookup returns `none`, it offers **Publish starter list**. The copy says that a list held on relays Ostrilo did not ask would be replaced. The action runs the full Decision 6 guard with `baseEventId = null`, so a list that appeared since is shown instead.
- **Disclosure:** the create-key step, Quick start and Add Key → Generate each carry one line saying that Ostrilo publishes a starter relay list for the new key to the discovery relays. `PRIVACY.md` describes it.

**Alternative considered:** Keep a `pending` record in `storage.local` and retry at the next unlock. Rejected because of the overwrite race above, and because it adds a stored record to explain in `PRIVACY.md`.

### Decision 8: Short-lived connections, bounded, and never to non-routable hosts taken from a relay list

`RelayManager` keeps its discovery adapters and gains two targeted operations. They become part of the port, replacing the duck-typed `PartitionableRelay` in `profile.service.ts:34-42` with an `IRelayRouter` interface extending `INostrRelay`:

- `subscribeOn(url, filter, onEvent, onEose)`: uses the discovery adapter for `url` if one exists, otherwise opens a short-lived adapter.
- `publishTo(urls, event): Promise<RelayPublishResult[]>`: the same, per URL.

Short-lived adapters are capped at `MAX_TRANSIENT_RELAYS` (16) open at once. Each is closed when its operation settles, and each inherits every existing bound: frame size, event cap, deadline, and bounded reconnect.

`isRoutableRelayHost(url)` (domain) refuses:

- `localhost` and `*.localhost`, `*.local` and `*.internal`;
- IPv4 literals in 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12 and 192.168/16;
- IPv6 `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped forms of the IPv4 ranges above.

The check applies to every URL taken from a relay list. It does **not** apply to a URL the user typed into the discovery relays. Those are user-chosen, which is also how the e2e fixture relay at `wss://localhost:<port>` stays usable.

**Rationale:** Medium trust signs kind 10002 silently, so a site can get a user-signed list naming `wss://192.168.1.1`. Without this check, Ostrilo's background worker would then open sockets on the user's LAN whenever it published. A relay list should never be the way a site directs the extension's network traffic.

**Residual:** A public DNS name that resolves to a private address passes. Extensions have no DNS API to check, and `PRIVACY.md` and `docs/relay-trust-boundary.md` will say so.

### Decision 9: Profile publishes and explicit refreshes follow the relay list

`ProfileService.updateProfile` looks up the selected key's list (Decision 3). It publishes to the routable write relays plus the discovery relays, bounded by `MAX_PUBLISH_RELAYS`, or to the discovery relays alone when the outcome is `none`. If the outcome is `unreachable`, it still publishes to the discovery relays. A kind 0 cannot destroy a relay list, so the overwrite guard does not apply. An explicit refresh (`getProfile(pubkey, true)`) asks the discovery relays plus that key's cached routable write relays.

### Decision 10: Drop the cached list when Ostrilo signs a site's kind 10002

When the `nostr` handler signs a kind 10002 for a site (prompted or automatic), it calls `RelayListService.invalidate(pubkey)`. The signed event is not written into the cache: signing is not publishing, and the site may never send it.

### Decision 11: The `relayList` namespace is UI-only

The namespace has three methods:

- `relayList.get { keyId, refresh? }` returns `{ outcome, entries, droppedCount, eventId, createdAt, discoveryRelays }`.
- `relayList.publish { keyId, entries, baseEventId }` returns `{ status: "published", results }`, `{ status: "changed", latest }` or `{ status: "blocked", outcome }`.
- `relayList.publishStarter { keyId }` returns the same.

Parameters are validated with zod at the handler, and entries go through the same domain checks as parsed lists. `rpc-privilege-boundary` names `relayList` explicitly, although its fail-closed default would already keep it UI-only.

### Decision 12: Relays tab layout

The tab follows `SettingsLayout`:

- **Header:** one-sentence lede.
- **"Relay list" section** for the selected key, with the key's label in the section label. One grouped `.ink-card`; each row has a mono URL, a read/write select (Read and write, Read only, Write only) and a remove control. Below the card: an add input with a ghost **Add**.
- **One notched primary:** **Publish relay list**, or **Publish starter list** when the outcome is `none`.
- **State:**
  - Unpublished edits show a quiet "Not published" line. Unlike the rest of Settings, this is not auto-saved: publishing is a public, permanent act.
  - `unreadable`, `unreachable` and `changed` use the amber warning panel, with what happened and what to do next.
  - A non-routable entry carries a muted "Not used by Ostrilo" note.
- **"Discovery relays" section:** the existing `RelayList`, its **Add Relay** demoted to ghost, and the existing per-key split disclosure line.

Judged against a populated vault in both themes, per `AGENTS.md`. The screenshot runner seeds a key with a found list, a key with `none`, and one non-routable entry.

## Risks / Trade-offs

- **[Risk] Ostrilo replaces a list held only on relays it did not ask.** → Mitigations:
  - Every publish except the generated-key starter runs a fan-out lookup over the discovery relays and the key's known write relays (Decisions 3 and 6).
  - A discarded frame blocks publishing (Decision 5).
  - Imported keys get an explicit warning and never an automatic publish (Decision 7).
  - The residual is a user whose only list lives entirely on relays outside both sets. They are told before they confirm.
- **[Risk] The automatic starter publish runs in CI or the screenshot runner and reaches public relays.** → Every e2e fixture and `docs/design-review/capture-screenshots.mjs` sets the discovery relays to the fixture relay **before** the first `vault.generate`. A test asserts the fixture relay received the starter 10002, which fails loudly if the order regresses. The runner's existing `wss://localhost:1` trick (`tests/e2e/fixtures/agent.ts:109-120`) moves earlier.
- **[Risk] More default relays means more operators see IP and pubkey on each publish.** → Three, not five (Decision 1). `PRIVACY.md` names them, and the user can edit them.
- **[Risk] A medium-trust site rewrites the list silently, and Ostrilo then publishes over it from a stale editor.** → The cache drop on sign (Decision 10) plus the fresh lookup on publish (Decision 6).
- **[Risk] The MV3 worker is evicted mid-starter-publish.** → The key reads `none` in the Relays tab, and the user publishes from there. The unlocked keepalive (PERF-008) makes eviction during an unlocked onboarding unlikely.
- **[Trade-off] Lists with more than 20 entries, or more than 50 tags, cannot be edited in Ostrilo.** → Shown as `unreadable`, with copy pointing to the app that manages it. Raising the bounds is cheap later. Lowering them after users rely on them is not.
- **[Trade-off] Background profile lookups still ignore the relay list** (Decision 3). A profile kept only on write relays outside the discovery set shows the fallback until refreshed. This is the same trade the per-key split already documents.
- **[Residual] DNS names that resolve to private addresses** pass the routable check (Decision 8).

## Migration Plan

1. **Ship.** `SettingsService.get()` rewrites an exact single-relay default to the three-relay list on first read. No settings version change and no vault change. The relay-list cache appears in `storage.session` on first lookup.
2. **Starter lists** apply only to keys generated after the update. Existing keys are untouched until the user opens the Relays tab.
3. **Rollback:** a reverted build reads `settings.relays` as an ordinary three-entry list and keeps working. It does not migrate back, which is harmless. The relay-list cache is ignored and cleared with the session. Kind 10002 events already published stay on relays: that is public data by Nostr's design and is irrevocable. The release notes must say this.

## Open Questions

1. **Should onboarding offer an opt-out for the starter publish?** This design ships without one. It is disclosed, and the list can be replaced later, but it cannot be unpublished. A privacy-focused user could reasonably want to skip it. This is a product call for the owner before implementation starts.
2. **Should a starter list or relay-list publish also go to an indexer relay** (for example `purplepag.es`) to improve discoverability? Deferred. It would be a fourth operator receiving every publish.
3. **Should the popup get a read-only view of the relay list,** or does it stay options-page only? This design assumes options-page only.

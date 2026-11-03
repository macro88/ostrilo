## 1. Before Any Code

- [ ] 1.1 Record the product owner's approval of the automatic starter publish (new network activity the user does not click for, per `docs/development-standards.md`) in `proposal.md`, with the date.
- [ ] 1.2 Resolve design Open Question 1 (onboarding opt-out for the starter publish). If an opt-out is chosen, add its requirement and scenario to `specs/relay-list-metadata/spec.md` and a task to group 8 before continuing.
- [ ] 1.3 Read `docs/relay-trust-boundary.md`, `docs/design/DESIGN_RULES.md` §7 and §10, and `openspec/specs/relay-trust-boundary/spec.md` in full.

## 2. Three Discovery Relays

This group is independent of the rest and may ship on its own.

- [ ] 2.1 Write failing tests in `tests/unit/application/services/settings.service.migration.test.ts`:
  - a stored `["wss://relay.primal.net"]` reads back as the three-relay default and is written back;
  - a customised list containing Primal plus another relay is untouched;
  - a list emptied by sanitisation restores the three-relay default.
- [ ] 2.2 Change `DEFAULT_RELAY_URLS` in `src/domain/types.ts` to `["wss://relay.primal.net", "wss://relay.damus.io", "wss://nos.lol"]`, and add `["wss://relay.primal.net"]` to `LEGACY_DEFAULT_RELAY_SETS` in `src/application/services/settings.service.ts`.
- [ ] 2.3 Update every test that asserts the old single default, including `settings.service.test.ts` and `settings.service.migration.test.ts`, and confirm 2.1 now passes.
- [ ] 2.4 Update the default named in `PRIVACY.md`, `docs/developers_readme.md:355` and `docs/ostrilo-settings-permissions-v1.md:190`.

## 3. Relay-List Domain

- [ ] 3.1 Add the bounds to `src/domain/relay/constants.ts`, each with a doc comment:
  - `MAX_RELAY_LIST_ENTRIES` (20)
  - `MAX_PUBLISH_RELAYS` (16)
  - `MAX_TRANSIENT_RELAYS` (16)
  - `RELAY_LIST_CACHE_TTL_SECONDS` (3600)
- [ ] 3.2 Write failing unit tests for `parseRelayList`, covering every scenario under "Relay List Parsing Is Bounded":
  - marker mapping, dropped-tag count and duplicate merge;
  - the 21-entry list reported as unreadable;
  - `content` ignored.
- [ ] 3.3 Implement `src/domain/relay/relay-list.ts`: `parseRelayList`, URL normalisation, `RelayListEntry { url, read, write, routable }`, and a builder that turns entries back into `r` tags (no marker for read and write).
- [ ] 3.4 Write failing unit tests for `isRoutableRelayHost`:
  - every refused range named in design Decision 8, including IPv4-mapped IPv6 forms and bracketed IPv6 literals;
  - public hosts allowed;
  - the discovery-relay exemption, applied by the caller, not inside the function.
- [ ] 3.5 Implement `isRoutableRelayHost` and `selectPublishRelays(newList, baseList, discovery)`. The latter takes the routable union, de-duplicates it and bounds it at `MAX_PUBLISH_RELAYS`.
- [ ] 3.6 Export the new module from `src/domain/relay/index.ts`.

## 4. Relay Infrastructure

- [ ] 4.1 Write a failing adapter test: on a `{ kinds: [10002], authors: [P] }` subscription, a frame carrying a 51-tag event is discarded and the subscriber can see a discard count of 1. Cover a frame that fails envelope validation but whose subscription ID is readable.
- [ ] 4.2 Add the per-subscription discard count to `NostrRelayAdapter` and expose it through the subscription callbacks. Change no existing rejection rule.
- [ ] 4.3 Add `IRelayRouter` to `src/application/ports/relay.ts`, extending `INostrRelay` with:
  - `getRelayUrls()`
  - `subscribeOn(url, …)`
  - `publishTo(urls, event): Promise<RelayPublishResult[]>`

  Remove the duck-typed `PartitionableRelay` from `profile.service.ts` and depend on the port instead.
- [ ] 4.4 Write failing `RelayManager` tests:
  - `subscribeOn` and `publishTo` reach a non-discovery URL through a short-lived adapter;
  - the short-lived adapter is disconnected after the operation settles;
  - no more than 16 are open at once when 20 URLs are targeted;
  - a discovery URL reuses the existing adapter;
  - a forged event on a short-lived adapter is discarded.
- [ ] 4.5 Implement short-lived adapters in `src/infrastructure/relay/relay-manager.ts`, and keep `close()` correct for composite subscription IDs that include them.

## 5. Relay-List Service

- [ ] 5.1 Write failing tests for `RelayListService.lookup`:
  - all four outcomes, with the scenarios in "Relay List Lookup Reports One Of Four Outcomes";
  - one author per filter;
  - fan-out over the discovery relays plus cached routable write relays;
  - the consumer re-check of author and kind.
- [ ] 5.2 Implement `src/application/services/relay-list.service.ts` lookup, with one `settle()` guard per subscription and the deadline armed before subscribe, following `ProfileService.fetchProfileFromRelay`.
- [ ] 5.3 Implement the session-storage cache `relayListCache`, mirroring the profile cache:
  - bounded at 50 entries and 262144 bytes;
  - 3600-second TTL;
  - best-effort writes;
  - `invalidate(pubkey)`.

  Add a test that nothing is written to `storage.local`.
- [ ] 5.4 Write failing tests for `publish`:
  - `changed` when the fresh lookup's newest event ID differs from the base;
  - `blocked` on `unreadable` and `unreachable`;
  - `created_at = max(now, base + 1)`;
  - refusal with no write relay;
  - routing to new ∪ old ∪ discovery;
  - non-routable entries kept in the event but never contacted;
  - per-relay results;
  - an activity entry with origin `extension://relays` and kind 10002.
- [ ] 5.5 Implement `publish`, signing through `KeyVaultService.signEvent(unsigned, keyId)`.
- [ ] 5.6 Write failing tests for `publishStarter(keyId, { generated })`:
  - a generated key signs and publishes the discovery relays with no markers, without a lookup;
  - a key that cannot sign is skipped;
  - a failure is logged without the payload and not retried;
  - a user-initiated starter for any key runs the full guard with `baseEventId = null`.
- [ ] 5.7 Implement `publishStarter`.

## 6. Profile Routing

- [ ] 6.1 Write failing tests for the modified "Profile Service" and "Relay Query Strategy" scenarios:
  - a publish goes to routable write relays plus discovery relays when `found`;
  - a publish goes to discovery relays alone otherwise;
  - an explicit refresh may include cached write relays;
  - background hydration contacts discovery relays only and never requests kind 10002.
- [ ] 6.2 Inject `RelayListService` into `ProfileService`, route `updateProfile` through `publishTo`, and extend the `forceFetch` path to the cached write relays.

## 7. RPC And Wiring

- [ ] 7.1 Add the `relayList.get`, `relayList.publish` and `relayList.publishStarter` types to `src/infrastructure/messaging/rpc.ts`. Add zod parameter schemas in `src/infrastructure/validation/schemas.ts`, reusing `RelayUrlSchema` and the domain entry checks.
- [ ] 7.2 Implement `src/infrastructure/messaging/handlers/relay-list-rpc.ts`. Publish refusals are `changed` or `blocked` statuses in an `ok` response. Invalid parameters use the existing `INVALID_PARAMS` code. Add no new error code.
- [ ] 7.3 Register the `relayList` namespace in `rpc-router.ts`. It stays out of `PAGE_REACHABLE_NAMESPACES` and out of `LOCKED_REACHABLE_METHODS`. Extend `tests/security/rpc-privilege-boundary.test.ts` with a tab-sender `relayList.publish` refusal, and confirm `tests/security/lock-gate.test.ts` passes with the new methods refused while locked.
- [ ] 7.4 In `vault-rpc.ts` `handleGenerate`, after a successful generate, start `publishStarter(id, { generated: true })` without awaiting it. Test that the response returns while every relay is unreachable.
- [ ] 7.5 In `nostr-rpc.ts`, after a successful kind 10002 signature for a site (prompted or automatic), call `relayList.invalidate(pubkey)`. Test both paths, and test that the signed event is not cached.
- [ ] 7.6 Wire `RelayListService` in `src/extension/background.ts` and add the UI calls to `src/infrastructure/messaging/client.ts`.

## 8. UI

- [ ] 8.1 Build the relay-list editor for the selected key per design Decision 12:
  - grouped `.ink-card` rows with a mono URL, a read/write select and remove;
  - a ghost add input;
  - a "Not published" indicator;
  - **Publish relay list** as the tab's single notched primary;
  - a per-relay result line after publish.
- [ ] 8.2 Add the states: looking up; `none` with **Publish starter list** as the primary and the replacement warning; `unreadable`, `unreachable` and `changed` in the amber warning panel with what happened and what to do next; non-routable entries marked "Not used by Ostrilo".
- [ ] 8.3 Rework `RelaysTab.tsx`: a one-sentence lede, the "Relay list" section for the selected key, and a "Discovery relays" section holding the existing `RelayList`, with its **Add Relay** demoted to ghost and the per-key split disclosure kept.
- [ ] 8.4 Add the starter-list disclosure line to the create-key step, `OnboardingQuickStart.tsx`, and Add Key's generate path.
- [ ] 8.5 Unit-test the editor and the tab states, including keyboard operation of the marker select and remove controls.

## 9. Keep Test Runs Off Public Relays

- [ ] 9.1 In `tests/e2e/fixtures/agent.ts` and every spec that creates a key, set `settings.relays` to the fixture relay or `wss://localhost:1` **before** the first `vault.generate`. Today it is set after (`agent.ts:105-121`).
- [ ] 9.2 Add an e2e spec using `tests/e2e/fixtures/fixture-relay.ts`:
  - creating a key publishes exactly one kind 10002, with the fixture relay as its only `r` tag;
  - importing a key publishes nothing;
  - editing and publishing from the Relays tab reaches the fixture relay;
  - a newer list served mid-edit produces the `changed` warning.
- [ ] 9.3 Update `docs/design-review/capture-screenshots.mjs`:
  - set dead or fixture discovery relays before onboarding creates the first key, and before the `Work` key is generated;
  - seed one key with a found list (including one non-routable entry) and one key with none;
  - make sure nothing leaves the machine when the Relays tab looks up a list. Served list entries use the `.invalid` TLD or the fixture relay, never a public host.

## 10. Docs

- [ ] 10.1 `PRIVACY.md`, "What is sent to Nostr relays":
  - looking up relay lists (when, and which relays);
  - publishing relay lists;
  - the automatic starter publish for generated keys;
  - the relay-list cache in the on-device table.
- [ ] 10.2 `docs/relay-trust-boundary.md`: relay-list parsing bounds, the four lookup outcomes, short-lived adapters, the non-routable host rule, and its DNS residual.
- [ ] 10.3 `docs/roadmap.md`: PROTO-009 status and notes; SEC-008's "relay-list changes" remainder unchanged and cross-referenced.
- [ ] 10.4 `CHANGELOG.md`: new defaults, relay-list support, the starter publish, and the rollback note that published relay lists cannot be recalled.

## 11. Verification

- [ ] 11.1 `pnpm run compile` and `pnpm run lint`.
- [ ] 11.2 `pnpm run test:coverage`, with the coverage thresholds met.
- [ ] 11.3 `pnpm run build` and `pnpm run build:firefox`.
- [ ] 11.4 `pnpm audit --audit-level high` (`docs/ci-verification.md`).
- [ ] 11.5 `pnpm run doctor`. Report the score and address findings in the changed files.
- [ ] 11.6 `pnpm run slop:changes`. Address findings in the changed files.
- [ ] 11.7 The Playwright e2e suite, including the new spec from 9.2.
- [ ] 11.8 Run `node docs/design-review/capture-screenshots.mjs`, then again with `OSTRILO_DESIGN_REVIEW_THEME=dark`. Judge the Relays tab and the onboarding disclosure on the populated captures in both themes, and record the review in `docs/design-review/README.md`.
- [ ] 11.9 Run `pnpm run agent:loop:prod` to watch a real key creation publish its starter list to the fixture relay.

## Context

The policy engine is not the problem. `evaluatePolicy` (`src/domain/policy/evaluate.ts`) already fails closed on a locked vault, honours an explicit `deny` first, forces protected kinds to `ask` before session grants and explicit allows, and falls back to `ask` for an unknown origin. `nostr.signEvent` overwrites the caller's `pubkey` with the selected key (`nostr-rpc.ts:139`) and recomputes the event id rather than signing a caller-supplied one (`nostr-rpc.ts:275`). It also re-checks `isProtectedKind` before signing an auto-allowed event (`nostr-rpc.ts:187-189`). This design keeps every one of those properties.

The defects sit on either side of that engine: in what gets written into the policy store, in what the protected/trusted sets contain, in what the RPC boundary lets through, and in what the UI tells the user.

Current state, verified in source:

- `PolicyService.setPerKindRule` (`policy.service.ts:112-137`) and `setOriginPolicy` (`:92-98`) both hardcode `trustLevel: "medium"` when creating a new origin record. `defaultForTrust` (`trust-definitions.ts:31-33`) auto-allows `DEFAULT_MEDIUM_ALLOW_KINDS = [6, 16, 7, 10002]` at medium trust. So a remembered `deny` on kind `1` creates an origin that silently signs reposts, generic reposts, reactions, and relay-list writes.
- `PROTECTED_KINDS = [1, 9734]`. `defaultForTrust` returns `allow` for every other kind at high trust, including `5` (deletion), `3` (contacts), `0` (profile), `22242` (relay auth), and `27235` (HTTP auth).
- `EventKindSchema` (`schemas.ts:114-117`) is `z.number().min(0).max(65535)` with no `.int()`; `isProtectedKind` is a `Set.has` test, so `1.0000001` is not protected.
- `ApprovalQueueService.enqueue` (`approval-queue.service.ts:87-105`) de-duplicates on `eventIdHash` alone and appends the second caller to `resolvers`. `computeEventId(pubkey, created_at, kind, tags, content)` has no origin input, so the key is origin-blind.
- `handleGetPublicKey` (`nostr-rpc.ts:60-85`) checks the lock state and returns the key. No origin, no policy, no prompt, no activity entry. `content.ts:75-77` builds `{ type: "nostr.getPublicKey" }` with no origin at all, while the `signEvent` branch at `:84-88` does include one. The content script matches `http://*/*` and `https://*/*`.
- `sessionTTLMinutes` defaults to `0` (`settings.service.ts` `defaultSettings`, and `DEFAULT_SETTINGS_V1` in `domain/types.ts`). `setSessionGrant` (`policy.service.ts:152-170`) stores `expiresAt = 0` for a zero TTL, and `PolicyService.evaluate` (`:48`) treats `grant === 0` as active forever. Grants are only cleared on lock (`key-vault.service.ts:359`).
- `OriginPolicyTable.tsx` reads `o.sessionGrantAll` from the persisted origin record. Nothing ever writes `true` there: `setSessionGrant` writes to session storage under `sessionGrants`, `PolicyService.evaluate` patches `sessionGrantAll` only in memory, and `key-vault.service.ts:367` only ever writes `false`. The switch is write-only. The same table shows `storedRule ?? "ask"`, so a kind allowed by a trust default is displayed as "Ask", and no control exposes trust level - `onUpdateTrust` is declared in the props type but neither destructured by the component nor passed by `PermissionsTab`.

Constraints:

- `add-trust-level-policy-system` shipped the evaluation order and the protected-kind guarantee. This design extends that set; it does not reorder or weaken it.
- `fix-remembered-site-signing-policies` shipped remembered `allow` for unprotected kinds and Settings quick controls that explicitly include profile (`0`), contacts (`3`), lists, relay list (`10002`), and application data (`30078`) as unprotected, allow-eligible kinds. This design must not turn those into protected kinds.
- The fail-open `getLockState` default (`key-vault.service.ts:378-381` returns `isLocked: !!state?.isLocked`, so a never-unlocked vault reads as unlocked) is owned by `implement-session-auto-lock`. This change owns the consent gate and the origin binding for `getPublicKey`; the two together are what stop a silent identity read.
- `npx react-doctor@latest` currently fails to install (`ERR_PNPM_TRUST_DOWNGRADE` on `semver@6.3.1`), so React Doctor is deferred to `restore-security-test-assurance`.

## Goals / Non-Goals

**Goals:**

- A remembered decision grants exactly what the user chose, and never more.
- No event kind is auto-signable unless it appears in an explicit allowlist for the origin's trust level, or the user wrote an explicit rule for it.
- A fractional or non-finite kind cannot slip past a kind-keyed control.
- One approval returns one signature to one origin.
- No page can read the user's Nostr identity without a recorded consent decision, and every disclosure is auditable.
- A grant-everything session has a finite, visible, revocable lifetime.
- The Settings permissions surface tells the truth about what will happen.

**Non-Goals:**

- No change to the evaluation order, the deny-first rule, or the locked-vault deny.
- No change to `signEvent`'s pubkey forcing or id recomputation.
- No fix for the fail-open `getLockState` default (`implement-session-auto-lock`).
- No cross-frame or injected-script trust-boundary work (`harden-provider-trust-boundary`).
- No NIP-04/NIP-44 encryption methods, no `getRelays`, no remote trust directory.
- No React Doctor run in this change (`restore-security-test-assurance`).

## Decisions

### Decision 1: Never derive a trust level from a remembered decision - write the untrusted level

`setPerKindRule` and `setOriginPolicy` SHALL create new origin records with `trustLevel: "low"` and only the rule the user asked for. `evaluatePolicy` SHALL additionally treat a missing or unrecognised `trustLevel` as `low`, so a hand-edited or legacy record cannot inherit a permissive default.

Three options were considered.

1. **Derive from the decision**: `allow` implies medium, `deny` implies low. Rejected. It still over-grants: a user who allows kind `10002` would be handed auto-signing for `6`, `16`, and `7` as a side effect. It also invents a second, undocumented trust-assignment rule alongside `defaultForTrust`, which is exactly the kind of scattered policy logic `add-trust-level-policy-system` centralised.
2. **Omit `trustLevel` entirely** so the untrusted default applies. Attractive, but `OriginPolicy.trustLevel` is a required field (`domain/types.ts:32`) and the Settings table renders `Trust: {o.trustLevel}` directly, which would display blank. It also pushes an optionality question into every consumer.
3. **Write `low` explicitly (chosen)**. `low` already means "ask for all event kinds" in the shipped trust design, so this is the untrusted default expressed in the existing vocabulary. It renders correctly, needs no type change, and it makes the invariant testable: after a remembered decision on a fresh origin, only the decided kind differs from `ask`.

The tolerant read in option 3's second sentence is defence in depth, not the primary mechanism.

### Decision 2: Protected kinds cover irreversible or credential-equivalent actions

`PROTECTED_KINDS` becomes `[1, 5, 9734, 22242, 27235]`. The selection rule is deliberately narrow and statable: **a kind is protected when signing it is irreversible, or when the signature functions as a credential outside the user's own Nostr content.**

| Kind | Name | Why protected |
| --- | --- | --- |
| `1` | Short Text Note | Publishes speech attributable to the user. Already protected; unchanged. |
| `5` | Event Deletion Request | Asks relays to destroy the user's existing posts. Irreversible, and a hostile page can erase a history it never created. |
| `9734` | Zap Request | Authorises a payment. Already protected; unchanged. |
| `22242` | Client Authentication (NIP-42) | A signed challenge is a relay session credential. Signing it authenticates as the user to an arbitrary relay, including one that then serves their private DM relay list. |
| `27235` | HTTP Auth (NIP-98) | The sharpest case: a signed bearer token for an arbitrary HTTP API, with an audience entirely outside Nostr. A silent signature here is a silent login. |

Kinds `0` (Profile Metadata), `3` (Contacts), and `4` (legacy DM) are **not** protected. They are dangerous, but two things follow from the constraint that `fix-remembered-site-signing-policies` shipped quick controls presenting `0` and `3` as unprotected, allow-eligible kinds: making them protected would contradict a shipped requirement, and it would remove a control users have already been given. Instead, Decision 3 removes them from every trust allowlist, so they can never be auto-signed by a trust level; the user must write an explicit per-kind `allow` for them. That preserves the shipped affordance while deleting the silent path.

The 30000-39999 parameterized-replaceable range is **not** blanket-protected. `30078` (Application Data) is a routine client write and a shipped quick-control kind; protecting the range would break normal clients and contradict shipped scenarios. Decision 3 handles the range structurally: anything not on an allowlist is `ask`, so an unrecognised 30000-range kind prompts rather than signs.

Alternative considered: protect on a computed risk score rather than an enumerated set. Rejected - unauditable, and the shipped design's value is that the protected set is a small immutable list a reviewer can read.

### Decision 3: The trust ladder becomes an allowlist, not a denylist

This is the structural fix. `defaultForTrust` currently answers "is this kind protected? no -> allow" at high trust. It will answer "is this kind on the allowlist for this trust level? no -> ask".

```
HIGH_TRUST_ALLOW_KINDS  = [6, 7, 16, 10000, 10001, 10002, 10003, 30078]
MEDIUM_TRUST_CEILING    = HIGH_TRUST_ALLOW_KINDS
DEFAULT_MEDIUM_ALLOW_KINDS = [6, 16, 7, 10002]        // unchanged
LOW_TRUST_ALLOW_KINDS   = []                           // ask for everything
```

Resolution becomes:

1. Non-integer kind -> `ask`.
2. Protected kind -> `ask`.
3. `low` -> `ask`.
4. `medium` -> `allow` if the kind is in `mediumAllowKinds` **and** in `MEDIUM_TRUST_CEILING`; otherwise `ask`.
5. `high` -> `allow` if the kind is in `HIGH_TRUST_ALLOW_KINDS`; otherwise `ask`.

The high-trust list is limited to low-consequence social signals (`6` repost, `16` generic repost, `7` reaction) and the user's own replaceable state that clients must maintain to function (`10000` mute list, `10001` pin list, `10002` relay list, `10003` bookmark list, `30078` application data). Everything else - profile metadata, contacts, DMs, long-form content, comments, and every kind the protocol has not registered yet - falls to `ask`.

Compatibility cost, stated plainly: **high trust stops meaning "sign anything"**. An origin at high trust that used to auto-sign, say, kind `30023` long-form drafts will now prompt once; the user can then create an explicit per-kind `allow`, which Decision 1 leaves intact as a first-class mechanism. Medium trust is unaffected because `DEFAULT_MEDIUM_ALLOW_KINDS` is already a subset of the new high list, so no existing medium-trust origin changes behaviour. The intersection in step 4 also closes a second hole: a polluted `mediumAllowKinds` can no longer grant a kind that high trust itself would refuse.

Alternative considered: keep high trust as "allow everything unprotected" and instead grow the protected list until it covers everything dangerous. Rejected. That is a denylist, so it is permanently one protocol revision behind: every new NIP ships as silently signable until Ostrilo notices. An allowlist fails safe by construction.

### Decision 4: Add `.int()` at the boundary and re-check integrality in the domain

`EventKindSchema` becomes `z.number().int().min(0).max(65535)`. `.int()` rejects `1.0000001`, `NaN`, and `Infinity` in one predicate.

The same class of gap exists elsewhere in `schemas.ts` and is fixed in the same pass:

| Schema field | Current | Fix |
| --- | --- | --- |
| `EventKindSchema` | `z.number().min(0).max(65535)` | add `.int()` |
| `AppSettingsPatchSchema.autoLockMinutes` | `z.number().min(0).max(1440)` | add `.int()` |
| `AppSettingsPatchSchema.sessionTTLMinutes` | `z.number().min(0).max(1440)` | add `.int()`, raise minimum to `1` (Decision 6) |
| `AppSettingsPatchSchema.mediumAllowKinds` element | `z.number().min(0).max(65535)` | replace with `EventKindSchema` |
| `AppSettingsPatchSchema.onboardingCompletedAt` | `z.number()` | add `.int().nonnegative()` |
| `OriginPolicyPatchSchema.updatedAt` | `z.number()` | add `.int().nonnegative()` |

Already correct and left alone: `UnsignedEventSchema.created_at` (`.int().positive()`), `maxActivityEntries`, and the activity `limit`/`offset` fields. The `rules` record key schema (`z.string().regex(/^\d+$/).transform(Number)`) is already integer-safe.

Schema validation is necessary but not sufficient, because `defaultForTrust` and `isProtectedKind` are domain functions callable from anywhere. Both gain a `Number.isInteger` guard that resolves to "not protected-safe" - that is, `defaultForTrust` returns `ask` and the allowlist lookup fails - so a non-integer that reaches the domain by any other path still cannot auto-sign. A unit test asserts `1.0000001` is refused at both layers.

### Decision 5: The de-duplication key is (origin, eventIdHash)

`ApprovalQueueService` keys `eventIdMap` by a composite of origin and event id hash rather than the hash alone. The composite is built by the service, not by callers, so no handler can forget the origin.

The correct behaviour when two origins genuinely request a byte-identical event is **two independent approvals**. Each origin gets its own queue entry, its own countdown, and its own resolution; the approval UI already groups by origin, so both appear correctly attributed. Approving `https://a.example` returns a signature only to `https://a.example`; `https://b.example` keeps waiting for its own decision or times out. The `resolvers` array stays, because it still serves its legitimate purpose: one page firing the same request twice - a double-clicked button, a re-render - collapses to a single prompt whose result fans out to both of that origin's pending promises.

The cost is one extra prompt in the rare honest case of two sites requesting an identical event. That is the right trade: the alternative is a hostile page that can predict a neighbouring site's event getting a free signature from a click the user believed applied to one site only. Origin attribution is the whole point of a consent prompt.

Alternative considered: keep the global key but check the origin at resolution time and reject mismatched resolvers. Rejected - it produces a confusing failure for the second origin and still displays only one origin in the UI, so the user cannot see what they are actually deciding.

### Decision 6: Session grants get a finite default lifetime, visible state, and a revoke path

- `sessionTTLMinutes` default changes from `0` to `15` in both `DEFAULT_SETTINGS_V1` (`domain/types.ts`) and `defaultSettings()` (`settings.service.ts`).
- `setSessionGrant` always computes a future `expiresAt`. A stored TTL of `0` is read as the default TTL rather than as "never expires".
- `PolicyService.evaluate` drops the `grant === 0` clause, so an expired or malformed grant is simply not active.
- The `sessionTTLMinutes` schema minimum becomes `1`, so no future settings write can reintroduce an unbounded grant.
- A new read-only RPC returns live grant state (origin, `expiresAt`) for the Settings surface, which stops reading the vestigial `sessionGrantAll` field on the persisted record.
- Revocation reuses the existing `policy.clearSession` path; the switch becomes a real two-way control.

Grants remain session-scoped and are still cleared on lock, which is the existing behaviour and is unchanged.

Alternative considered: keep `0` meaning "until lock" and only surface it in the UI. Rejected. "Until lock" is unbounded in practice - with auto-lock disabled or a long timeout it is effectively permanent, and it is the single broadest grant the product offers. A grant that allows every unprotected kind should be the one thing that expires soonest.

### Decision 7: `getPublicKey` becomes a consented, logged, origin-bound operation

Today, because the content script matches every http and https page and `handleGetPublicKey` asks no questions, **every site the user visits can read their npub, and so can every third-party ad, analytics, or session-replay script running on those sites**. An npub is a stable, globally correlatable identifier tied to a public social graph. This is a passive, silent, cross-site identity leak with no user-visible signal - the worst shape a privacy defect can take, because nothing in the product ever tells the user it happened.

The model:

1. **Origin binding.** `RpcRequest`'s `nostr.getPublicKey` variant gains an `origin: string`. `content.ts` populates it from `window.location.origin`, the same trusted source the `signEvent` branch already uses. The background validates it with `OriginSchema` before reading any key material.
2. **Consent storage.** `OriginPolicy` gains `identityDisclosure?: Authorisation`. Storing it on the existing per-origin record means one place to look, one place to revoke, and it appears in the Settings surface users already use for this origin. Rejected alternatives: a synthetic entry in `rules` keyed by a fake event kind - `rules` is typed by real Nostr kinds and a fake key would leak into every kind-iterating UI; and a separate top-level settings map - a second source of per-origin truth to keep in sync.
3. **Prompt.** Reuse `ApprovalQueueService`. `PendingRequest` gains a discriminator (`operation: "sign_event" | "get_public_key"`) with `event` present only for signing, and the approval UI renders a distinct detail view: which site, which key, what is disclosed. De-duplication for disclosure requests keys on origin plus operation, so a page calling `getPublicKey` three times during boot produces one prompt.
4. **Remembering.** The prompt's primary allow action remembers the grant, with an explicit one-time option alongside it. This is the reverse emphasis from signing prompts, and deliberately so: NIP-07 clients call `getPublicKey` on every page load, so a non-remembered grant would prompt on every navigation and train users to click through. This mirrors how browsers treat camera and location - decide once per site, revocable later.
5. **Audit.** Every outcome writes an activity entry. `ActivityLogEntry` gains `operation?: "sign_event" | "identity_disclosure"`, defaulting to `sign_event` for existing entries, rather than overloading the numeric `kind` field with a sentinel.
6. **Errors.** A denied disclosure returns `denied`; a timeout returns `timeout`; a locked vault still returns `locked` before any consent work, and records nothing.

Known limitation, documented not solved: the content script runs in the top frame, so consent is per page origin and a third-party script on a consented page inherits that page's grant. Per-frame origin binding belongs to `harden-provider-trust-boundary`.

### Decision 8: Settings shows the effective decision, computed by the engine

The permissions table stops rendering `rules[kind] ?? "ask"`. For each displayed origin and kind it renders the result of real policy evaluation - `mode` plus the `EvalReason` the engine already returns - so the four cases that used to be flattened into "Ask" become distinguishable: allowed by rule, allowed by trust, allowed by session grant, forced to ask because protected, or ask by fallback.

To avoid N round trips, a batch evaluation RPC accepts a list of origin/kind pairs and returns a list of `PolicyOutput`. Reusing `evaluatePolicy` rather than reimplementing the ladder in the UI is the point: a second implementation in React is exactly how a settings surface starts lying again.

The trust-level control is wired up rather than invented: `useAppSettings.updateOriginTrustLevel` and `OriginPolicyTable`'s `onUpdateTrust` prop both already exist and are simply unused. `PermissionsTab` passes the callback, the table renders a low/medium/high control with the effective consequence of each level, and downgrade takes effect on the next request. Trust level presentation states what the level actually permits now, so "high" no longer reads as "everything".

## Risks / Trade-offs

- [Risk] **Prompt fatigue.** Three protected kinds are added and high trust narrows, so some users see more prompts. -> Mitigation: the protected list stays small and rule-based; the high-trust allowlist deliberately includes the kinds clients write constantly (reactions, reposts, lists, app data); explicit per-kind `allow` remains available for everything unprotected, so any repeated prompt has a one-click permanent answer; and `add-trust-level-policy-system`'s copy pattern is reused to explain why a kind always asks.
- [Risk] **Dapps break when `getPublicKey` stops being free.** Clients that call it on load will see a rejection until the user consents. -> Mitigation: reject with `denied`, which NIP-07 clients must already handle because users can decline any request; remember the grant on first allow so the interruption is once per site; and prompt promptly rather than silently timing out.
- [Risk] **The identity prompt trains click-through.** A prompt on every site's first load is a prompt users learn to dismiss. -> Mitigation: name the site and state exactly what is disclosed; one prompt per origin, not per call; de-duplicate concurrent calls into a single prompt.
- [Risk] **Migrating unearned medium trust downgrades an origin a user genuinely wanted trusted.** -> Mitigation: no shipped UI path ever set a trust level (verified: `onUpdateTrust` is never passed and `updateOriginTrustLevel` is never called), so every stored `medium` was written by the service defaults, not chosen; explicit per-kind rules are preserved by the migration; and the newly wired trust control lets a user restore a level deliberately.
- [Risk] **The allowlist becomes stale as the protocol grows**, causing prompts for legitimately safe new kinds. -> Mitigation: this fails safe rather than open, which is the intended direction; adding a kind to the allowlist is a reviewable one-line change in `trust-definitions.ts`.
- [Risk] **Origin-scoped de-duplication increases queue size** under a page that varies its origin, and adds one prompt in the honest same-event case. -> Mitigation: existing per-request timeouts and origin grouping in the approval UI already bound and organise the queue.
- [Risk] **A 15-minute session TTL surprises users** who expected a grant to last until lock. -> Mitigation: show remaining time in Settings, make re-granting one click, and keep the TTL user-configurable within the schema bounds.
- [Risk] **The batch evaluation RPC could drift from single evaluation.** -> Mitigation: it delegates to the same `evaluatePolicy` call per pair; no second ladder is written.

## Migration Plan

Target: origin records in `settings.origins` written by the buggy `setPerKindRule`/`setOriginPolicy` paths, which carry `trustLevel: "medium"` that the user never chose.

1. Add a migration marker to the settings object (`__consentMigrations?: number`), read on background startup before the first policy evaluation. Absent or `< 1` means the migration has not run.
2. For every record in `settings.origins` with `trustLevel === "medium"`, set `trustLevel = "low"`. Because no shipped UI path can set a trust level, `medium` is unambiguously extension-assigned. Records already at `low` or `high` are untouched: `high` cannot have come from these code paths.
3. Preserve `rules`, `name`, and `updatedAt` on every record. The migration changes exactly one field.
4. Normalise `sessionTTLMinutes`: a stored `0` becomes the new default of `15`.
5. Leave stored `allow` rules for newly protected kinds (`5`, `22242`, `27235`) in place. Evaluation forces protected kinds to `ask`, so they are inert, and Decision 8 makes the Settings surface show them as always requiring approval rather than as active auto-allow - the same treatment `fix-remembered-site-signing-policies` chose for legacy protected allow rules.
6. Drop stale `sessionGrantAll: true` values from persisted origin records; live grant state is session storage only.
7. Set `__consentMigrations = 1` and write once. Re-running is a no-op, which the idempotency scenario asserts.
8. Rollback: reverting the code leaves migrated data valid, because `low` trust plus explicit rules is a legal state in the previous schema. Users would see more prompts than before the migration until they re-set trust levels, which is the safe direction to fail.

## Open Questions

- Should the identity-disclosure prompt offer a "this key only" scope for multi-key users, or is per-origin consent independent of key selection sufficient for this slice?
- Should `10002` (Relay List) stay in the default medium allowlist? It is the shipped default and a remembered-allow candidate, but a relay-list rewrite redirects where the user's future events are published.
- Should `4` (legacy DM) be demoted further than ask-by-default - for example refused entirely in favour of NIP-17 kinds `13`/`14`/`1059` - or is an explicit user allow rule the right level of control?
- Should the batch policy evaluation RPC be capped in list length to bound background work from the options page?

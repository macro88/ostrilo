## Context

`nostr.getPublicKey` is the only page-reachable method with no consent check, no origin, no rate limit and no audit entry. The message type carries no fields (`rpc.ts:70`) and the dispatcher drops the message entirely (`nostr-rpc.ts:60-61`), so the handler cannot know who asked even if it wanted to.

This has been specified before. `fix-consent-policy-defects` wrote a full `identity-disclosure-consent` delta and then marked every one of its Section 7 tasks skipped — six (7.1-7.5, 7.9) on file-ownership grounds and four (7.6-7.8, 7.10) on the deadlock ground quoted below — carrying the work to `harden-provider-trust-boundary`, which filed no disclosure task of its own and shipped without it. The recurring reason was stated plainly in that change's own tasks: *a gate with no prompt is either fail-open (no fix) or fail-closed with no way to grant consent (every dapp breaks)*. The two-phase split below exists to break that deadlock.

The honest scope of the problem, measured against the current branch rather than the one the earlier design was written for:

- The content script matches `https://*/*` only, with `all_frames` unset (`content.ts:50`), so plaintext pages and cross-origin iframes cannot reach the provider.
- `nostr.getPublicKey` is absent from `LOCKED_REACHABLE_METHODS` (`rpc-router.ts:103-118`), and the router refuses any method absent from that allowlist while locked (`:343-358`).
- The vault is forced locked on install and every browser start (`background.ts:473-482`) and auto-locks at a 1-60 minute bound defaulting to 5.
- `getLockState` now fails closed (`key-vault.service.ts:807-818`). The earlier design's premise that a never-unlocked vault leaks the key is out of date and must not be reused as justification.

What remains true: any https page loaded while the vault is unlocked, and any third-party script in that page's top-level realm, can read the npub silently and as often as it likes.

## Goals / Non-Goals

**Goals:**

- The user can see which origins have read their public key.
- An origin cannot sit in a polling loop harvesting the key. A per-origin rate limit bounds sampling frequency; it does not stop one successful call shortly after an unlock, which only the gate does.
- An origin that never asks to sign is gated, because nothing else will ever gate it.
- A consent decision shown in Settings is one the product actually enforces.
- A refused disclosure is distinguishable, to a client, from a refused signature.
- The approval pipeline carries a request with no event without breaking.

**Non-Goals:**

- Making the public key secret. It is published on relays, and this extension publishes it there (`profile.service.ts:176`) and discloses it to relays whenever it fetches a profile (`:368-372`, which subscribes with `authors: [pubkey]`). The claim is about linkage and awareness, not secrecy.
- Protecting origins the user signs for beyond their first approved signature. Every signature returns the pubkey (`nostr-rpc.ts:332-340`), and a remembered allow rule makes that silent thereafter (`approval-rpc.ts:132-141`).
- Per-script consent within a page. The content script is top-frame only, so a tracker `<script src>` in a consented page's realm inherits that page's grant. This is a known limitation, documented rather than solved.
- Changing the signing policy engine, the trust levels, or the protected-kind set.
- Preventing an origin from inferring that Ostrilo is installed. A refusal is distinguishable from an absent provider; that is a fingerprinting trade accepted in exchange for a working feature check, and it is the same trade already made by returning `locked`.

## Decisions

### 1. Two phases, because the deadlock is the reason this keeps not shipping

**Phase 1** — origin binding, activity logging, per-origin rate limiting, Settings visibility. No consent prompt, so every existing call at a normal rate still succeeds; the one behaviour change a dapp can see is `rate_limited` if it polls. This bounds the polling harm, which is the strongest concrete attack, and it gives the user the audit trail they have never had.

**Phase 2** — the consent gate, with its prompt and its migration.

Phase 1 is a strict prerequisite for Phase 2 (the gate needs the origin) and is independently valuable, so it ships first and is not held hostage to the prompt's UX. If Phase 2 is ever abandoned, Phase 1 still leaves the product better than it is now.

### 2. Rate limiting is Phase 1, not Phase 2

The polling attack does not need the gate to be closed. A tab calling `getPublicKey` in a loop captures the key the moment the vault unlocks, and the auto-lock timeout is no defence against it. The existing per-origin allowance machinery in `ApprovalQueueService` (`QUEUE_LIMITS`, `approval-queue.service.ts:41-49`) is the model, but disclosure rate limiting must not consume approval-queue capacity — a disclosure flood must not be able to displace a pending signature from another origin.

### 3. Origin comes from the content script, not from `sender.url`

`sender.url` is arguably more forgery-resistant, and the router already trusts it for the privilege check (`isTrustedExtensionSender`, `rpc-router.ts:86-89`). But it is not currently passed to handlers (`:309-312`), and threading it through would change the handler contract for every method.

The content script's `window.location.origin` is the same value `signEvent` already uses (`content.ts:106`), runs in an isolated world the page cannot write to, and keeps one origin-derivation path for both methods. It must **never** be read from `event.data` — the page controls that object.

Revisiting this in favour of `sender.url` is a reasonable future hardening, but it should be one change covering all methods, not a special case here.

### 4. A discriminator on `PendingRequest`, spelled once

The earlier change contradicts itself: its `design.md:152` says `operation: "sign_event" | "get_public_key"` on `PendingRequest`, while its own `tasks.md:65` says `operation?: "sign_event" | "identity_disclosure"` on `ActivityLogEntry`. Implementing both literally puts two different strings on either side of the audit boundary.

This change uses **`"identity_disclosure"`** on both, because it names the user-visible concept rather than the transport method, and because the activity log is read by people.

The field is required on `PendingRequest` (defaulting existing construction sites to `"sign_event"`) and optional on `ActivityLogEntry` (absent means `"sign_event"`, so stored history stays readable).

### 5. `approval.resolve` branches on the discriminator before touching `event`

`approval-rpc.ts:132-149` dereferences `request.event.kind` inside the `try` opened at `:119`. An eventless request throws there when the action is `allow` or `deny_remember`, returns `APPROVAL_FAILED` at `:165-171`, and leaves the entry queued until the 60-second auto-deny — so the user's click appears to do nothing. `allow_once` and plain `deny` short-circuit past both reads and resolve normally, which means the same request would succeed or hang depending on which button the user pressed.

Worse, `isProtectedKind` fails open on a non-integer (`trust-definitions.ts:81-86`), so a synthetic undefined kind takes the allow branch and writes a `rules[undefined]` key through `policy.service.ts:140`. The branch must come first, not be papered over with an optional chain.

### 6. Disclosure requests get their own dedupe key and their own capacity

`makeDedupeKey` is only built when an `eventIdHash` is supplied (`approval-queue.service.ts:236`), so a disclosure request would be undeduplicated — and `getQueuedEventIds` (`:429-434`) asserts `entry.eventIdHash!` and would emit `undefined` for a keyed-but-hashless entry.

Disclosure requests dedupe on `(origin, "identity_disclosure")`: one pending prompt per origin, which is the correct semantics anyway.

### 7. Remembered deny, and why it is not optional

Without it, any https origin can re-summon a focused OS popup on every page load (`background.ts:201-207`). A page-driven popup is not itself new — a `signEvent` request evaluating to `ask` already opens one, and the approval queue's per-origin caps bound it. What is new is the trigger: a disclosure prompt fires on a bare `getPublicKey`, which a page can issue on load without wanting anything. Without remembered deny that becomes a popup on every page load of any site, which is the abuse shape this codebase removed once when it deleted `openUnlockPrompt` (`content.ts:141-152` records why).

### 8. Signing and disclosure consent must agree, in both directions

This is the one decision the earlier design does not make, and it cannot be deferred.

- **A successful `signEvent` approval records disclosure consent for that origin.** The signature returns the pubkey (`nostr-rpc.ts:332-340`), so the origin has it regardless. Prompting separately would protect nothing and would teach click-through.
- **An explicit disclosure `deny` forces `signEvent` back to `ask`.** Otherwise a remembered per-kind allow silently returns the pubkey on every later signature while Settings displays "identity disclosure: deny" — the same class of defect as the write-only `sessionGrantAll` switch that the consent change exists to fix.

### 9. No grandfathering

No existing origin is granted disclosure consent by migration, including origins with an explicit `allow` rule or `high` trust.

The alternative — grandfathering origins with an explicit allow or `high` trust — is defensible: both mean the user approved a signature, and that signature already handed over the pubkey, so prompting protects nothing. It was considered and rejected in favour of strictness. The cost is stated rather than softened: **every origin the user already trusts will prompt once on next use.** For an active user with several dapps, that is several prompts in the first session after the update, which carries its own click-through risk.

Two consequences follow from this choice, and both are improvements:

- No `CONSENT_MIGRATION_VERSION` bump is needed for grandfathering. Bumping it would re-run the entire migration body — the medium-to-low downgrade and the `sessionGrantAll` deletion (`policy.service.ts:209-232`) — with a settings write and a broadcast, for every installed user including those with nothing to migrate.
- Decision 8's first half does the practical work instead: the first signature the user approves for an origin records disclosure consent, so a returning user converges on the same end state through the flow they were going to use anyway.

Phase 1 shipping first means the user can see, before Phase 2 lands, which origins have been reading their public key. That is not the same set as the origins that will prompt — under this decision every origin prompts on next use, including ones that never called during the Phase 1 window — but it is the set most likely to prompt soonest.

### 10. An error boundary around the approval window

There is none anywhere in the approval tree. `src/extension/approval/main.tsx:6-10` mounts `<ApprovalApp />` directly, and the only React error boundary in `src/` is `ModelFallbackBoundary` in `Logo.tsx:61-75`, which implements `getDerivedStateFromError` — there is no `componentDidCatch` anywhere in `src/`. A request that crashes `EventDetailView` (first `request.event` access at `:58`) or `QueueListView` (`:246`) blanks the entire window and removes the Deny control for every other queued request.

Introducing a request shape the view was not written for is exactly the moment to add one. The boundary must keep the deny path reachable — a user who cannot read a request must still be able to refuse it.

### 11. `ActivityPendingApprovals` is in scope

`src/ui/features/activity/components/ActivityPendingApprovals.tsx:86` and `:93` are a fourth `request.event` consumer, outside `src/ui/features/approval/**`, rendering in the popup and the side panel. A change scoped to the approval feature folder ships a second crash site in a surface the user sees more often than the approval window.

## Risks / Trade-offs

- **Every dapp sees a prompt on first use after Phase 2** → Accepted deliberately, per Decision 9. Phase 1's audit trail gives advance visibility, and Decision 8 converges returning users through the signing flow.
- **Three unlocked-vault `getPublicKey` call sites across two e2e tests would block for 60 seconds** — `vault-lock.spec.ts:99` and `:146` (both inside the single test opened at `:82`, calling `window.nostr.getPublicKey()` directly) and `agent-smoke.spec.ts:156` (via `window.testGetPublicKey` at `test-page.html:30`) → They must grant consent in setup before Phase 2 lands. A hang, not an assertion failure, is the failure mode, so it is easy to misread as flakiness.
- **The gate is defeated for any origin the user signs for** → Stated in Non-Goals and in the proposal's Why. The proposal must not be written from the signing case.
- **Per-script consent is not achievable** → Documented, not solved. A tracker in a consented page's realm inherits the grant.
- **`OriginPolicyPatchSchema` is a `z.strictObject`** (`schemas.ts:48-58`) → Adding `identityDisclosure` to the interface without the schema makes every patch carrying the field fail validation at runtime rather than be silently dropped. Same commit, or the feature is broken in a way that looks like a UI bug.
- **A disclosure flood could exhaust the approval queue** → Disclosure requests dedupe per origin and must not consume signing capacity; a spec scenario asserts this.
- **Adding a new remembering action may need a new `ApprovalActionSchema` value** (`schemas.ts:357-367`) → Decide whether the disclosure prompt's primary action remembers by default. The signing prompt does the opposite today (`EventDetailView.tsx:84-88` maps an unchecked remember to `allow_once`), and two approval screens in one window with opposite defaults for the same-looking button is a misread waiting to happen.
- **Four comments become false** → `tests/security/auto-lock.test.ts:21`, `tests/integration/cross-layer.test.ts:103`, `tests/e2e/vault-lock.spec.ts:11`, `key-vault.service.ts:797-798` all state that `getPublicKey` checks only the lock gate. Leaving them is how the next reader concludes the gate does not exist.
- **Two spec locations assert the old behaviour** → `openspec/specs/nip07-provider/spec.md:32-36` and the in-flight `harden-provider-trust-boundary/specs/nip07-provider/spec.md:42-46` repeat it verbatim. Both must be reconciled or the change contradicts an approved spec.
- **This capability already has a delta in another unarchived change** → `fix-consent-policy-defects/specs/identity-disclosure-consent/spec.md` describes requirements whose implementation tasks are all marked skipped. If that change archives first, `openspec/specs/` gains a spec the code does not satisfy. Reconcile at archive.

## Migration Plan

Phase 1 requires no migration: an added optional field on `ActivityLogEntry` and a new field on an RPC message.

Phase 2 adds `identityDisclosure?: Authorisation` to `OriginPolicy`. Absent means "no decision recorded", which is the prompting state — so no data migration runs and no `CONSENT_MIGRATION_VERSION` bump is required.

Rollback: reverting Phase 2 leaves `identityDisclosure` values in stored settings, which an older build ignores. Reverting Phase 1 leaves `operation` values in the activity log, which an older build ignores. Neither is load-bearing for any other feature.

## Open Questions

- Does the disclosure prompt's primary action remember by default? The earlier design says yes; the signing prompt's default is the opposite. A human should pick, because the two screens share a window.
- Should the rate limit be shared with, or independent of, the approval queue's per-origin allowance? Independent is safer (a disclosure flood cannot displace a signature) but is a second limiter to reason about.
- Should Phase 1 ship a Settings row showing "this origin has read your public key N times", or only the activity log? The row is more visible; the log is already built.
- Should `sender.url` replace content-script-derived origins across all methods as a later hardening? Out of scope here, but Decision 3 is the place a future change would start.

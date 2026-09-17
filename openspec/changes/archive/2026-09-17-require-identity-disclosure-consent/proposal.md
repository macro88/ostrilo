## Why

`nostr.getPublicKey` returns the user's public key with no consent check, no origin binding, no rate limit and no audit trail. `src/infrastructure/messaging/rpc.ts:70` is `| { type: "nostr.getPublicKey" }` — the message carries no fields at all — and `src/extension/content.ts:113` builds it without the origin it has already computed seven lines earlier at `:106` for the `signEvent` branch. The handler is dispatched as `this.handleGetPublicKey(context)` (`src/infrastructure/messaging/handlers/nostr-rpc.ts:60-61`) and never learns who asked.

**What this is not.** The npub is published on public relays; this extension publishes it there itself (`profile.service.ts:176`) and discloses it to relays whenever it fetches a profile (`:368-372` subscribes with `authors: [pubkey]`). It is not a secret, and nothing here makes it one. The harm is linkage: binding a stable, global, cross-application identifier to a browser session and a page visit, silently, without the user knowing it happened.

Nor is it true that "every site can read your npub". On this branch the content script matches `https://*/*` only with `all_frames` unset (`src/extension/content.ts:50`), the router refuses any method absent from its locked-reachable allowlist, which `nostr.getPublicKey` is (`rpc-router.ts:103-118`, `:343-358`), the vault is forced locked on install and every browser start (`background.ts:473-482`), and auto-lock defaults to five minutes. The true statement is narrower and still worth fixing: **any https page loaded while the vault is unlocked, and any third-party script running in that page's top-level realm, can read the npub silently and repeatedly.**

Two facts make the case concrete:

1. **Nothing rate-limits the call.** There is no throttle in the router and none in the handler (`nostr-rpc.ts:80-105`). A tab left open can poll in a loop and capture the npub milliseconds after the user unlocks. The five-minute auto-lock is not a mitigation against a persistent tab, and the only signal the user gets — the locked-request toolbar marker — dedupes itself to a single flip (`background.ts:114-122`).

2. **For some origins this is the only gate that will ever run.** An ad, analytics or session-replay script in a page's realm never calls `signEvent`, so the signing prompt is not a backstop for it. That is the category this change protects.

For any origin the user does sign for, the protection is bounded and the proposal says so: every successful signature returns the pubkey in the signed event (`nostr-rpc.ts:332-340`), and once a remembered per-kind allow rule exists (`approval-rpc.ts:132-141`), every later signature *of that kind* returns it with no prompt. The gate protects the window before the first approved signature, and it protects origins that never ask for one. It does not make the npub private from sites the user actively uses.

NIP-07 itself says nothing about consent for `getPublicKey` — it defines two mandatory methods (`getPublicKey`, `signEvent`) plus optional `getRelays`, `nip04.*` and `nip44.*`, and no permission model at all. The support for gating is ecosystem practice: nos2x lists `['getPublicKey', 'read your public key']` in its permission names, and Alby gates it per host.

This work has now been filed twice and deferred once. `fix-consent-policy-defects` specified it and marked its entire Section 7 as skipped — six tasks on file-ownership grounds and four because a gate without a prompt is either fail-open or breaks every dapp — nominating `harden-provider-trust-boundary` to carry it. That change never filed a single disclosure task and shipped without it. This change claims the files explicitly so it is not blocked a fourth time.

## What Changes

Delivered in two independently shippable phases within one change.

**Phase 1 — origin binding, audit and rate limiting.** No consent prompt yet; a dapp sees a change only if it polls.

- Add `origin: string` to the `nostr.getPublicKey` variant of `RpcRequest`, populate it in the content script from `window.location.origin`, and pass the message through to the handler. **Never** read it from `event.data`; the page controls that object.
- Validate the origin with `OriginSchema.safeParse` immediately after the lock check, matching the Phase 2 ordering below. Note `OriginSchema` accepts `http:` as well as `https:`; the https guarantee comes from the content-script match pattern, not from this check.
- Write an activity-log entry for every disclosure outcome, distinguishable from event-signing entries.
- Surface disclosure history per origin in Settings, so the user can see who has read their npub.
- Rate-limit `nostr.getPublicKey` per origin. This bounds the polling harm on its own, before any prompt exists — it caps how often an origin can sample, so a tab cannot sit in a tight loop. It does not stop the first call after an unlock from succeeding; only the Phase 2 gate does that.
- Correct four comments that currently state the call checks only the lock gate: `tests/security/auto-lock.test.ts:21`, `tests/integration/cross-layer.test.ts:103`, `tests/e2e/vault-lock.spec.ts:11`, `src/application/services/key-vault.service.ts:797-798`.

**Phase 2 — the consent gate.**

- Add `identityDisclosure?: Authorisation` to `OriginPolicy` **and to `OriginPolicyPatchSchema` in the same commit** — the schema is a `z.strictObject`, so adding the field to the interface alone makes every patch carrying it fail validation at runtime.
- Add an `operation` discriminator to `PendingRequest` so a disclosure request can queue without an unsigned event, and to `ActivityLogEntry`.
- Gate `handleGetPublicKey` on recorded consent: locked check first, then origin validation, then consent, then prompt on first use.
- **BREAKING** for dapps: an origin with no recorded decision is prompted, and the promise rejects if the user refuses. A refused disclosure returns its own error code, distinct from `denied`, so a client can tell a disclosure refusal from a signing refusal.
- Remember both allow and deny. Without remembered deny, any https origin can re-summon a focused OS popup on every page load. A page-driven popup is not new — a `signEvent` request evaluating to `ask` already opens one — but it is bounded today by the approval queue's per-origin caps and by the page needing to want a signature. A disclosure prompt with no remembered deny widens that to every page load of any site, which is the abuse shape this codebase removed once when it deleted `openUnlockPrompt`.
- Resolve the signEvent interaction in both directions: a successful `signEvent` approval records disclosure consent for that origin, because the signature has already handed over the pubkey; and an explicit disclosure `deny` forces `signEvent` back to `ask`. Without both halves, Settings displays a decision the product does not enforce.
- Add a disclosure detail view to the approval window, and an error boundary around it — there is none anywhere in the approval tree today.
- **No grandfathering.** No existing origin is auto-granted disclosure consent, including origins with an explicit allow rule or `high` trust. Every origin is prompted once on next use.

## Capabilities

### New Capabilities

- `identity-disclosure-consent`: Per-origin consent, rate limiting, audit and revocation for disclosing the user's public key to a web page. `fix-consent-policy-defects` carries an earlier delta for this same capability whose implementation tasks are all marked skipped; this change supersedes it and the two must be reconciled at archive time.

### Modified Capabilities

- `nip07-provider`: `Get Public Key` gains consent as a precondition. The current scenario "Successful retrieval when unlocked" asserts the promise resolves whenever the vault is unlocked, which this change makes false. The same *scenario* appears verbatim in the in-flight `harden-provider-trust-boundary` delta (`specs/nip07-provider/spec.md:42-46`), whose version of the requirement also adds two locked-state assertions; both must be reconciled.
- `rpc-error-codes`: a distinct error code for a refused identity disclosure.

## Impact

- `src/infrastructure/messaging/rpc.ts` — the `nostr.getPublicKey` union member.
- `src/extension/content.ts` — populate the origin at `:113`; handle the new error code at `:153-154`.
- `src/infrastructure/messaging/handlers/nostr-rpc.ts` — `handleGetPublicKey` rewritten; dispatch at `:60-61` must pass `message`.
- `src/domain/types.ts` — `OriginPolicy.identityDisclosure`, `PendingRequest.operation`, `ActivityLogEntry.operation`.
- `src/infrastructure/validation/schemas.ts` — `OriginPolicyPatchSchema`, and the approval action schema if a new remembering action is added.
- `src/infrastructure/messaging/handlers/approval-rpc.ts` — `:132-149` dereferences `request.event.kind` inside a `try`. An eventless request throws there when the action is `allow` or `deny_remember`, returns `APPROVAL_FAILED`, and leaves the entry queued until the 60-second auto-deny; `allow_once` and plain `deny` short-circuit past both reads and resolve normally, which is its own inconsistency. Must branch on the discriminator first. Note also that `isProtectedKind` fails open on a non-integer (`trust-definitions.ts:81-86`), so an undefined kind would take the allow branch and write a `rules[undefined]` key.
- `src/application/services/approval-queue.service.ts` — disclosure requests need their own dedupe key; `makeDedupeKey` is only built when an `eventIdHash` is supplied (`:236`), and `getQueuedEventIds` (`:429-434`) asserts `entry.eventIdHash!`.
- `src/application/services/policy.service.ts` — evaluate and persist the disclosure decision.
- `src/ui/features/approval/**` — a disclosure detail view, and an error boundary. `src/extension/approval/main.tsx:6-10` mounts `<ApprovalApp />` directly, and the only React error boundary in `src/` is `ModelFallbackBoundary` in `Logo.tsx:61-74`, which implements `getDerivedStateFromError` — there is no `componentDidCatch` anywhere in `src/`.
- `src/ui/features/activity/components/ActivityPendingApprovals.tsx:86,93` — a fourth `request.event` consumer, outside the approval feature folder, rendering in the popup and side panel. A change scoped to `src/ui/features/approval/**` ships a second crash site.
- `src/ui/features/settings/**` — disclosure state and revocation per origin.
- Tests: `tests/e2e/vault-lock.spec.ts:99` and `:146`, and `tests/e2e/agent-smoke.spec.ts:156` call `getPublicKey` with no user interaction and would block for `APPROVAL_TIMEOUT_MS = 60_000`. They must grant consent in setup before Phase 2 lands.
- Coordination: this change claims `rpc.ts`, `content.ts`, `domain/types.ts`, `schemas.ts`, `approval-rpc.ts`, `approval-queue.service.ts` and `src/ui/features/approval/**`.

## 1. Confirm The Current Behaviour Before Changing It

- [x] 1.1 Verify by hand that an https page can read the npub with no prompt while the vault is unlocked, and record the observation. `tests/e2e/fixtures/test-page.html:30` already exposes `window.testGetPublicKey`.
- [x] 1.2 Verify that nothing rate-limits the call: confirm no throttle exists in `src/infrastructure/messaging/rpc-router.ts` or in `handleGetPublicKey` (`nostr-rpc.ts:80-105`).
- [x] 1.3 Confirm the origin is genuinely unavailable to the handler today: `rpc.ts:70` has no fields, `content.ts:113` omits the origin it computed at `:106`, and `nostr-rpc.ts:60-61` drops the message.
- [x] 1.4 Write down the four places whose comments claim the call checks only the lock gate, so they are corrected rather than left to mislead: `tests/security/auto-lock.test.ts:21`, `tests/integration/cross-layer.test.ts:103`, `tests/e2e/vault-lock.spec.ts:11`, `src/application/services/key-vault.service.ts:797-798`.

## 2. Phase 1 — Origin Binding

- [x] 2.1 Add `origin: string` to the `nostr.getPublicKey` variant of `RpcRequest` in `src/infrastructure/messaging/rpc.ts:70`.
- [x] 2.2 Populate it in `src/extension/content.ts:113` from the `origin` already computed at `:106`. Never read it from `event.data` — the page controls that object.
- [x] 2.3 Pass `message` to the handler at `src/infrastructure/messaging/handlers/nostr-rpc.ts:60-61`, which currently calls `this.handleGetPublicKey(context)`.
- [x] 2.4 Validate the origin with `OriginSchema.safeParse` as the first step of the handler, matching `handleSignEvent` at `nostr-rpc.ts:128`. Return `invalid_origin` on a missing or malformed origin.
- [x] 2.5 Keep the handler's own locked check immediately after origin validation, so a locked vault still returns `locked` and never prompts. Note the router's lock gate already runs before any handler (`rpc-router.ts:343-358`), so in practice a locked vault never reaches this code at all; the in-handler check is defence in depth.
- [x] 2.6 Update the injected provider and content-script response path only if a new error code requires it; otherwise leave the bridge untouched.

## 3. Phase 1 — Audit

- [x] 3.1 Add `operation?: "sign_event" | "identity_disclosure"` to `ActivityLogEntry` in `src/domain/types.ts`. Absent means `sign_event`, so stored history stays readable.
- [x] 3.2 Write an activity-log entry for every `getPublicKey` outcome — allowed, refused, rate-limited — including auto-allowed reads once Phase 2 lands.
- [x] 3.3 Ensure the entry is distinguishable from a signing entry in the activity UI, not only in the stored record.
- [x] 3.4 Confirm no log entry contains the public key itself in a field intended for free text, and that the origin is recorded verbatim.
- [x] 3.5 Surface per-origin disclosure history in the permissions surface, so the user can see which origins have read their public key before any gate exists.

## 4. Phase 1 — Rate Limiting

- [x] 4.1 Add a per-origin rate limit to `nostr.getPublicKey`. Model it on `QUEUE_LIMITS` in `src/application/services/approval-queue.service.ts:41-49` but keep it independent of approval-queue capacity.
- [x] 4.2 Return `rate_limited` when the allowance is exhausted, and queue no approval request.
- [x] 4.3 Prove the limit is per origin: an exhausted origin must not affect a different origin.
- [x] 4.4 Prove the allowance recovers when the window elapses.
- [x] 4.5 Confirm a disclosure flood from one origin cannot displace a pending signing request from another origin.

## 5. Phase 1 — Verification And Ship Gate

- [x] 5.1 Confirm no dapp behaviour changed **except the new rate limit**: every existing `getPublicKey` call that succeeded before still succeeds at a normal call rate, and only a caller exceeding the per-origin allowance sees `rate_limited`. Section 4 deliberately introduces that one change; the ship gate must not assert it away.
- [x] 5.2 Run the full Vitest and Playwright suites and confirm no regression. Phase 1 must be green on its own before Phase 2 starts.
- [x] 5.3 Correct the four stale comments from task 1.4.
- [x] 5.4 Commit Phase 1 separately, so it is revertable without touching Phase 2.

## 6. Phase 2 — Domain Types And Schema

- [x] 6.1 Add `identityDisclosure?: Authorisation` to `OriginPolicy` in `src/domain/types.ts`.
- [x] 6.2 Add `identityDisclosure` to `OriginPolicyPatchSchema` in `src/infrastructure/validation/schemas.ts:48-58` **in the same commit**. It is a `z.strictObject`, so adding the interface field alone makes every patch carrying it fail validation at runtime rather than be silently dropped.
- [x] 6.3 Add a required `operation` discriminator to `PendingRequest`, defaulting existing construction sites to `"sign_event"`.
- [x] 6.4 Use the spelling `"identity_disclosure"` on both `PendingRequest` and `ActivityLogEntry`. The earlier documents disagree — `fix-consent-policy-defects/design.md:152` says `get_public_key` — and implementing both literally puts two different strings on either side of the audit boundary.
- [x] 6.5 Make `event` optional on `PendingRequest`, or model the discriminated union so an eventless request is representable without an optional field every consumer must guard.

## 7. Phase 2 — Consent Evaluation

- [x] 7.1 Rewrite `handleGetPublicKey` in this order, matching Phase 1: origin validation, locked check, rate limit, recorded consent, prompt on first use. Keep it identical to the order tasks 2.4 and 2.5 establish — the two phases must not specify opposite orderings for the same handler.
- [x] 7.2 Return the disclosure-specific error code on refusal, distinct from `denied`, and `timeout` on an expired prompt.
- [x] 7.3 Persist a remembered allow and a remembered deny through the approval resolve path.
- [x] 7.4 Add the disclosure-refused code to `RPC_ERROR_CODES`, its numeric mapping, and its standard message.
- [x] 7.5 Handle the new code in `src/extension/content.ts:153-154` and confirm it reaches the page unchanged through `src/extension/injected.ts:145-147`.

## 8. Phase 2 — Signing And Disclosure Must Agree

- [x] 8.1 Record identity-disclosure consent for an origin when the user approves a signing request from it. The signature already returns the pubkey (`nostr-rpc.ts:332-340`), so a separate prompt protects nothing and teaches click-through.
- [x] 8.2 Force `signEvent` back to `ask` for an origin with an explicit remembered disclosure deny, overriding any remembered per-kind allow rule written by `approval-rpc.ts:132-141`.
- [x] 8.3 Add a test proving Settings never displays a disclosure decision the product does not enforce: with disclosure denied, a remembered per-kind allow must not silently return the pubkey.

## 9. Phase 2 — Approval Pipeline Robustness

- [x] 9.1 Branch `approval-rpc.ts` on the `operation` discriminator **before** `:132-149` dereferences `request.event.kind`. An eventless request throws there today when the action is `allow` or `deny_remember` — `allow_once` and plain `deny` short-circuit past the dereference and resolve normally — returning `APPROVAL_FAILED` at `:165-171` and leaving the entry queued until the 60-second auto-deny.
- [x] 9.2 Confirm no per-kind rule is written for a disclosure approval, and specifically that no `rules[undefined]` key is created. `isProtectedKind` fails open on a non-integer (`trust-definitions.ts:81-86`) and `policy.service.ts:140` writes `(rules as any)[kind] = mode`.
- [x] 9.3 Give disclosure requests their own dedupe key of `(origin, "identity_disclosure")`. `makeDedupeKey` is only built when an `eventIdHash` is supplied (`approval-queue.service.ts:236`).
- [x] 9.4 Fix `getQueuedEventIds` (`approval-queue.service.ts:429-434`), which asserts `entry.eventIdHash!` and would emit `undefined` for a keyed-but-hashless entry.
- [x] 9.5 Confirm the queue's rate and capacity limits treat disclosure requests sensibly, and that one origin's repeated disclosure requests cannot exhaust the global cap.

## 10. Phase 2 — Approval And Settings UI

- [x] 10.1 Add a disclosure detail view naming the site, the key being disclosed, and what disclosure means. Follow `docs/design/DESIGN_RULES.md`: one notched primary CTA, mono for cryptographic data, amber for warnings, light and dark.
- [x] 10.2 State plainly in the prompt what consent does and does not do — the public key is already published on relays; this is about letting this site link the user's browsing to that identity.
- [x] 10.3 Decide and implement whether the primary action remembers by default. The signing prompt does the opposite today (`EventDetailView.tsx:84-88`); two approval screens in one window with opposite defaults for the same-looking button is a misread waiting to happen. Add a new `ApprovalActionSchema` value (`schemas.ts:357-362`) if required, remembering the parallel runtime union that must stay in step.
- [x] 10.4 Add an error boundary around the approval window. There is none in the tree — `src/extension/approval/main.tsx:6-10` mounts `<ApprovalApp />` directly, and the only error boundary in `src/` is `ModelFallbackBoundary` in `Logo.tsx:61-75`, which implements `getDerivedStateFromError` and no `componentDidCatch`. The boundary must keep the deny path reachable for other queued requests.
- [x] 10.5 Guard the fourth `request.event` consumer outside the approval folder: `src/ui/features/activity/components/ActivityPendingApprovals.tsx:86` and `:93`, which render in the popup and side panel.
- [x] 10.6 Add per-origin disclosure state and a revoke control to the permissions surface.
- [x] 10.7 Label nothing as migrated or grandfathered — there is no grandfathering.

## 11. Phase 2 — Migration Posture

- [x] 11.1 Confirm no origin is granted disclosure consent by migration, including origins with an explicit allow rule or `high` trust.
- [x] 11.2 Confirm no `CONSENT_MIGRATION_VERSION` bump is introduced. Bumping it re-runs the whole migration body (`policy.service.ts:209-232`) for every installed user, including those with nothing to migrate.
- [x] 11.3 Add a test proving an origin whose record was written by a remembered denial is prompted rather than treated as consenting.
- [x] 11.4 Add a release note stating plainly that every site will prompt once after this update, and why.

## 12. Tests

- [x] 12.1 Handler tests: missing origin, malformed origin, locked vault, first-use prompt, remembered allow, remembered deny, timeout, rate limited.
- [x] 12.2 A test proving a locked vault neither prompts nor persists a decision.
- [x] 12.3 A test proving the refusal error code differs from `denied`.
- [x] 12.4 A test proving the activity log records every outcome including auto-allowed reads.
- [x] 12.5 A test proving an eventless approval resolves without error and does not sit queued until timeout.
- [x] 12.6 A test proving the rate limit stops a polling origin, is per origin, and recovers.
- [x] 12.7 A test proving an approval that cannot render still leaves the other queued requests deniable.
- [x] 12.8 Update `tests/e2e/vault-lock.spec.ts:99` and `:146` and `tests/e2e/agent-smoke.spec.ts:156` to grant consent in setup. Without this they do not fail — they HANG for `APPROVAL_TIMEOUT_MS = 60_000` (`approval-queue.service.ts:18`), which reads as flakiness.
- [x] 12.9 Playwright coverage: an unconsented https page is prompted; approving returns the key; denying rejects with the disclosure code; a denied origin does not re-open the approval window on reload.
- [x] 12.10 Demonstrate each protection failing by reverting it, confirming a red test whose message names the security property, then restoring and verifying with `git diff` that the restore is byte-identical. Treat a revert that still passes as a weak test to investigate, not as evidence the protection is fine.

## 13. Spec And Documentation Reconciliation

- [x] 13.1 Reconcile `openspec/specs/nip07-provider/spec.md:32-36`, whose "Successful retrieval when unlocked" scenario this change makes false.
- [x] 13.2 Reconcile the same requirement repeated verbatim in `openspec/changes/harden-provider-trust-boundary/specs/nip07-provider/spec.md:42-46`.
- [x] 13.3 Record that `fix-consent-policy-defects/specs/identity-disclosure-consent/spec.md` is an earlier delta for this same capability whose implementation tasks are all marked skipped, and that if it archives first `openspec/specs/` gains a spec the code does not satisfy.
- [x] 13.4 Update `docs/v2-prd.md` with the shipped disclosure consent state, stating the bounded scope in full: the gate protects the window before the first approved signature, and origins that never sign — and it does NOT cover a third-party script running inside a consented page's realm, which inherits that page's grant because the content script is top-frame only (`content.ts:50`, `all_frames` unset). Say so; it is the residual most likely to be misread as covered.
- [x] 13.5 Add a NIP-07 provider section to `README.md` — there is none today and the file never mentions `window.nostr` — stating that `getPublicKey` requires consent. Add the disclosure-refused code to `docs/rpc-error-codes.md`.
- [x] 13.6 Add a CHANGELOG entry marking the **BREAKING** change for dapps.

## 14. Verification

- [x] 14.1 Run `openspec validate require-identity-disclosure-consent --strict`.
- [x] 14.2 Run `pnpm run compile`.
- [x] 14.3 Run `pnpm run lint`.
- [x] 14.4 Run `pnpm exec vitest run` and report exact pass/fail counts.
- [x] 14.5 Run `pnpm exec playwright test --project=chromium-extension` and report exact counts. A hang is the expected failure mode if task 12.8 was missed.
- [x] 14.6 Run `pnpm run build` and `pnpm run build:firefox`.
- [x] 14.7 Run `node_modules/.bin/react-doctor --scope changed --no-score` and address findings in changed files. Never invoke React Doctor via `npx`, `pnpm dlx`, or any `@latest` specifier.
- [x] 14.8 Run `pnpm audit --prod`.
- [x] 14.9 Manually confirm the original defect is gone: an unconsented https page cannot read the npub silently, and a consented one is not re-prompted.

# Implementation Tasks: Fix Consent Policy Defects

## Scope

Fix the six verified consent defects around the existing policy engine. Do not change the evaluation order, the deny-first rule, the locked-vault deny, or `signEvent`'s pubkey forcing and event-id recomputation. The fail-open `getLockState` default belongs to `implement-session-auto-lock`, injected-provider frame binding belongs to `harden-provider-trust-boundary`, and React Doctor re-enablement belongs to `restore-security-test-assurance`.

## 1. Validation Boundary

- [ ] 1.1 Add `.int()` to `EventKindSchema` in `src/infrastructure/validation/schemas.ts` so fractional, `NaN`, and `Infinity` kinds are rejected.
- [ ] 1.2 Audit every other numeric schema in the same file and add `.int()` where a discrete quantity is expected: `autoLockMinutes`, `sessionTTLMinutes`, `onboardingCompletedAt`, and `OriginPolicyPatchSchema.updatedAt`.
- [ ] 1.3 Replace the inline `mediumAllowKinds` element schema with `EventKindSchema` so kind validation has one definition.
- [ ] 1.4 Confirm `UnsignedEventSchema.created_at`, `maxActivityEntries`, and the activity `limit`/`offset` fields already enforce integrality, and record that no change is needed.
- [ ] 1.5 Add unit tests in `tests/unit/infrastructure/validation-schemas.test.ts` proving kind `1.0000001`, `NaN`, and `Infinity` fail validation and kind `1` still passes.

## 2. Domain Trust Definitions

- [ ] 2.1 Expand `PROTECTED_KINDS` in `src/domain/policy/trust-definitions.ts` to `[1, 5, 9734, 22242, 27235]` with a comment giving the per-kind rationale from the design.
- [ ] 2.2 Add `HIGH_TRUST_ALLOW_KINDS = [6, 7, 16, 10000, 10001, 10002, 10003, 30078]` and keep `DEFAULT_MEDIUM_ALLOW_KINDS` at `[6, 16, 7, 10002]`.
- [ ] 2.3 Rewrite `defaultForTrust` as an allowlist lookup: non-integer or protected kind returns `ask`; `low` returns `ask`; `medium` allows only kinds in both `mediumAllowKinds` and the high-trust allowlist; `high` allows only kinds in the high-trust allowlist.
- [ ] 2.4 Add a `Number.isInteger` guard to `isProtectedKind` and the allowlist helpers so a non-integer kind is never treated as allowlisted.
- [ ] 2.5 Keep `getEffectiveMediumAllowKinds` filtering protected kinds and extend it to intersect with the high-trust allowlist.

## 3. Policy Evaluation

- [ ] 3.1 Update `src/domain/policy/evaluate.ts` to consume the new helpers without changing the order: locked, explicit deny, protected, session grant, explicit allow/ask, trust default, fallback ask.
- [ ] 3.2 Treat a missing or unrecognised `trustLevel` on a stored record as `low` inside evaluation.
- [ ] 3.3 Add unit tests in `tests/unit/application/policy.evaluate.test.ts` for each new protected kind at high trust, at medium trust, with an explicit `allow` rule, and under an active session grant.
- [ ] 3.4 Add unit tests proving a kind outside the high-trust allowlist (`0`, `3`, `4`, `30023`, and an unregistered kind such as `31337`) returns `ask` at high trust.
- [ ] 3.5 Add unit tests proving an explicit user `allow` rule still auto-signs a non-allowlisted unprotected kind, and that explicit `deny` still wins for protected kinds.
- [ ] 3.6 Add regression tests asserting the preserved guarantees: locked returns `deny`/`locked`, unknown origin returns `ask`/`fallback`, protected beats session grant.

## 4. Policy Service Writes

- [ ] 4.1 Change `setPerKindRule` in `src/application/services/policy.service.ts` to create new origin records with `trustLevel: "low"` and only the requested rule.
- [ ] 4.2 Apply the same change to `setOriginPolicy` so no code path fabricates `medium` trust.
- [ ] 4.3 Confirm both methods leave an existing record's trust level untouched when adding or updating a rule.
- [ ] 4.4 Add policy service tests proving deny-and-remember on a fresh origin stores only the deny rule and leaves kinds `6`, `16`, `7`, and `10002` evaluating to `ask`.
- [ ] 4.5 Add policy service tests proving allow-and-remember stays scoped to the approved kind.

## 5. Session Grant Lifecycle

- [ ] 5.1 Change the default `sessionTTLMinutes` from `0` to `15` in `DEFAULT_SETTINGS_V1` (`src/domain/types.ts`) and `defaultSettings()` (`src/application/services/settings.service.ts`).
- [ ] 5.2 Raise the `sessionTTLMinutes` schema minimum to `1` so no settings write can create an unbounded grant.
- [ ] 5.3 Update `setSessionGrant` so a stored TTL of `0` uses the default TTL and every grant is written with a future absolute `expiresAt`.
- [ ] 5.4 Remove the `grant === 0` always-active clause from `PolicyService.evaluate`.
- [ ] 5.5 Add a read-only RPC that returns live session-grant state (origin and `expiresAt`) for the settings surface, with request validation and an `RpcRequest` union entry.
- [ ] 5.6 Add tests proving an expired grant does not allow, an active grant still allows unprotected kinds with reason `session`, and lock still clears grants.

## 6. Approval Queue Origin Binding

- [ ] 6.1 Change `ApprovalQueueService` in `src/application/services/approval-queue.service.ts` to key `eventIdMap` on a composite of origin and event id hash, built inside the service.
- [ ] 6.2 Keep the `resolvers` array so repeated identical requests from the same origin still collapse into one prompt.
- [ ] 6.3 Update resolution, timeout, `clear`, and `getQueuedEventIds` to use the composite key consistently.
- [ ] 6.4 Add approval queue tests proving two origins requesting a byte-identical event get two queue entries, and resolving one does not resolve the other.
- [ ] 6.5 Add an approval queue test proving one origin requesting the same event twice still yields one entry with two resolvers.

## 7. Identity Disclosure Consent

- [ ] 7.1 Add `origin: string` to the `nostr.getPublicKey` variant of `RpcRequest` in `src/infrastructure/messaging/rpc.ts`.
- [ ] 7.2 Populate that origin from `window.location.origin` in `src/extension/content.ts`, matching the existing `signEvent` branch.
- [ ] 7.3 Add `identityDisclosure?: Authorisation` to `OriginPolicy` in `src/domain/types.ts` and to `OriginPolicyPatchSchema`.
- [ ] 7.4 Add an `operation` discriminator to `PendingRequest` so a disclosure request can be queued without an unsigned event, and de-duplicate disclosure requests on origin plus operation.
- [ ] 7.5 Add `operation?: "sign_event" | "identity_disclosure"` to `ActivityLogEntry`, defaulting existing entries to `sign_event`.
- [ ] 7.6 Rewrite `handleGetPublicKey` in `src/infrastructure/messaging/handlers/nostr-rpc.ts` to validate the origin, keep the locked check first, evaluate recorded consent, queue an approval on first use, and return `denied` or `timeout` when consent is refused.
- [ ] 7.7 Write an activity-log entry for every disclosure outcome, including auto-allowed disclosures from a remembered grant.
- [ ] 7.8 Persist a remembered grant or deny through the approval resolve path, alongside the existing per-kind rule persistence in `approval-rpc.ts`.
- [ ] 7.9 Add an approval UI detail view for disclosure requests naming the site, the key, and what is disclosed, with a remembering primary allow action and an explicit one-time option, following `docs/design/DESIGN_RULES.md`.
- [ ] 7.10 Add RPC handler tests for missing origin, invalid origin, locked vault, first-use prompt, remembered allow, remembered deny, and the activity-log entry.

## 8. Settings Permissions Surface

- [ ] 8.1 Add a batch policy evaluation RPC that accepts origin/kind pairs and returns `PolicyOutput` per pair by delegating to `evaluatePolicy`.
- [ ] 8.2 Update `src/ui/features/settings/components/shared/OriginPolicyTable.tsx` to render the effective decision and its `EvalReason` source instead of `rules[kind] ?? "ask"`.
- [ ] 8.3 Render protected kinds as always requiring approval and keep a stored `allow` on a protected kind from appearing as active auto-allow.
- [ ] 8.4 Wire the existing `onUpdateTrust` prop and `useAppSettings.updateOriginTrustLevel` through `PermissionsTab`, and add a low/medium/high control that states what each level now permits.
- [ ] 8.5 Replace the write-only session-grant switch with live grant state from the new RPC, including remaining time and a working revoke.
- [ ] 8.6 Show identity-disclosure consent state per origin with a revoke control.
- [ ] 8.7 Add UI tests covering effective-decision rendering, protected-kind display, trust downgrade, live session-grant state, and identity-consent revocation.

## 9. Migration

- [ ] 9.1 Add a `__consentMigrations` marker to the stored settings object and run the migration on background startup before the first policy evaluation.
- [ ] 9.2 Downgrade every stored origin record with `trustLevel === "medium"` to `low`, preserving `rules`, `name`, and `updatedAt`.
- [ ] 9.3 Normalise a stored `sessionTTLMinutes` of `0` to the new default.
- [ ] 9.4 Drop stale `sessionGrantAll: true` values from persisted origin records.
- [ ] 9.5 Leave stored `allow` rules for newly protected kinds in place and verify evaluation renders them inert.
- [ ] 9.6 Add migration tests proving the downgrade, rule preservation, and idempotency on a second run.

## 10. Documentation

- [ ] 10.1 Add PRD requirements to `docs/v2-prd.md` for identity-disclosure consent and bounded session grants, and update the trust-level description to the allowlist model.
- [ ] 10.2 Document the new protected-kind set and the high-trust allowlist wherever trust levels are described for users.

## 11. Verification

- [ ] 11.1 Run `openspec validate fix-consent-policy-defects --strict`.
- [ ] 11.2 Run `pnpm run compile`.
- [ ] 11.3 Run the focused policy evaluation suite: `pnpm run test:unit -- policy.evaluate`.
- [ ] 11.4 Run the focused policy service and approval queue suites: `pnpm run test:unit -- policy.service` and `pnpm run test:unit -- approval-queue.service`.
- [ ] 11.5 Run the regression test proving deny-and-remember does not widen permissions, and confirm it fails against the pre-change `setPerKindRule`.
- [ ] 11.6 Run the validation schema and RPC handler suites: `pnpm run test:unit -- validation-schemas` and `pnpm run test:unit -- rpc-handlers`.
- [ ] 11.7 Run `pnpm run test:integration` for cross-layer policy and RPC validation coverage.
- [ ] 11.8 Run Playwright coverage for identity-disclosure consent, protected-kind policy, remembered site signing, approval queue de-duplication, and settings permissions: `pnpm run test:e2e`.
- [ ] 11.9 Run `pnpm run build` and `pnpm run build:firefox`.
- [ ] 11.10 Defer `npx react-doctor@latest`: it currently fails to install with `ERR_PNPM_TRUST_DOWNGRADE` on `semver@6.3.1`. Run it once `restore-security-test-assurance` pins React Doctor locally.

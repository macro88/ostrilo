# Proposal: Harden Trust Level Policy System

## Status

- **Created:** 2025-12-18
- **Status:** Ready for local hardening implementation
- **Author:** AI Assistant
- **Approver:** TBD

## 2026-06-12 Spec Finalization

This change is now scoped to a buildable local hardening slice. Ostrilo already has local trust levels, per-origin rules, session grants, and configurable Medium Trust auto-allow kinds. The active work is to make that existing policy system safer and more explicit before adding network-backed trust sources.

The official directory, global override, source badges, connection-popup trust preselection, and NIP-78 sync ideas are intentionally deferred. They require product and security decisions about official signing keys, relay privacy, source precedence, and user consent. They should return as separate proposals when those decisions are ready.

## Problem Statement

Ostrilo currently lets each origin carry a `TrustLevel` of `low`, `medium`, or `high`, plus explicit per-kind rules and optional session grants. That gives users useful control, but the policy boundary is too loose:

1. High Trust currently auto-allows every event kind.
2. Session grants can bypass prompts for sensitive kinds.
3. Medium Trust kind toggles can drift into unsafe values if settings are polluted or changed later.
4. The code does not centralize protected-kind policy, so security behavior is hard to audit.

The immediate risk is unexpected auto-signing of high-impact Nostr events, especially text notes and zap requests.

## Proposed Solution

Harden the existing local policy system with immutable protected kinds and centralized trust definitions.

```
Request to sign event
        |
        v
  vault unlocked?
        |
        v
 explicit deny?
        |
        v
 protected kind?  -> ask user
        |
        v
 session grant?
        |
        v
 explicit allow/ask?
        |
        v
 trust default?
        |
        v
 ask fallback
```

### V1 Decisions

- Protected kinds are kind `1` (Short Text Note) and kind `9734` (Zap Request).
- Protected kinds must never auto-sign through Trust Level, Medium Trust settings, explicit `allow`, or session grant.
- Explicit `deny` still wins before the protected-kind prompt and denies without asking.
- Low Trust asks for all event kinds.
- Medium Trust uses the existing `mediumAllowKinds` setting, but protected kinds are ignored even if present in stored settings.
- High Trust keeps the current product meaning of "maximum convenience" by auto-signing unprotected event kinds.
- No official trust directory, relay fetch, global trust override, or NIP-78 sync ships in this change.
- No migration is required; existing origin policies continue to work and gain the protected-kind guard.

## Goals

1. Prevent auto-signing of protected event kinds in every local policy path.
2. Keep existing local trust-level behavior where it is intentional.
3. Centralize trust constants and helper functions so future policy changes are auditable.
4. Preserve existing per-origin rules, session grant behavior, and settings persistence.
5. Add focused tests proving protected kinds cannot be auto-signed.

## Non-Goals

1. Not implementing an official Ostrilo trust directory.
2. Not fetching, caching, or verifying NIP-78 policy events.
3. Not adding global trust override settings.
4. Not adding official/user source badges.
5. Not adding connection-popup trust preselection.
6. Not implementing cross-device policy sync.
7. Not changing the broader approval prompt UX except for protected-kind copy where needed.

## Success Metrics

1. Kind `1` and kind `9734` always return `ask` unless explicitly denied or the vault is locked.
2. High Trust, Medium Trust, explicit `allow`, and session grants cannot auto-sign protected kinds.
3. Existing Medium Trust settings continue to work for unprotected kinds.
4. Unit and integration tests cover the evaluation order and protected-kind edge cases.
5. `openspec validate add-trust-level-policy-system --strict` passes.

## Dependencies

- Existing `PolicyService` and `evaluatePolicy` flow.
- Existing `AppSettingsV1.mediumAllowKinds` setting.
- Existing approval queue behavior for policy results with mode `ask`.
- Existing activity log for final allow/deny signing outcomes.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Existing users rely on explicit allow for kind 1 | Medium | Protected kinds are security-critical; keep explicit deny but force manual approval for allow/ask paths. |
| Stored `mediumAllowKinds` contains kind 1 | High | Filter protected kinds during evaluation and prevent UI from enabling them. |
| RPC path accidentally bypasses domain evaluation | High | Add a secondary sign-event guard that converts protected-kind auto-allow results back to `ask`. |
| Users do not understand why High Trust still prompts | Low | Add concise UI copy that notes Text Notes and Zap Requests always require approval. |

## Future Proposals

The following concepts are valuable but intentionally out of this buildable change:

- Official Ostrilo trust directory signed by a dedicated policy key.
- Relay fetch/cache strategy for official policy events.
- Source tracking such as `user`, `official`, and `global`.
- Global Trust Override with a decision about whether global High is allowed.
- Connection-popup official trust badges.
- NIP-78 sync of user trust assignments.
- Policy-specific activity log entry types beyond existing signing allow/deny entries.

## References

- Existing policy evaluation: `src/domain/policy/evaluate.ts`
- Existing policy service: `src/application/services/policy.service.ts`
- Existing settings defaults: `src/application/services/settings.service.ts`
- Existing Medium Trust UI: `src/ui/features/settings/components/shared/MediumKindToggles.tsx`

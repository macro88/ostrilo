## Context

Ostrilo already has the building blocks for per-site signing policies:

- `PolicyService.setPerKindRule(origin, kind, mode)` persists per-origin rules in `settings.origins`.
- `evaluatePolicy` applies explicit allow rules for unprotected kinds before trust defaults.
- The approval UI can send `allow`, `allow_once`, `deny`, and `deny_remember`.
- `ApprovalRpcHandler` currently persists `deny_remember` but does not persist `allow`.

That creates a product gap. A user can approve a repeated request from a trusted client and believe the choice was remembered, but the stored policy never changes. The next matching request prompts again, and Settings do not explain what was remembered.

The recent protected-kind hardening is a constraint for this change: Short Text Notes (`1`) and Zap Requests (`9734`) must still require approval before signing, even if an allow rule is requested or stored.

## Goals / Non-Goals

**Goals:**

- Make remembered allow decisions durable for unprotected event kinds.
- Make the remembered scope clear: one origin, one event kind, future matching requests.
- Ensure remembered rules are visible in Settings without forcing a manual reload.
- Keep protected kinds from being remembered as auto-allow.
- Preserve existing explicit deny behavior, including remembered deny where it already works.
- Cover the real user loop with E2E tests.

**Non-Goals:**

- No official trust directory.
- No global trust override.
- No NIP-78 policy sync.
- No remote policy source, relay fetch, or official badge.
- No bulk policy import/export.
- No risk-scoring engine or NIP-specific semantic preview beyond labels/copy needed for this workflow.

## Decisions

### Decision 1: Use existing approval actions

Keep the existing action names:

- `allow_once`: sign this request only.
- `allow`: sign this request and remember an `allow` rule for this origin and event kind, when the kind is eligible.
- `deny`: reject this request only.
- `deny_remember`: reject this request and remember a `deny` rule for this origin and event kind.

**Rationale:** The domain type already distinguishes `allow` from `allow_once`, and the UI already maps the remember checkbox to `allow`. The bug is that the backend does not honor that contract.

**Alternative considered:** Add a new action such as `allow_remember`. That would be clearer at the transport boundary, but it creates a migration across validation, queue, client helpers, tests, and UI while the existing vocabulary already has the needed distinction.

### Decision 2: Persist remembered allow in `approval.resolve`

`ApprovalRpcHandler.handleResolve` should persist a per-kind `allow` rule when:

- the request exists,
- the action is `allow`,
- the event kind is not protected.

The policy update should happen before queue resolution, matching the existing `deny_remember` flow. If the policy update fails, the request should not be resolved as successfully approved because the user asked for a durable decision.

**Rationale:** The approval handler has the pending request with origin and event kind, has access to the policy service, and already owns remembered deny persistence. Keeping remembered allow here makes the policy update atomic with the user action.

**Alternative considered:** Let the UI call `policy.setKindRule` separately before resolving approval. That would duplicate policy-write logic in UI, increase race conditions, and bypass the existing handler validation boundary.

### Decision 3: Protected kinds cannot create allow rules from approval

The approval UI must not offer remembered allow for protected kinds. The RPC handler should also defensively ignore or reject attempts to persist `allow` for protected kinds.

Recommended behavior:

- For protected kinds, approval remains one-time only.
- The UI copy should explain that this event kind always needs approval before signing.
- Explicit deny rules may still be remembered or configured, because protected-kind hardening already allows explicit deny to win before approval.

**Rationale:** This preserves the safety guarantee from `add-trust-level-policy-system`: no trust default, session grant, explicit allow rule, or remembered approval can auto-sign protected kinds.

**Alternative considered:** Allow protected kinds to remember allow but have evaluation convert that to ask. That preserves safety but creates confusing settings: users would see an allow rule that never allows.

### Decision 4: Settings is the source of truth for durable policies

After remembered allow or deny, Settings should display the origin and rule through the existing `settings.origins` model. If Settings is already open, it should update through the existing settings changed broadcast.

**Rationale:** Users need proof that their decision was saved. A remembered policy that is invisible in Settings is indistinguishable from a transient approval.

**Alternative considered:** Show remembered rules only in Activity. Activity is useful history, but it is not the management surface for permissions.

### Decision 5: Expand common event-kind affordances

Settings quick policy controls and labels should cover common client-generated policy kinds, including:

- `0` Profile Metadata
- `3` Contacts
- `6` Repost
- `7` Reaction
- `10000` Mute List
- `10001` Pin List
- `10002` Relay List
- `30078` Application Data

Protected kind labels should remain visible but not offer auto-allow affordances.

**Rationale:** The user problem comes from real clients requesting profile, settings, relay, list, and app-data events. A policy UI that only exposes a tiny set of quick rules does not help users understand or manage the decisions they are making.

**Alternative considered:** Add a freeform kind input only. Freeform input is still useful, but common kinds should be legible and one-click because these are the repeated requests users are likely to see.

## Risks / Trade-offs

- [Risk] Users may remember allow for an event kind that includes both safe and sensitive payloads. -> Mitigation: keep protected kinds excluded, make scope copy explicit, and include event kind plus payload in the approval before persistence.
- [Risk] An origin could change behavior after gaining allow for a broad unprotected kind. -> Mitigation: Settings must make rules visible and reversible, and this change should not add global or cross-origin allow.
- [Risk] Existing tests may assume `allow` and `allow_once` behave the same. -> Mitigation: update tests to reflect the sharper contract and keep `allow_once` available for one-time approvals.
- [Risk] Stored legacy protected allow rules may already exist. -> Mitigation: policy evaluation continues to force protected kinds to approval, and Settings/UI should avoid presenting protected allow as an active auto-allow.

## Migration Plan

1. No data migration is required for normal users.
2. Existing per-kind allow and deny rules remain valid.
3. Existing protected allow rules, if any, remain harmless because protected-kind evaluation forces approval.
4. Rollback is straightforward: remove the new `allow` persistence path. Existing saved allow rules can remain because they use the current policy schema.

## Open Questions

- Should the Settings UI include a full event-kind picker in this slice, or only expand the quick-rule set?
- Should remembered policy creation add a distinct activity-log entry, or should activity remain focused on final signing allow/deny outcomes until the future policy-specific activity-log proposal?

# Implementation Tasks: Harden Trust Level Policy System

## Scope

Build only the local hardening slice described in this change. Do not implement official directory fetching, NIP-78 policy events, global trust override, source badges, or connection-popup trust preselection in this pass.

## Phase 1: Domain Policy Hardening

- [ ] **1.1** Add centralized trust definitions
  - Create `src/domain/policy/trust-definitions.ts`.
  - Export `PROTECTED_KINDS` as `[1, 9734]`.
  - Export `DEFAULT_MEDIUM_ALLOW_KINDS` matching current defaults `[6, 16, 7, 10002]`.
  - Export helpers for `isProtectedKind`, filtering Medium Trust kinds, and resolving trust defaults.
  - **Validation:** TypeScript compile passes and helpers are used by policy evaluation.

- [ ] **1.2** Update policy output reason types
  - Add `protected` to `EvalReason`.
  - Keep existing reasons used by current tests and RPC behavior.
  - **Validation:** TypeScript compile passes without type casts for protected results.

- [ ] **1.3** Harden `evaluatePolicy`
  - Apply evaluation order: locked -> explicit deny -> protected kind -> session grant -> explicit allow/ask -> trust default -> fallback.
  - Preserve explicit deny behavior for protected kinds.
  - Force protected kinds to `ask` before session grants and explicit allow rules.
  - Use filtered Medium Trust kinds so stored protected kinds cannot auto-allow.
  - Keep High Trust allowing unprotected kinds.
  - **Validation:** Unit tests prove each branch.

- [ ] **1.4** Align settings defaults with centralized constants
  - Replace duplicated `[6, 16, 7, 10002]` fallbacks with `DEFAULT_MEDIUM_ALLOW_KINDS` where practical.
  - Ensure settings reads tolerate older stored values.
  - **Validation:** Existing settings tests pass.

## Phase 2: RPC Defense in Depth

- [ ] **2.1** Add a protected-kind guard before signing
  - In the `nostr.signEvent` handler, check `isProtectedKind(event.kind)` before signing an auto-allowed event.
  - If the event is protected and the flow would auto-sign, route it through the approval path instead.
  - Do not change explicit deny handling.
  - **Validation:** RPC handler tests prove protected events are not signed from an auto-allow result.

- [ ] **2.2** Keep approval flow behavior intact
  - Protected kind prompts should use the existing approval queue.
  - Manual approval may still sign the event for that one request.
  - Deny and timeout behavior should remain unchanged.
  - **Validation:** Existing approval tests continue to pass.

## Phase 3: Settings and UI Compatibility

- [ ] **3.1** Harden Medium Trust settings updates
  - Filter protected kinds out when updating `mediumAllowKinds`.
  - Do not fail on legacy stored values that already include protected kinds.
  - **Validation:** Settings mutation tests cover protected-kind filtering.

- [ ] **3.2** Update Medium Trust UI controls
  - Disable or omit protected kinds in Medium Trust auto-allow controls.
  - Add concise copy that Text Notes and Zap Requests always require approval.
  - Keep styling aligned with `docs/design/DESIGN_RULES.md`.
  - **Validation:** UI tests or component checks confirm protected kinds cannot be enabled.

- [ ] **3.3** Clarify protected Zap terminology
  - Ensure UI/docs distinguish Zap Request kind `9734` from Zap Receipt kind `9735`.
  - Avoid labeling kind `9735` as the protected request kind.
  - **Validation:** User-facing labels are accurate.

## Phase 4: Tests

- [ ] **4.1** Expand policy unit tests
  - Low Trust asks for all kinds.
  - Medium Trust allows configured unprotected kinds.
  - Medium Trust ignores protected kinds in `mediumAllowKinds`.
  - High Trust allows unprotected kinds.
  - High Trust asks for protected kinds.
  - Explicit deny denies protected kinds.
  - Explicit allow cannot bypass protected kinds.
  - Session grant cannot bypass protected kinds.
  - **Validation:** `pnpm run test:unit -- policy.evaluate` or the repo's equivalent focused unit command passes.

- [ ] **4.2** Expand policy service tests
  - Active session grants still allow unprotected kinds.
  - Active session grants do not allow kind `1` or `9734`.
  - Legacy stored Medium Trust values containing protected kinds are ignored.
  - **Validation:** Focused policy service tests pass.

- [ ] **4.3** Expand RPC handler tests
  - A protected event with an unexpected auto-allow result goes to approval instead of signing.
  - Existing deny, approval, timeout, and successful unprotected signing paths still work.
  - **Validation:** Focused RPC handler tests pass.

- [ ] **4.4** Add or update E2E coverage where practical
  - Configure a high-trust origin.
  - Request signing for kind `1`.
  - Verify approval is required before signing.
  - **Validation:** The relevant Playwright test passes or the manual gap is documented.

## Phase 5: Verification

- [ ] **5.1** Run OpenSpec validation
  - `openspec validate add-trust-level-policy-system --strict`
  - **Validation:** Command passes.

- [ ] **5.2** Run code verification after implementation
  - `pnpm run compile`
  - `pnpm run test:unit`
  - Relevant integration/E2E tests for policy and signing.
  - **Validation:** Commands pass or failures are documented with root cause.

- [ ] **5.3** Run React Doctor after code edits
  - `npx react-doctor@latest`
  - Continue fixing findings until React Doctor reports `No issues found!` and `100 / 100`, unless explicitly overridden.
  - **Validation:** React Doctor reports `No issues found!` and `100 / 100`.

## Deferred Future Work

- Official Ostrilo policy pubkey and key custody model.
- Relay list, timeout, cache TTL, and relay privacy rules.
- NIP-78 official policy fetch/cache.
- NIP-78 user override sync.
- Source tracking for `user`, `official`, and `global`.
- Global Trust Override and whether global High is allowed.
- Official trust badges in settings or connection popups.
- Policy-specific activity log event types.

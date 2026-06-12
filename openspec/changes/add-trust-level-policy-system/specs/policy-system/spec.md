# Policy System Specification

## ADDED Requirements

### Requirement: Protected Kind Definitions

The extension SHALL define a centralized immutable protected-kind list containing kind `1` (Short Text Note) and kind `9734` (Zap Request).

**Acceptance Criteria:**

- Protected kinds are exported from a domain policy module.
- Protected kinds are exactly `[1, 9734]` for this change.
- The policy evaluator uses the centralized protected-kind helper.
- Medium Trust settings and High Trust defaults cannot override protected kinds.
- Zap Receipt kind `9735` is not treated as the protected Zap Request kind.

#### Scenario: Protected kind helper identifies Short Text Notes

**Given** the policy module is loaded
**When** the extension checks kind `1`
**Then** the helper identifies it as protected

#### Scenario: Protected kind helper identifies Zap Requests

**Given** the policy module is loaded
**When** the extension checks kind `9734`
**Then** the helper identifies it as protected
**And** kind `9735` is not identified as protected

---

### Requirement: Local Trust Level Defaults

The extension SHALL preserve the existing local trust levels while applying protected-kind filtering.

**Acceptance Criteria:**

- Low Trust defaults to `ask` for every event kind.
- Medium Trust uses `mediumAllowKinds` for unprotected event kinds.
- Medium Trust ignores protected kinds even when they appear in stored `mediumAllowKinds`.
- High Trust defaults to `allow` for unprotected event kinds.
- High Trust defaults to `ask` for protected event kinds.
- Trust defaults are implemented through centralized policy helpers.

#### Scenario: Medium Trust allows configured unprotected kind

**Given** an origin has Medium Trust
**And** `mediumAllowKinds` contains kind `7`
**When** the origin requests to sign kind `7`
**Then** the extension auto-signs without prompting
**And** the policy reason is `trust`

#### Scenario: Medium Trust ignores protected stored setting

**Given** an origin has Medium Trust
**And** stored `mediumAllowKinds` contains kind `1`
**When** the origin requests to sign kind `1`
**Then** the extension requires approval
**And** the policy reason is `protected`

#### Scenario: High Trust allows unprotected event kind

**Given** an origin has High Trust
**When** the origin requests to sign kind `6`
**Then** the extension auto-signs without prompting
**And** the policy reason is `trust`

#### Scenario: High Trust does not allow protected event kind

**Given** an origin has High Trust
**When** the origin requests to sign kind `9734`
**Then** the extension requires approval
**And** the policy reason is `protected`

---

### Requirement: Protected Kind Enforcement

The extension SHALL never auto-sign protected kinds through trust defaults, explicit allow rules, or session grants.

**Acceptance Criteria:**

- Explicit deny rules still deny protected kinds without prompting.
- Explicit allow rules for protected kinds resolve to `ask`.
- Explicit ask rules for protected kinds resolve to `ask`.
- Session grants do not auto-sign protected kinds.
- Medium Trust does not auto-sign protected kinds.
- High Trust does not auto-sign protected kinds.
- Policy output uses reason `protected` when a protected kind is forced to approval.
- Approval prompts for protected kinds display event content.

#### Scenario: Explicit deny still blocks protected kind

**Given** an origin has an explicit `deny` rule for kind `1`
**When** the origin requests to sign kind `1`
**Then** the extension denies the request without prompting
**And** the policy reason is `rule`

#### Scenario: Explicit allow cannot bypass protected kind

**Given** an origin has an explicit `allow` rule for kind `1`
**When** the origin requests to sign kind `1`
**Then** the extension requires approval
**And** the policy reason is `protected`

#### Scenario: Session grant cannot bypass protected kind

**Given** an origin has an active session grant
**When** the origin requests to sign kind `9734`
**Then** the extension requires approval
**And** the policy reason is `protected`

---

### Requirement: Policy Evaluation Order

The extension SHALL evaluate local policy in this order: locked check, explicit deny, protected kind, session grant, explicit allow or ask, trust default, fallback ask.

**Acceptance Criteria:**

- Locked state denies before policy rules are considered.
- Explicit deny wins before protected-kind enforcement.
- Protected-kind enforcement wins before session grants.
- Protected-kind enforcement wins before explicit allow and explicit ask.
- Session grants allow unprotected kinds when no explicit deny exists.
- Explicit allow and ask rules apply to unprotected kinds before trust defaults.
- Trust defaults apply only when no earlier rule decides the result.
- Origins without a policy fall back to `ask`.
- Evaluation completes without network I/O.

#### Scenario: Locked state denies first

**Given** the vault is locked
**And** an origin has High Trust
**When** the origin requests to sign kind `7`
**Then** the extension denies the request
**And** the policy reason is `locked`

#### Scenario: Session grant allows unprotected kind

**Given** the vault is unlocked
**And** an origin has an active session grant
**When** the origin requests to sign kind `7`
**Then** the extension auto-signs without prompting
**And** the policy reason is `session`

#### Scenario: Explicit ask overrides trust for unprotected kind

**Given** the vault is unlocked
**And** an origin has High Trust
**And** the origin has an explicit `ask` rule for kind `6`
**When** the origin requests to sign kind `6`
**Then** the extension requires approval
**And** the policy reason is `rule`

#### Scenario: Unknown origin falls back to ask

**Given** the vault is unlocked
**And** no policy exists for an origin
**When** the origin requests to sign kind `7`
**Then** the extension requires approval
**And** the policy reason is `fallback`

---

### Requirement: Medium Trust Setting Compatibility

The extension SHALL preserve the existing configurable `mediumAllowKinds` setting while preventing protected kinds from being enabled as auto-allow kinds.

**Acceptance Criteria:**

- Existing `mediumAllowKinds` values continue to control Medium Trust for unprotected kinds.
- Normal settings updates do not write protected kinds into `mediumAllowKinds`.
- If stored settings already contain protected kinds, evaluation ignores them.
- Medium Trust UI either disables protected kinds or omits them from auto-allow controls.
- UI copy explains that Text Notes and Zap Requests always require manual approval.

#### Scenario: User disables Medium Trust auto-allow for kind 7

**Given** kind `7` is present in `mediumAllowKinds`
**When** the user disables kind `7` in settings
**Then** kind `7` is removed from `mediumAllowKinds`
**And** Medium Trust origins require approval for kind `7`

#### Scenario: User cannot enable protected kind as Medium Trust auto-allow

**Given** the user opens Medium Trust auto-allow settings
**When** kind `1` appears in the list
**Then** the control is disabled or omitted
**And** the UI indicates Text Notes always require approval

---

### Requirement: Protected Signing Guard

The extension SHALL include a secondary guard in the `nostr.signEvent` path so protected kinds cannot be signed from an auto-allow policy result.

**Acceptance Criteria:**

- Before signing, the RPC handler checks whether the event kind is protected.
- If a protected event reached the signing branch due to an `allow` policy result, it is rerouted to approval.
- The secondary guard does not change explicit deny behavior.
- The secondary guard uses the same centralized protected-kind helper as policy evaluation.

#### Scenario: Defensive guard catches stale allow result

**Given** the policy evaluator unexpectedly returns `allow` for kind `1`
**When** the RPC handler reaches the signing branch
**Then** the handler does not sign immediately
**And** the request is handled as requiring approval

---

## MODIFIED Requirements

### Requirement: Existing Policy Evaluation Algorithm

**Modified Behavior:** The existing policy evaluator SHALL add protected-kind enforcement between explicit deny and session grant handling.

**Acceptance Criteria:**

- The evaluator preserves locked, explicit deny, session, explicit rule, trust, and fallback outcomes for unprotected kinds.
- The evaluator returns `ask` with reason `protected` for protected kinds unless locked or explicitly denied.
- Existing origin policies do not need migration.

#### Scenario: Existing High Trust behavior remains for unprotected kinds

**Given** an origin has High Trust
**When** the origin requests to sign kind `10002`
**Then** the extension auto-signs without prompting
**And** the policy reason is `trust`

#### Scenario: Existing explicit deny behavior remains

**Given** an origin has Medium Trust
**And** an explicit `deny` rule exists for kind `7`
**When** the origin requests to sign kind `7`
**Then** the extension denies the request
**And** the policy reason is `rule`

---

## REMOVED Requirements

The active change SHALL NOT include the previously drafted requirements for official directory fetch, policy cache management, global trust override, official source badges, connection-popup trust preselection, or NIP-78 policy sync. Those belong in future proposals.

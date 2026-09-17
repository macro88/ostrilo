# Design: Harden Trust Level Policy System

## Overview

This design hardens Ostrilo's existing local policy model. It does not add remote policy sources. The core idea is a small, auditable trust policy module that all policy evaluation code uses.

```
+------------------------------------------------------------+
|                  Local Policy Evaluation                   |
+------------------------------------------------------------+
|                                                            |
|  settings.origins[]        settings.mediumAllowKinds       |
|          |                         |                       |
|          v                         v                       |
|   OriginPolicy              effectiveMediumAllowKinds      |
|          |                         |                       |
|          +------------+------------+                       |
|                       v                                    |
|                evaluatePolicy()                            |
|                       |                                    |
|        +--------------+----------------+                   |
|        v              v                v                   |
|   explicit deny   protected kind   local trust default     |
|        |              |                |                   |
|        v              v                v                   |
|      deny            ask         allow or ask              |
|                                                            |
+------------------------------------------------------------+
```

## Trust Constants

Add one domain-level module for policy constants and helpers:

```typescript
// src/domain/policy/trust-definitions.ts
import type { TrustLevel } from "../types";

export const PROTECTED_KINDS = [1, 9734] as const;

export const DEFAULT_MEDIUM_ALLOW_KINDS = [6, 16, 7, 10002] as const;

export function isProtectedKind(kind: number): boolean {
  return (PROTECTED_KINDS as readonly number[]).includes(kind);
}

export function getEffectiveMediumAllowKinds(kinds: number[]): number[] {
  return kinds.filter((kind) => !isProtectedKind(kind));
}

export function defaultForTrust(
  trustLevel: TrustLevel,
  kind: number,
  mediumAllowKinds: readonly number[]
): "allow" | "ask" {
  if (isProtectedKind(kind)) return "ask";
  if (trustLevel === "high") return "allow";
  if (trustLevel === "medium") {
    return mediumAllowKinds.includes(kind) ? "allow" : "ask";
  }
  return "ask";
}
```

The constants mirror the current app behavior:

- Low Trust: ask for everything.
- Medium Trust: allow configured Medium Trust kinds, after filtering protected kinds.
- High Trust: allow all unprotected kinds.

## Evaluation Order

The evaluation order must be explicit and tested:

1. Locked vault: deny.
2. Explicit deny rule: deny.
3. Protected kind: ask.
4. Active session grant: allow.
5. Explicit allow or ask rule: use that rule.
6. Trust default: allow or ask based on local trust level.
7. No policy: ask.

This means explicit deny still gives users a hard block, while every path that would otherwise auto-sign is stopped for protected kinds.

```
locked?
  yes -> deny(reason: locked)
  no
    explicit deny?
      yes -> deny(reason: rule)
      no
        protected kind?
          yes -> ask(reason: protected)
          no
            session grant?
              yes -> allow(reason: session)
              no
                explicit allow/ask?
                  yes -> mode from rule(reason: rule)
                  no
                    trust default or ask fallback
```

## RPC Defense In Depth

`evaluatePolicy` is the source of truth, but `nostr.signEvent` should have a secondary protected-kind guard before signing. If a protected event somehow reaches the signing branch with an auto-allow policy result, the handler must treat it as `ask` and route through the approval path.

This is intentionally defensive. It protects against stale tests, future refactors, or accidental direct calls that bypass the expected evaluation order.

## Settings Compatibility

`mediumAllowKinds` remains part of `AppSettingsV1`.

Rules:

- Stored settings may contain protected kinds from older versions or manual storage edits.
- Evaluation filters protected kinds out at runtime.
- UI controls must not let users enable protected kinds as Medium Trust auto-allow kinds.
- Settings update paths should avoid writing protected kinds back when updating `mediumAllowKinds`.

No destructive migration is needed for this change.

## UI Notes

This change only needs small UI copy and control hardening:

- Medium Trust toggles should show protected kinds as disabled/locked or omit them from auto-allow controls.
- Copy should say Text Notes and Zap Requests always require approval.
- The UI must follow `docs/design/DESIGN_RULES.md`.
- Do not introduce gradients, dot-grid backgrounds, accent rails, retired Arcade Plush classes, or pink/candy palette choices.

## Future Remote Trust Sources

Remote trust sources are deliberately outside this design.

If the project later adds an official directory, the priority chain should be designed in a separate proposal. That future work needs answers for:

- Official policy pubkey and key custody.
- Relay list and relay privacy.
- Cache TTL and stale behavior.
- Whether first connection may preselect official trust.
- Whether users can disable official lookups.
- Whether global High is allowed.
- Whether NIP-78 user sync belongs in policy or settings sync.

## Testing Strategy

Unit tests should cover:

- Low Trust asks for all kinds.
- Medium Trust allows configured unprotected kinds.
- High Trust allows unprotected kinds.
- Protected kinds ask under Medium Trust, High Trust, explicit allow, and session grant.
- Explicit deny still denies protected kinds.
- Stored `mediumAllowKinds` containing kind `1` or `9734` does not allow those kinds.

Integration tests should cover:

- `PolicyService.evaluate()` applies active session grants but still returns `ask` for protected kinds.
- Settings updates cannot persist protected kinds through normal UI/update paths.
- `nostr.signEvent` does not sign protected kinds without user approval.

E2E coverage should use the existing extension smoke flow when practical:

- Configure a high-trust origin.
- Request signing for kind `1`.
- Verify an approval prompt is required.
- Approve manually and verify the signed event/activity result.

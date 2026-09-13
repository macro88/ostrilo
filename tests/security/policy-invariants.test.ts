import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "@/domain/policy/evaluate";
import type { OriginPolicy, PolicyInput } from "@/domain/types";
import {
  DEFAULT_MEDIUM_ALLOW_KINDS,
  PROTECTED_KINDS,
} from "@/domain/policy/trust-definitions";

/**
 * Security invariant regression tests for the policy engine.
 *
 * Each test here fences a protection that EXISTS TODAY and must not be removed
 * silently. The failure message names the protection, because most of the value
 * of a regression test is delivered at the moment it breaks: a reviewer seeing
 * "expected true, got false" learns nothing, while one seeing "SECURITY
 * REGRESSION: locked-vault guard removed" knows exactly what was lost.
 *
 * Scope note. The full invariant table in
 * openspec/changes/restore-security-test-assurance/design.md lists eleven
 * invariants. Only those whose protection is already implemented are here. The
 * rest are written against behaviour that does not exist yet, and a test
 * committed red is an assumption, not a regression fence - so they ship with
 * the companion change that implements the fix:
 *
 *   kdf-parameters-pinned     -> harden-vault-key-derivation
 *   password-not-retained     -> covered in memory-zeroization.test.ts
 *   password-gate-required    -> remove-key-exfiltration-surface
 *   password-policy-enforced  -> enforce-password-policy
 *   lock-state-fails-closed   -> implement-session-auto-lock
 *   rng-source-pinned         -> covered in the entropy suite
 *   no-unzeroized-key-copy    -> covered in memory-zeroization.test.ts
 */

const mediumAllowKinds = [...DEFAULT_MEDIUM_ALLOW_KINDS];

function makePolicy(partial: Partial<OriginPolicy>): OriginPolicy {
  return {
    origin: "https://app.example",
    trustLevel: "medium",
    rules: {},
    updatedAt: 0,
    ...partial,
  };
}

function input(partial: Partial<PolicyInput> = {}): PolicyInput {
  return {
    origin: "https://app.example",
    kind: 1,
    unlocked: true,
    mediumAllowKinds,
    policies: [],
    sessionGrants: {},
    ...partial,
  };
}

describe("security invariant: policy-guard-lock", () => {
  it("denies every request while the vault is locked", () => {
    // Sweep the cases most likely to be treated as "safe" exceptions.
    const cases: Array<[string, PolicyInput]> = [
      ["unknown origin", input({ unlocked: false })],
      [
        "origin with an explicit allow rule",
        input({
          unlocked: false,
          policies: [makePolicy({ rules: { 7: "allow" } })],
          kind: 7,
        }),
      ],
      [
        "origin with a session grant",
        input({
          unlocked: false,
          policies: [makePolicy({ sessionGrantAll: true })],
          kind: 7,
        }),
      ],
      [
        "high-trust origin",
        input({
          unlocked: false,
          policies: [makePolicy({ trustLevel: "high" })],
          kind: 7,
        }),
      ],
    ];

    for (const [label, i] of cases) {
      const out = evaluatePolicy(i);
      expect(
        out.mode,
        `SECURITY REGRESSION (policy-guard-lock): a locked vault returned "${out.mode}" for ${label}. ` +
          `A locked vault must deny unconditionally, before trust levels, session grants or explicit rules are consulted.`
      ).toBe("deny");
      expect(out.reason).toBe("locked");
    }
  });
});

describe("security invariant: policy-guard-protected-kind", () => {
  it("always asks for a protected kind, whatever the trust level or grant says", () => {
    for (const kind of PROTECTED_KINDS) {
      const cases: Array<[string, PolicyInput]> = [
        [
          "high trust",
          input({ kind, policies: [makePolicy({ trustLevel: "high" })] }),
        ],
        [
          "session grant",
          input({ kind, policies: [makePolicy({ sessionGrantAll: true })] }),
        ],
        [
          "explicit allow rule",
          input({ kind, policies: [makePolicy({ rules: { [kind]: "allow" } })] }),
        ],
      ];

      for (const [label, i] of cases) {
        const out = evaluatePolicy(i);
        expect(
          out.mode,
          `SECURITY REGRESSION (policy-guard-protected-kind): protected kind ${kind} returned "${out.mode}" under ${label}. ` +
            `Protected kinds must always prompt for approval before signing.`
        ).toBe("ask");
      }
    }
  });

  it("keeps a protected kind out of the medium-trust allowlist even if configured", () => {
    const kind = PROTECTED_KINDS[0];
    const out = evaluatePolicy(
      input({
        kind,
        mediumAllowKinds: [...mediumAllowKinds, kind],
        policies: [makePolicy({ trustLevel: "medium" })],
      })
    );
    expect(
      out.mode,
      `SECURITY REGRESSION (policy-guard-protected-kind): adding protected kind ${kind} to mediumAllowKinds made it auto-sign. ` +
        `getEffectiveMediumAllowKinds must filter protected kinds out.`
    ).toBe("ask");
  });
});

describe("security invariant: policy-guard-deny-precedence", () => {
  it("honours an explicit deny over a session grant", () => {
    const out = evaluatePolicy(
      input({
        kind: 7,
        policies: [makePolicy({ sessionGrantAll: true, rules: { 7: "deny" } })],
      })
    );
    expect(
      out.mode,
      `SECURITY REGRESSION (policy-guard-deny-precedence): a session grant overrode an explicit deny and returned "${out.mode}". ` +
        `An explicit deny is the user's most specific instruction and must be evaluated first.`
    ).toBe("deny");
    expect(out.reason).toBe("rule");
  });

  it("honours an explicit deny over a high trust level", () => {
    const out = evaluatePolicy(
      input({
        kind: 7,
        policies: [makePolicy({ trustLevel: "high", rules: { 7: "deny" } })],
      })
    );
    expect(
      out.mode,
      `SECURITY REGRESSION (policy-guard-deny-precedence): high trust overrode an explicit deny and returned "${out.mode}".`
    ).toBe("deny");
  });
});

describe("security invariant: policy-fallback-ask", () => {
  it("asks for an origin that has no stored policy", () => {
    const out = evaluatePolicy(input({ kind: 7, policies: [] }));
    expect(
      out.mode,
      `SECURITY REGRESSION (policy-fallback-ask): an origin with no stored policy returned "${out.mode}". ` +
        `An unknown origin must default to asking, never to allowing.`
    ).toBe("ask");
    expect(out.reason).toBe("fallback");
  });

  it("asks for an unrecognised kind at low trust", () => {
    const out = evaluatePolicy(
      input({ kind: 31337, policies: [makePolicy({ trustLevel: "low" })] })
    );
    expect(
      out.mode,
      `SECURITY REGRESSION (policy-fallback-ask): a low-trust origin auto-signed unrecognised kind 31337.`
    ).toBe("ask");
  });
});

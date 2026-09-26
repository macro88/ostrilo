import { describe, it, expect, beforeEach } from "vitest";
import { evaluatePolicy } from "@/domain/policy/evaluate";
import type { OriginPolicy, PolicyInput } from "@/domain/types";
import {
  DEFAULT_MEDIUM_ALLOW_KINDS,
  HIGH_TRUST_ALLOW_KINDS,
  PROTECTED_KINDS,
} from "@/domain/policy/trust-definitions";
import { PolicyService } from "@/application/services/policy.service";
import type { StorageSuite } from "@/application/ports/storage";

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

describe("security invariant: policy-trust-allowlist", () => {
  it("never auto-signs a kind that is not on the trust level's allowlist", () => {
    // 0 profile, 3 contacts, 4 legacy DM, 30023 long-form, 31337 unregistered.
    // The point of an allowlist is that a kind the protocol adds tomorrow is
    // refused today, rather than shipping as silently signable.
    for (const kind of [0, 3, 4, 30023, 31337, 65535]) {
      const out = evaluatePolicy(
        input({ kind, policies: [makePolicy({ trustLevel: "high" })] })
      );
      expect(
        out.mode,
        `SECURITY REGRESSION (policy-trust-allowlist): high trust returned "${out.mode}" for kind ${kind}, ` +
          `which is not on HIGH_TRUST_ALLOW_KINDS. High trust must be an allowlist, not "everything unprotected".`
      ).toBe("ask");
    }
  });

  it("keeps medium trust inside the high-trust ceiling", () => {
    const out = evaluatePolicy(
      input({
        kind: 30023,
        mediumAllowKinds: [30023],
        policies: [makePolicy({ trustLevel: "medium" })],
      })
    );
    expect(
      out.mode,
      `SECURITY REGRESSION (policy-trust-allowlist): a configured mediumAllowKinds entry granted kind 30023, ` +
        `which high trust itself refuses. Medium trust must never exceed the high-trust allowlist.`
    ).toBe("ask");
  });

  it("holds no protected kind on any allowlist", () => {
    for (const kind of PROTECTED_KINDS) {
      expect(
        HIGH_TRUST_ALLOW_KINDS.includes(kind as never),
        `SECURITY REGRESSION (policy-trust-allowlist): protected kind ${kind} appears in HIGH_TRUST_ALLOW_KINDS.`
      ).toBe(false);
    }
  });

  it("treats a missing or unrecognised trust level as untrusted", () => {
    for (const trustLevel of [undefined, null, "", "TOTAL", 3]) {
      const out = evaluatePolicy(
        input({
          kind: 7,
          policies: [{ ...makePolicy({}), trustLevel } as unknown as OriginPolicy],
        })
      );
      expect(
        out.mode,
        `SECURITY REGRESSION (policy-trust-allowlist): a record with trustLevel ${JSON.stringify(
          trustLevel
        )} returned "${out.mode}". An unrecognised level must read as low, never as permissive.`
      ).toBe("ask");
    }
  });
});

describe("security invariant: policy-kind-integrality", () => {
  it("refuses a non-integer kind rather than letting it miss every gate", () => {
    // isProtectedKind is a Set membership test and rules are keyed by kind, so
    // 1.0000001 is not 1 anywhere. It must not therefore be freer than 1.
    const cases: Array<[string, PolicyInput]> = [
      [
        "high trust",
        input({ kind: 1.0000001, policies: [makePolicy({ trustLevel: "high" })] }),
      ],
      [
        "session grant",
        input({ kind: 7.5, policies: [makePolicy({ sessionGrantAll: true })] }),
      ],
      ["NaN", input({ kind: Number.NaN, policies: [makePolicy({ trustLevel: "high" })] })],
      [
        "Infinity",
        input({
          kind: Number.POSITIVE_INFINITY,
          policies: [makePolicy({ trustLevel: "high" })],
        }),
      ],
    ];

    for (const [label, i] of cases) {
      const out = evaluatePolicy(i);
      expect(
        out.mode,
        `SECURITY REGRESSION (policy-kind-integrality): a non-integer kind returned "${out.mode}" under ${label}. ` +
          `A kind that cannot be compared for set membership must never auto-sign.`
      ).toBe("ask");
    }
  });
});

describe("security invariant: policy-consent-scope", () => {
  let storage: StorageSuite;
  let service: PolicyService;

  function memoryStorage(): StorageSuite {
    const make = () => {
      const m = new Map<string, unknown>();
      return {
        async get<T>(key: string): Promise<T | undefined> {
          return m.get(key) as T | undefined;
        },
        async set<T>(key: string, value: T): Promise<void> {
          m.set(key, value);
        },
        async remove(key: string): Promise<void> {
          m.delete(key);
        },
      };
    };
    return { local: make(), sync: make(), session: make() };
  }

  beforeEach(async () => {
    storage = memoryStorage();
    service = new PolicyService(storage);
    await storage.session.set("lockState", { isLocked: false });
    // Mark the consent migration as already run. Otherwise it would repair a
    // record the write path fabricated, and these tests would pass for the
    // wrong reason - fencing the migration instead of setPerKindRule.
    await storage.local.set("appSettings", {
      __version: "settings.v1",
      origins: [],
      __consentMigrations: 1,
    });
  });

  it("does not widen a site's authority when the user says no", async () => {
    await service.setPerKindRule("https://example.com", 1, "deny");

    // The original defect: setPerKindRule created the record with
    // trustLevel "medium", and medium auto-allows 6, 16, 7 and 10002. Denying
    // a note therefore granted silent reposts, reactions and relay-list
    // rewrites - more authority than the user was ever asked about.
    for (const kind of [6, 16, 7, 10002]) {
      const out = await service.evaluate({ origin: "https://example.com", kind });
      expect(
        out.mode,
        `SECURITY REGRESSION (policy-consent-scope): deny-and-remember on kind 1 made kind ${kind} return "${out.mode}". ` +
          `A remembered decision must grant exactly the decision the user made.`
      ).toBe("ask");
    }
  });

  it("does not grant an unbounded session", async () => {
    await storage.local.set("appSettings", {
      __version: "settings.v1",
      origins: [],
      sessionTTLMinutes: 0,
    });

    await service.setSessionGrant("https://example.com", true);
    const grants = await storage.session.get<Record<string, number>>(
      "sessionGrants"
    );

    expect(
      grants!["https://example.com"],
      `SECURITY REGRESSION (policy-consent-scope): a stored sessionTTLMinutes of 0 produced expiry ` +
        `${grants!["https://example.com"]}. A grant-everything session must always expire.`
    ).toBeGreaterThan(Date.now());
  });

  it("ignores an expired or legacy zero-expiry grant", async () => {
    await storage.local.set("appSettings", {
      __version: "settings.v1",
      origins: [
        {
          origin: "https://example.com",
          trustLevel: "low",
          rules: {},
          updatedAt: 1,
        },
      ],
    });

    for (const expiresAt of [0, Date.now() - 1000]) {
      await storage.session.set("sessionGrants", {
        "https://example.com": expiresAt,
      });
      const out = await service.evaluate({
        origin: "https://example.com",
        kind: 7,
      });
      expect(
        out.reason,
        `SECURITY REGRESSION (policy-consent-scope): a grant with expiry ${expiresAt} still allowed signing.`
      ).not.toBe("session");
    }
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

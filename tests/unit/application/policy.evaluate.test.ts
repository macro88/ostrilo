import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "@/domain/policy/evaluate";
import { COMMON_EVENT_KINDS, getKindName, OriginPolicy } from "@/domain/types";
import {
  DEFAULT_MEDIUM_ALLOW_KINDS,
  HIGH_TRUST_ALLOW_KINDS,
  PROTECTED_KINDS,
  defaultForTrust,
  getEffectiveMediumAllowKinds,
  isHighTrustAllowedKind,
  isProtectedKind,
  isSignableKindValue,
  normaliseTrustLevel,
} from "@/domain/policy/trust-definitions";

const mediumAllowKinds = [...DEFAULT_MEDIUM_ALLOW_KINDS];

function makePolicy(partial: Partial<OriginPolicy>): OriginPolicy {
  return {
    origin: "https://app",
    trustLevel: "medium",
    rules: {},
    updatedAt: Math.floor(Date.now() / 1000),
    ...partial,
  };
}

describe("evaluatePolicy", () => {
  const baseInput = {
    origin: "https://app",
    kind: 7,
    unlocked: true,
    mediumAllowKinds,
    policies: [] as OriginPolicy[],
    sessionGrants: {}
  };

  it("centralizes protected kind helpers", () => {
    // Irreversible or credential-equivalent: note, deletion, zap request,
    // NIP-42 relay auth, NIP-98 HTTP auth.
    expect(PROTECTED_KINDS).toEqual([1, 5, 9734, 22242, 27235]);
    expect(isProtectedKind(1)).toBe(true);
    expect(isProtectedKind(5)).toBe(true);
    expect(isProtectedKind(9734)).toBe(true);
    expect(isProtectedKind(22242)).toBe(true);
    expect(isProtectedKind(27235)).toBe(true);
    expect(isProtectedKind(9735)).toBe(false);
    // 9735 is unprotected but outside the high-trust allowlist, so medium
    // trust can never act on it either.
    expect(getEffectiveMediumAllowKinds([1, 6, 9734, 9735])).toEqual([6]);
    expect(getEffectiveMediumAllowKinds([...DEFAULT_MEDIUM_ALLOW_KINDS])).toEqual(
      [...DEFAULT_MEDIUM_ALLOW_KINDS]
    );
  });

  it("keeps the shipped medium defaults inside the high-trust ceiling", () => {
    for (const kind of DEFAULT_MEDIUM_ALLOW_KINDS) {
      expect(isHighTrustAllowedKind(kind)).toBe(true);
    }
  });

  it("treats the high-trust list as an allowlist, not a denylist", () => {
    expect([...HIGH_TRUST_ALLOW_KINDS]).toEqual([
      6, 7, 16, 10000, 10001, 10002, 10003, 30078,
    ]);
    for (const kind of PROTECTED_KINDS) {
      expect(isHighTrustAllowedKind(kind)).toBe(false);
    }
    // Sensitive-but-reversible kinds are absent, so no trust level auto-signs
    // them; only an explicit user rule can.
    for (const kind of [0, 3, 4, 14, 30023]) {
      expect(isHighTrustAllowedKind(kind)).toBe(false);
    }
  });

  it("refuses non-integer kinds in every kind-keyed helper", () => {
    for (const kind of [1.0000001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(isSignableKindValue(kind)).toBe(false);
      expect(isProtectedKind(kind)).toBe(false);
      expect(isHighTrustAllowedKind(kind)).toBe(false);
      expect(defaultForTrust("high", kind, [...DEFAULT_MEDIUM_ALLOW_KINDS])).toBe(
        "ask"
      );
      expect(
        defaultForTrust("medium", kind, [...DEFAULT_MEDIUM_ALLOW_KINDS])
      ).toBe("ask");
    }
    expect(getEffectiveMediumAllowKinds([6, 6.5, Number.NaN])).toEqual([6]);
  });

  it("reads an unrecognised trust level as untrusted", () => {
    expect(normaliseTrustLevel(undefined)).toBe("low");
    expect(normaliseTrustLevel("TOTAL")).toBe("low");
    expect(normaliseTrustLevel(null)).toBe("low");
    expect(normaliseTrustLevel("high")).toBe("high");
  });

  it("labels common client policy kinds", () => {
    expect(getKindName(0)).toBe("Profile Metadata");
    expect(getKindName(3)).toBe("Contacts");
    expect(getKindName(10000)).toBe("Mute List");
    expect(getKindName(10001)).toBe("Pin List");
    expect(getKindName(10002)).toBe("Relay List");
    expect(getKindName(30078)).toBe("Application Data");
    expect(COMMON_EVENT_KINDS).toMatchObject({
      0: "Profile Metadata",
      3: "Contacts",
      10000: "Mute List",
      10001: "Pin List",
      10002: "Relay List",
      30078: "Application Data",
    });
  });

  it("denies when locked", () => {
    const out = evaluatePolicy({
      ...baseInput,
      unlocked: false
    });
    expect(out.reason).toBe("locked");
    expect(out.mode).toBe("deny");
  });

  it("explicit deny wins over session", () => {
    const pol = makePolicy({ sessionGrantAll: true, rules: { 1: "deny" } });
    const out = evaluatePolicy({
      ...baseInput,
      kind: 1,
      policies: [pol]
    });
    expect(out.reason).toBe("rule");
    expect(out.mode).toBe("deny");
  });

  it("session grant allows when no explicit deny", () => {
    const pol = makePolicy({ sessionGrantAll: true });
    const out = evaluatePolicy({
      ...baseInput,
      policies: [pol]
    });
    expect(out.reason).toBe("session");
    expect(out.mode).toBe("allow");
  });

  it("session grant cannot bypass protected kinds", () => {
    const pol = makePolicy({ sessionGrantAll: true });
    const out = evaluatePolicy({
      ...baseInput,
      kind: 9734,
      policies: [pol]
    });
    expect(out.reason).toBe("protected");
    expect(out.mode).toBe("ask");
  });

  it("explicit rule ask overrides trust", () => {
    const pol = makePolicy({ trustLevel: "high", rules: { 6: "ask" } });
    const out = evaluatePolicy({
      ...baseInput,
      kind: 6,
      policies: [pol]
    });
    expect(out.reason).toBe("rule");
    expect(out.mode).toBe("ask");
  });

  it("explicit allow cannot bypass protected kinds", () => {
    const pol = makePolicy({ trustLevel: "low", rules: { 1: "allow" } });
    const out = evaluatePolicy({
      ...baseInput,
      kind: 1,
      policies: [pol]
    });
    expect(out.reason).toBe("protected");
    expect(out.mode).toBe("ask");
  });

  it("trust=high allows allowlisted kinds and asks for protected kinds", () => {
    const pol = makePolicy({ trustLevel: "high" });
    const allowed = evaluatePolicy({
      ...baseInput,
      kind: 10002,
      policies: [pol]
    });
    const protectedOut = evaluatePolicy({
      ...baseInput,
      kind: 1,
      policies: [pol]
    });
    expect(allowed.reason).toBe("trust");
    expect(allowed.mode).toBe("allow");
    expect(protectedOut.reason).toBe("protected");
    expect(protectedOut.mode).toBe("ask");
  });

  it("trust=medium allows configured unprotected kinds and filters protected kinds", () => {
    const pol = makePolicy({ trustLevel: "medium" });
    const allowed = evaluatePolicy({
      ...baseInput,
      kind: 6,
      mediumAllowKinds: [1, 6, 9734],
      policies: [pol]
    });
    const protectedOut = evaluatePolicy({
      ...baseInput,
      kind: 1,
      mediumAllowKinds: [1, 6, 9734],
      policies: [pol]
    });
    expect(allowed.mode).toBe("allow");
    expect(allowed.reason).toBe("trust");
    expect(protectedOut.mode).toBe("ask");
    expect(protectedOut.reason).toBe("protected");
  });

  it("trust=low asks for unprotected kinds", () => {
    const pol = makePolicy({ trustLevel: "low" });
    const out = evaluatePolicy({
      ...baseInput,
      policies: [pol]
    });
    expect(out.reason).toBe("trust");
    expect(out.mode).toBe("ask");
  });

  it("fallback asks when no policy", () => {
    const out = evaluatePolicy({
      ...baseInput,
      origin: "https://unknown"
    });
    expect(out.reason).toBe("fallback");
    expect(out.mode).toBe("ask");
  });

  describe("expanded protected kinds", () => {
    const newlyProtected = [5, 22242, 27235];

    it.each(newlyProtected)("asks for kind %i at high trust", (kind) => {
      const out = evaluatePolicy({
        ...baseInput,
        kind,
        policies: [makePolicy({ trustLevel: "high" })],
      });
      expect(out).toEqual({ mode: "ask", reason: "protected" });
    });

    it.each(newlyProtected)("asks for kind %i at medium trust", (kind) => {
      const out = evaluatePolicy({
        ...baseInput,
        kind,
        mediumAllowKinds: [...mediumAllowKinds, kind],
        policies: [makePolicy({ trustLevel: "medium" })],
      });
      expect(out).toEqual({ mode: "ask", reason: "protected" });
    });

    it.each(newlyProtected)(
      "asks for kind %i despite an explicit allow rule",
      (kind) => {
        const out = evaluatePolicy({
          ...baseInput,
          kind,
          policies: [makePolicy({ rules: { [kind]: "allow" } })],
        });
        expect(out).toEqual({ mode: "ask", reason: "protected" });
      }
    );

    it.each(newlyProtected)(
      "asks for kind %i under an active session grant",
      (kind) => {
        const out = evaluatePolicy({
          ...baseInput,
          kind,
          policies: [makePolicy({ sessionGrantAll: true })],
        });
        expect(out).toEqual({ mode: "ask", reason: "protected" });
      }
    );

    it.each(newlyProtected)(
      "still lets an explicit deny win for kind %i",
      (kind) => {
        const out = evaluatePolicy({
          ...baseInput,
          kind,
          policies: [makePolicy({ rules: { [kind]: "deny" } })],
        });
        expect(out).toEqual({ mode: "deny", reason: "rule" });
      }
    );
  });

  describe("trust levels as allowlists", () => {
    // 0 profile, 3 contacts, 4 legacy DM, 30023 long-form, 31337 unregistered.
    const outsideAllowlist = [0, 3, 4, 30023, 31337];

    it.each(outsideAllowlist)(
      "asks for non-allowlisted kind %i at high trust",
      (kind) => {
        const out = evaluatePolicy({
          ...baseInput,
          kind,
          policies: [makePolicy({ trustLevel: "high" })],
        });
        expect(out).toEqual({ mode: "ask", reason: "trust" });
      }
    );

    it("allows an allowlisted kind at high trust", () => {
      const out = evaluatePolicy({
        ...baseInput,
        kind: 7,
        policies: [makePolicy({ trustLevel: "high" })],
      });
      expect(out).toEqual({ mode: "allow", reason: "trust" });
    });

    it("keeps medium trust inside the high-trust ceiling", () => {
      // A polluted or legacy medium list cannot grant what high trust refuses.
      const out = evaluatePolicy({
        ...baseInput,
        kind: 30023,
        mediumAllowKinds: [30023],
        policies: [makePolicy({ trustLevel: "medium" })],
      });
      expect(out).toEqual({ mode: "ask", reason: "trust" });
    });

    it("asks for every kind at low trust", () => {
      for (const kind of [6, 7, 16, 10002, 30078]) {
        const out = evaluatePolicy({
          ...baseInput,
          kind,
          policies: [makePolicy({ trustLevel: "low" })],
        });
        expect(out).toEqual({ mode: "ask", reason: "trust" });
      }
    });

    it("treats a missing trust level as low", () => {
      const out = evaluatePolicy({
        ...baseInput,
        kind: 7,
        policies: [
          { origin: "https://app", rules: {}, updatedAt: 0 } as any,
        ],
      });
      expect(out).toEqual({ mode: "ask", reason: "trust" });
    });

    it("still honours an explicit allow for a non-allowlisted unprotected kind", () => {
      const out = evaluatePolicy({
        ...baseInput,
        kind: 30023,
        policies: [
          makePolicy({ trustLevel: "low", rules: { 30023: "allow" } }),
        ],
      });
      expect(out).toEqual({ mode: "allow", reason: "rule" });
    });
  });

  describe("non-integer kinds", () => {
    it("cannot bypass the protected-kind gate for kind 1", () => {
      const out = evaluatePolicy({
        ...baseInput,
        kind: 1.0000001,
        policies: [makePolicy({ trustLevel: "high" })],
      });
      expect(out).toEqual({ mode: "ask", reason: "protected" });
    });

    it("cannot ride a session grant", () => {
      const out = evaluatePolicy({
        ...baseInput,
        kind: 7.5,
        policies: [makePolicy({ sessionGrantAll: true })],
      });
      expect(out).toEqual({ mode: "ask", reason: "protected" });
    });

    it("refuses NaN and Infinity", () => {
      for (const kind of [Number.NaN, Number.POSITIVE_INFINITY]) {
        const out = evaluatePolicy({
          ...baseInput,
          kind,
          policies: [makePolicy({ trustLevel: "high" })],
        });
        expect(out).toEqual({ mode: "ask", reason: "protected" });
      }
    });
  });
});

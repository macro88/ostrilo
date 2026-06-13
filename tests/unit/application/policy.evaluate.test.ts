import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "@/domain/policy/evaluate";
import { COMMON_EVENT_KINDS, getKindName, OriginPolicy } from "@/domain/types";
import {
  DEFAULT_MEDIUM_ALLOW_KINDS,
  PROTECTED_KINDS,
  getEffectiveMediumAllowKinds,
  isProtectedKind,
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
    expect(PROTECTED_KINDS).toEqual([1, 9734]);
    expect(isProtectedKind(1)).toBe(true);
    expect(isProtectedKind(9734)).toBe(true);
    expect(isProtectedKind(9735)).toBe(false);
    expect(getEffectiveMediumAllowKinds([1, 6, 9734, 9735])).toEqual([
      6, 9735,
    ]);
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

  it("trust=high allows unprotected kinds and asks for protected kinds", () => {
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
});

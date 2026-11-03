import { describe, expect, it } from "vitest";
import {
  disclosureFor,
  disclosureKeyIds,
  disclosureState,
  withDisclosureDecision,
  withDisclosureGrant,
  withoutDisclosureGrant,
} from "@/domain/policy/disclosure-grants";
import { A, B, SHAPES, policy } from "../../helpers/disclosure-shapes";

describe("what Settings shows agrees with what is enforced", () => {
  it.each(SHAPES)("%s", (_name, record) => {
    const state = disclosureState(record);
    const keys = [A, B, "unlisted"];
    const allowed = keys.filter((k) => disclosureFor(record, k) === "allow");

    // Shown as allow exactly when some key is actually answered, and then the
    // listed grants are exactly the keys that are answered.
    expect(state === "allow").toBe(allowed.length > 0);
    expect(disclosureKeyIds(record).filter((k) => keys.includes(k))).toEqual(
      state === "allow" ? allowed : []
    );
    expect(state === "deny").toBe(keys.every((k) => disclosureFor(record, k) === "deny"));
  });
});

describe("disclosure record transitions", () => {
  it("grants add, dedupe and replace a stale list", () => {
    const first = withDisclosureGrant(policy(), A);
    expect(withDisclosureGrant(first, B).identityDisclosureKeyIds).toEqual([A, B]);
    expect(withDisclosureGrant(first, A).identityDisclosureKeyIds).toEqual([A]);
    const stale = policy({ identityDisclosure: "ask", identityDisclosureKeyIds: [A] });
    expect(withDisclosureGrant(stale, B).identityDisclosureKeyIds).toEqual([B]);
  });

  it("revoking the last grant leaves ask, not deny", () => {
    const next = withoutDisclosureGrant(withDisclosureGrant(policy(), A), A);
    expect(next.identityDisclosure).toBe("ask");
    expect(next.identityDisclosureKeyIds).toBeUndefined();
  });

  it("a decision drops the list", () => {
    const next = withDisclosureDecision(withDisclosureGrant(policy(), A), "deny");
    expect(next.identityDisclosureKeyIds).toBeUndefined();
  });
});

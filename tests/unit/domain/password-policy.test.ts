import { describe, it, expect } from "vitest";
import {
  checkPassword,
  normalizeForBlocklist,
  PASSWORD_POLICY,
  describeViolation,
  type PasswordViolation,
} from "@/domain/utils/password-policy";

/**
 * The policy predicate.
 *
 * The defect this fences: four key-creation surfaces, two checking
 * `strength.score < 3` and two checking only `if (!password)`, with the one
 * correct predicate (`meetsMinimum`) referenced nowhere. `Aa1!` scored 3 on
 * character variety alone and was accepted as a vault password.
 */

const blocklist = new Set([
  "password",
  "letmein",
  "monkey",
  "dragon",
  "welcome",
  "iloveyou",
]);

const check = (pw: string, extra?: string[]) =>
  checkPassword(pw, { blocklist, extraTerms: extra });

describe("the password that started this", () => {
  it("rejects Aa1!, which the old score-only gate accepted", () => {
    const v = check("Aa1!");
    expect(
      v.acceptable,
      "Aa1! satisfies mixed case + digit + symbol, scoring 3 under the old gate"
    ).toBe(false);
    expect(v.violations).toContain("too_short");
  });

  it("rejects an 8-character password, the old nominal minimum", () => {
    expect(check("Tr0ub4dr").acceptable).toBe(false);
  });

  it("rejects a single character, which two dialog paths accepted", () => {
    expect(check("a").acceptable).toBe(false);
  });
});

describe("length floor", () => {
  it(`requires at least ${PASSWORD_POLICY.minLength} characters`, () => {
    expect(check("x".repeat(PASSWORD_POLICY.minLength - 1)).acceptable).toBe(
      false
    );
  });

  it("accepts a long, unremarkable passphrase", () => {
    const v = check("unmark thicket parcel");
    expect(v.acceptable, JSON.stringify(v.violations)).toBe(true);
    expect(v.score).toBe(4);
  });

  it("accepts a 15-character non-dictionary password", () => {
    const v = check("harbourlanterns");
    expect(v.acceptable, JSON.stringify(v.violations)).toBe(true);
  });

  it("rejects one over the transport limit", () => {
    expect(check("a" + "bcdf".repeat(300)).violations).toContain("too_long");
  });
});

describe("patterns that feel strong and are not", () => {
  it("rejects Password123!, a blocklist hit once normalized", () => {
    const v = check("Password123!");
    expect(v.acceptable).toBe(false);
    expect(v.violations).toContain("common_password");
  });

  it("rejects a keyboard run", () => {
    const v = check("qwertyuiop12");
    expect(v.acceptable).toBe(false);
    expect(v.violations).toContain("keyboard_pattern");
  });

  it("rejects a long repeated run", () => {
    const v = check("aaaaaaaaaaaa");
    expect(v.acceptable).toBe(false);
    expect(v.violations).toContain("repeated_characters");
  });

  it("rejects an alphabet sequence", () => {
    const v = check("abcdefghijkl");
    expect(v.acceptable).toBe(false);
    expect(v.violations).toContain("sequential_characters");
  });

  it("rejects a password containing a product term", () => {
    const v = check("ostrilonostr");
    expect(v.acceptable).toBe(false);
    expect(v.violations).toContain("product_term");
  });

  it("rejects a password containing the key label the user just typed", () => {
    const v = check("mytradingkeyaccount", ["MyTradingKey"]);
    expect(v.violations).toContain("product_term");
  });

  it("ignores a very short extra term, which would match almost anything", () => {
    expect(check("unmark thicket parcel", ["ab"]).acceptable).toBe(true);
  });
});

describe("blocklist normalization", () => {
  it("folds leet substitutions and trailing noise to the dictionary word", () => {
    expect(normalizeForBlocklist("P@ssw0rd123!")).toBe("password");
    expect(normalizeForBlocklist("L3tM3In!!")).toBe("letmein");
    expect(normalizeForBlocklist("  MONKEY  ")).toBe("monkey");
  });
});

describe("acceptable requires the blocklist", () => {
  it("cannot green-light a password when the blocklist is absent", () => {
    // This is the structural guard: a fast local UI evaluation may report
    // violations, but only the background - which has the blocklist - can
    // accept. It makes the old bug, a caller inventing its own predicate,
    // unrepresentable.
    const v = checkPassword("unmark thicket parcel");
    expect(v.blocklistChecked).toBe(false);
    expect(
      v.acceptable,
      "a verdict without the blocklist must never be acceptable"
    ).toBe(false);
    expect(v.violations).toContain("blocklist_unavailable");
  });

  it("still reports the real structural violations without a blocklist", () => {
    const v = checkPassword("Aa1!");
    expect(v.violations).toContain("too_short");
  });
});

describe("score is display-only and re-anchored to the policy", () => {
  it("never rises above the lowest band when a hard violation exists", () => {
    for (const pw of ["Aa1!", "aaaaaaaaaaaa", "qwertyuiop12", "Password123!"]) {
      expect(check(pw).score, `${pw} must not score above 0`).toBe(0);
    }
  });

  it("reaches the top band only at the recommended length", () => {
    expect(check("harbourlanterns").score).toBeLessThan(4);
    expect(check("unmark thicket parcel").score).toBe(4);
  });
});

describe("violation messages", () => {
  it("never echoes the password", () => {
    const secret = "ostrilonostr";
    for (const v of check(secret).violations) {
      expect(describeViolation(v)).not.toContain(secret);
    }
  });

  it("describes every violation the checker can emit", () => {
    const all: PasswordViolation[] = [
      "too_short",
      "too_long",
      "common_password",
      "repeated_characters",
      "sequential_characters",
      "keyboard_pattern",
      "product_term",
      "blocklist_unavailable",
    ];
    for (const v of all) {
      expect(describeViolation(v).length).toBeGreaterThan(10);
    }
  });
});

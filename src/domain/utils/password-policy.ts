/**
 * The single source of truth for what makes a vault password acceptable.
 *
 * Why this module exists. The policy previously lived inside React components,
 * and it was wrong in all of them. Two onboarding flows checked
 * `strength.score < 3` while the domain layer exposed a correct `meetsMinimum`
 * (`score >= 3 && length >= 8`) that nothing used. Dropping the length term
 * makes the check satisfiable by character variety alone, so `Aa1!` - four
 * characters - was accepted. The two dialog flows checked only `if (!password)`,
 * accepting a single character. The transport schema was
 * `z.string().min(1).max(1000)`.
 *
 * So there were four creation surfaces, two with a broken predicate and two
 * with none, and nothing at the trust boundary. This module is the one rule;
 * every surface calls it.
 *
 * Why length dominates. At the vault's work factor the password carries the
 * whole security boundary, and entropy comes from length far more than from
 * character classes. A 12-character human password is worth roughly 40 bits; a
 * complex 8-character one is worth less while feeling stronger. Composition
 * rules mostly teach people to write `Password1!`, which is why this policy
 * checks a blocklist and common patterns rather than mandating character
 * classes.
 */

export const PASSWORD_POLICY = {
  /** Hard floor. Below this, creation is refused. */
  minLength: 12,
  /** Advisory target shown in the UI. */
  recommendedLength: 20,
  /** Transport limit; not a security property, just a bound on input. */
  maxLength: 1000,
  /** Substrings that must not appear, case-insensitively. */
  productTerms: ["ostrilo", "nostr", "nsec", "npub", "vault", "signer"],
  /** Longest run of one repeated character tolerated. */
  maxRepeatRun: 3,
  /** Longest ascending/descending run tolerated. */
  maxSequenceRun: 4,
} as const;

export type PasswordViolation =
  | "too_short"
  | "too_long"
  | "common_password"
  | "repeated_characters"
  | "sequential_characters"
  | "keyboard_pattern"
  | "product_term"
  | "blocklist_unavailable";

export interface PasswordRequirement {
  id: string;
  label: string;
  passes: boolean;
}

export interface PasswordVerdict {
  /**
   * The ONLY field a caller should gate on.
   *
   * Note it is false whenever `blocklistChecked` is false. A UI doing a fast
   * local evaluation can report violations, but it can never green-light a
   * password: that decision requires the blocklist, which lives in the
   * background. This makes the old bug - a caller inventing its own predicate
   * from `score` - unrepresentable.
   */
  acceptable: boolean;
  violations: PasswordViolation[];
  requirements: PasswordRequirement[];
  /** Display only. Never gate on this. */
  score: 0 | 1 | 2 | 3 | 4;
  blocklistChecked: boolean;
}

export interface CheckPasswordOptions {
  /**
   * Normalised common-password blocklist. When omitted the verdict cannot be
   * `acceptable`; see `blocklistChecked`.
   */
  blocklist?: ReadonlySet<string>;
  /** Extra terms to forbid, e.g. the key label the user just typed. */
  extraTerms?: readonly string[];
}

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "@": "a", "$": "s", "!": "i", "|": "l",
};

/**
 * Folds a password toward its dictionary form for blocklist lookup, so
 * `P@ssw0rd123!` and `password` collide.
 */
export function normalizeForBlocklist(password: string): string {
  // Order matters: strip the trailing digits and punctuation BEFORE folding
  // leet substitutions. Folding first turns "123!" into "i2ei", which is no
  // longer strippable, and "P@ssw0rd123!" normalizes to "passwordi2ei" instead
  // of "password" - so the blocklist misses it.
  let s = password.toLowerCase();
  s = s.replace(/\s+/g, "");
  s = s.replace(/[\d\p{P}\p{S}]+$/u, "");
  s = s.replace(/[0134578@$!|]/g, (c) => LEET[c] ?? c);
  return s;
}

const KEYBOARD_ROWS = [
  "qwertyuiop", "asdfghjkl", "zxcvbnm",
  "1234567890", "azertyuiop", "qwertzuiop",
];

function hasRepeatRun(s: string, max: number): boolean {
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    run = s[i] === s[i - 1] ? run + 1 : 1;
    if (run > max) return true;
  }
  return false;
}

function hasSequenceRun(s: string, max: number): boolean {
  let up = 1;
  let down = 1;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    up = d === 1 ? up + 1 : 1;
    down = d === -1 ? down + 1 : 1;
    if (up > max || down > max) return true;
  }
  return false;
}

function hasKeyboardPattern(s: string): boolean {
  const lower = s.toLowerCase();
  for (const row of KEYBOARD_ROWS) {
    for (let len = 5; len <= row.length; len++) {
      for (let i = 0; i + len <= row.length; i++) {
        const seg = row.slice(i, i + len);
        if (lower.includes(seg)) return true;
        if (lower.includes([...seg].reverse().join(""))) return true;
      }
    }
  }
  return false;
}

/**
 * Evaluates a password against the policy.
 *
 * Pure and synchronous so both the background and the UI can call it; the
 * blocklist is passed in rather than imported, because it is a large module
 * that must not end up in a UI bundle.
 */
export function checkPassword(
  password: string,
  options: CheckPasswordOptions = {}
): PasswordVerdict {
  const violations: PasswordViolation[] = [];
  const { blocklist, extraTerms = [] } = options;

  if (password.length < PASSWORD_POLICY.minLength) violations.push("too_short");
  if (password.length > PASSWORD_POLICY.maxLength) violations.push("too_long");
  if (hasRepeatRun(password, PASSWORD_POLICY.maxRepeatRun)) {
    violations.push("repeated_characters");
  }
  if (hasSequenceRun(password, PASSWORD_POLICY.maxSequenceRun)) {
    violations.push("sequential_characters");
  }
  if (hasKeyboardPattern(password)) violations.push("keyboard_pattern");

  const lower = password.toLowerCase();
  const terms = [
    ...PASSWORD_POLICY.productTerms,
    ...extraTerms.map((t) => t.toLowerCase()).filter((t) => t.length >= 4),
  ];
  if (terms.some((t) => t && lower.includes(t))) violations.push("product_term");

  const blocklistChecked = blocklist !== undefined;
  if (blocklistChecked) {
    const candidate = normalizeForBlocklist(password);
    if (candidate.length > 0 && blocklist.has(candidate)) {
      violations.push("common_password");
    }
  } else {
    violations.push("blocklist_unavailable");
  }

  const hardViolations = violations.filter((v) => v !== "blocklist_unavailable");

  // Score is display only, and re-anchored to the policy: anything with a hard
  // violation sits in the lowest band, so a UI cannot show "Strong" for a
  // password the policy refuses.
  let score: PasswordVerdict["score"] = 0;
  if (hardViolations.length === 0) {
    if (password.length >= PASSWORD_POLICY.recommendedLength) score = 4;
    else if (password.length >= 16) score = 3;
    else score = 2;
  }

  const requirements: PasswordRequirement[] = [
    {
      id: "length",
      label: `At least ${PASSWORD_POLICY.minLength} characters`,
      passes: password.length >= PASSWORD_POLICY.minLength,
    },
    {
      id: "recommended",
      label: `${PASSWORD_POLICY.recommendedLength}+ characters recommended, or use a passphrase`,
      passes: password.length >= PASSWORD_POLICY.recommendedLength,
    },
    {
      id: "not-common",
      label: "Not a commonly used password",
      passes: blocklistChecked && !violations.includes("common_password"),
    },
    {
      id: "no-pattern",
      label: "No repeated, sequential or keyboard patterns",
      passes:
        !violations.includes("repeated_characters") &&
        !violations.includes("sequential_characters") &&
        !violations.includes("keyboard_pattern"),
    },
    {
      id: "no-product-term",
      label: "Does not contain the app or key name",
      passes: !violations.includes("product_term"),
    },
  ];

  return {
    acceptable: hardViolations.length === 0 && blocklistChecked,
    violations,
    requirements,
    score,
    blocklistChecked,
  };
}

/** Caller-safe message for a violation. Never echoes the password. */
export function describeViolation(v: PasswordViolation): string {
  switch (v) {
    case "too_short":
      return `Password must be at least ${PASSWORD_POLICY.minLength} characters.`;
    case "too_long":
      return `Password must be at most ${PASSWORD_POLICY.maxLength} characters.`;
    case "common_password":
      return "That password appears in lists of commonly used passwords.";
    case "repeated_characters":
      return "Avoid long runs of the same character.";
    case "sequential_characters":
      return "Avoid sequences such as abcdef or 123456.";
    case "keyboard_pattern":
      return "Avoid keyboard patterns such as qwertyui.";
    case "product_term":
      return "Avoid using the app name or your key name in the password.";
    case "blocklist_unavailable":
      return "Password could not be fully checked. Try again.";
  }
}

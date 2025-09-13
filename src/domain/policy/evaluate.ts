import {
  Authorisation,
  EvalReason,
  OriginPolicy,
  PolicyContext,
  PolicyInput,
  PolicyOutput,
  TrustLevel,
} from "../types";

// Map trust level to default behaviours
function defaultForTrust(
  trust: TrustLevel,
  kind: number,
  mediumAllow: Set<number>
): Authorisation {
  if (trust === "high") return "allow";
  if (trust === "medium") {
    return mediumAllow.has(kind) ? "allow" : "ask";
  }
  // low
  return "ask";
}

export function evaluatePolicy(
  input: PolicyInput
): PolicyOutput {
  const { origin, kind, unlocked, mediumAllowKinds, policies, sessionGrants } = input;

  if (!unlocked) {
    return { mode: "deny", reason: "locked" };
  }

  const policy = policies.find((p: OriginPolicy) => p.origin === origin);
  const mediumAllow = new Set<number>(mediumAllowKinds);

  // Explicit deny always wins, even against session grant
  const explicit: Authorisation | undefined = policy?.rules?.[kind];
  if (explicit === "deny") {
    return { mode: "deny", reason: "rule" };
  }

  // Session grant: allow all while unlocked unless an explicit deny exists
  if (policy?.sessionGrantAll) {
    return { mode: "allow", reason: "session" };
  }

  // Explicit rule (allow/ask) next
  if (explicit) {
    return { mode: explicit, reason: "rule" };
  }

  // Trust level default
  if (policy) {
    const mode = defaultForTrust(policy.trustLevel, kind, mediumAllow);
    return { mode, reason: "trust" };
  }

  // Fallback to ask
  return { mode: "ask", reason: "fallback" };
}

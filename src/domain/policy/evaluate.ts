import {
  Authorisation,
  OriginPolicy,
  PolicyInput,
  PolicyOutput,
} from "../types";
import {
  defaultForTrust,
  getEffectiveMediumAllowKinds,
  isProtectedKind,
} from "./trust-definitions";

export function evaluatePolicy(
  input: PolicyInput
): PolicyOutput {
  const { origin, kind, unlocked, mediumAllowKinds, policies } = input;

  if (!unlocked) {
    return { mode: "deny", reason: "locked" };
  }

  const policy = policies.find((p: OriginPolicy) => p.origin === origin);
  const effectiveMediumAllowKinds =
    getEffectiveMediumAllowKinds(mediumAllowKinds);

  const explicit: Authorisation | undefined = policy?.rules?.[kind];
  if (explicit === "deny") {
    return { mode: "deny", reason: "rule" };
  }

  if (isProtectedKind(kind)) {
    return { mode: "ask", reason: "protected" };
  }

  if (policy?.sessionGrantAll) {
    return { mode: "allow", reason: "session" };
  }

  if (explicit) {
    return { mode: explicit, reason: "rule" };
  }

  if (policy) {
    const mode = defaultForTrust(
      policy.trustLevel,
      kind,
      effectiveMediumAllowKinds
    );
    return { mode, reason: "trust" };
  }

  return { mode: "ask", reason: "fallback" };
}

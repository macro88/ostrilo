import type { Authorisation, TrustLevel } from "../types";

export const PROTECTED_KINDS = [1, 9734] as const;
export const DEFAULT_MEDIUM_ALLOW_KINDS = [6, 16, 7, 10002] as const;

const PROTECTED_KIND_SET = new Set<number>(PROTECTED_KINDS);

export function isProtectedKind(kind: number): boolean {
  return PROTECTED_KIND_SET.has(kind);
}

export function getEffectiveMediumAllowKinds(
  kinds: readonly number[]
): number[] {
  return kinds.filter((kind) => !isProtectedKind(kind));
}

export function defaultForTrust(
  trustLevel: TrustLevel,
  kind: number,
  mediumAllowKinds: readonly number[]
): Extract<Authorisation, "allow" | "ask"> {
  if (isProtectedKind(kind)) {
    return "ask";
  }

  if (trustLevel === "high") {
    return "allow";
  }

  if (trustLevel === "medium") {
    return mediumAllowKinds.includes(kind) ? "allow" : "ask";
  }

  return "ask";
}

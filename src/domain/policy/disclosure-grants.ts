import type { Authorisation, OriginPolicy } from "@/domain/types";

/**
 * The shape of an origin's identity-disclosure state, in one place.
 *
 * An `allow` is only in force for the key ids in `identityDisclosureKeyIds`; a
 * `deny` is per origin and covers every key. Every function here returns a new
 * record and leaves the fields it does not own alone.
 */

/** The well-formed ids of a stored key list; anything but an array reads as none. */
export function wellFormedKeyIds(held: unknown): string[] {
  if (!Array.isArray(held)) return [];
  return held.filter((id): id is string => typeof id === "string" && id !== "");
}

/**
 * The key ids an origin may read, as enforced: only an `allow` has any, and a
 * malformed list is read as none.
 */
export function disclosureKeyIds(policy: OriginPolicy | undefined): string[] {
  return policy?.identityDisclosure === "allow"
    ? wellFormedKeyIds(policy.identityDisclosureKeyIds)
    : [];
}

/**
 * What an origin can actually do about disclosure, for surfaces that describe
 * it. An `allow` that names no key discloses nothing, so it reads as `ask`.
 * Settings derives its display from this, so it cannot show a grant that
 * `disclosureFor` would not honour.
 */
export function disclosureState(
  policy: OriginPolicy | undefined
): Authorisation {
  if (policy?.identityDisclosure === "deny") return "deny";
  return disclosureKeyIds(policy).length > 0 ? "allow" : "ask";
}

/**
 * The decision in force for this origin and key, or undefined when none is.
 * `allow` needs the exact key id on the list - a legacy `allow` that names no
 * key, an empty or malformed list, or a grant for another key all answer
 * undefined, which is the prompting state and not consent.
 */
export function disclosureFor(
  policy: OriginPolicy | undefined,
  keyId: string
): Authorisation | undefined {
  if (policy?.identityDisclosure === "deny") return "deny";
  return disclosureKeyIds(policy).includes(keyId) ? "allow" : undefined;
}

/** A refusal or a reset. Either one drops every key grant with it. */
export function withDisclosureDecision(
  policy: OriginPolicy,
  mode: Exclude<Authorisation, "allow">
): OriginPolicy {
  const next = { ...policy, identityDisclosure: mode };
  delete next.identityDisclosureKeyIds;
  return next;
}

/**
 * Add one key to the origin's grants. A list left behind by anything other than
 * an `allow` is stale and is not carried into the new grant.
 */
export function withDisclosureGrant(
  policy: OriginPolicy,
  keyId: string
): OriginPolicy {
  const held = disclosureKeyIds(policy);
  return {
    ...policy,
    identityDisclosure: "allow",
    identityDisclosureKeyIds: held.includes(keyId) ? held : [...held, keyId],
  };
}

/**
 * Remove one key from the origin's grants. The last one going leaves the origin
 * undecided (`ask`), never refused.
 */
export function withoutDisclosureGrant(
  policy: OriginPolicy,
  keyId: string
): OriginPolicy {
  const remaining = disclosureKeyIds(policy).filter((id) => id !== keyId);
  return remaining.length > 0
    ? { ...policy, identityDisclosureKeyIds: remaining }
    : withDisclosureDecision(policy, "ask");
}

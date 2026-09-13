import type { Authorisation, TrustLevel } from "../types";

/**
 * Kinds that always require an explicit, in-the-moment approval.
 *
 * The selection rule is deliberately narrow and statable: a kind is protected
 * when signing it is irreversible, or when the signature functions as a
 * credential outside the user's own Nostr content. Nothing here can be
 * auto-signed by a trust level, an allowlist entry, an explicit `allow` rule,
 * a session grant, or a remembered approval.
 *
 *   1     Short Text Note        Publishes speech attributable to the user.
 *   5     Event Deletion Request Asks relays to destroy existing posts. A
 *                                hostile page can erase a history it never
 *                                created, and the request is irreversible.
 *   9734  Zap Request            Authorises a payment.
 *   22242 Client Authentication  A signed NIP-42 challenge is a relay session
 *                                credential: it authenticates as the user to an
 *                                arbitrary relay, including one that then
 *                                serves their private DM relay list.
 *   27235 HTTP Auth              A signed NIP-98 bearer token for an arbitrary
 *                                HTTP API, with an audience entirely outside
 *                                Nostr. A silent signature here is a silent
 *                                login.
 *
 * Kinds 0 (Profile Metadata), 3 (Contacts) and 4 (legacy DM) are deliberately
 * NOT protected: they are dangerous but reversible, and shipped Settings
 * controls already present them as allow-eligible. They are instead absent from
 * every trust allowlist below, so a trust level can never auto-sign them - only
 * an explicit per-kind rule the user wrote can.
 */
export const PROTECTED_KINDS = [1, 5, 9734, 22242, 27235] as const;

/**
 * Kinds a `high` trust origin may sign without prompting.
 *
 * This is an ALLOWLIST, not the complement of PROTECTED_KINDS. "Allow anything
 * not named" is permanently one protocol revision behind: every new NIP ships
 * as silently signable until the extension notices. An allowlist fails safe by
 * construction - an unrecognised kind prompts.
 *
 * The contents are low-consequence social signals (6 repost, 16 generic repost,
 * 7 reaction) plus the user's own replaceable state that clients must maintain
 * to function (10000 mute list, 10001 pin list, 10002 relay list, 10003
 * bookmark list, 30078 application data).
 */
export const HIGH_TRUST_ALLOW_KINDS = [
  6, 7, 16, 10000, 10001, 10002, 10003, 30078,
] as const;

/**
 * The ceiling for medium trust. A configured `mediumAllowKinds` entry only
 * takes effect if high trust would also permit it, so a polluted or legacy
 * medium allowlist can never grant a kind that high trust itself refuses.
 */
export const MEDIUM_TRUST_CEILING = HIGH_TRUST_ALLOW_KINDS;

/** Shipped default for medium trust. A subset of the high-trust allowlist. */
export const DEFAULT_MEDIUM_ALLOW_KINDS = [6, 16, 7, 10002] as const;

/** Low trust allows nothing without an explicit rule. */
export const LOW_TRUST_ALLOW_KINDS = [] as const;

const PROTECTED_KIND_SET = new Set<number>(PROTECTED_KINDS);
const HIGH_TRUST_ALLOW_KIND_SET = new Set<number>(HIGH_TRUST_ALLOW_KINDS);

/**
 * A kind value that can be compared for set membership at all.
 *
 * `EventKindSchema` rejects fractional and non-finite kinds at the RPC
 * boundary, but these helpers are domain functions callable from anywhere, and
 * `Set.has` is an equality test: `1.0000001` is not `1`, so a fractional kind
 * would silently miss every gate keyed on a kind. Anything that is not a
 * non-negative integer is refused here as well, so a value that reaches the
 * domain by some other path still cannot be auto-signed.
 */
export function isSignableKindValue(kind: number): boolean {
  return Number.isInteger(kind) && kind >= 0;
}

export function isProtectedKind(kind: number): boolean {
  if (!isSignableKindValue(kind)) {
    return false;
  }
  return PROTECTED_KIND_SET.has(kind);
}

/** True when `high` trust may auto-sign this kind. */
export function isHighTrustAllowedKind(kind: number): boolean {
  if (!isSignableKindValue(kind)) {
    return false;
  }
  return HIGH_TRUST_ALLOW_KIND_SET.has(kind);
}

/**
 * Narrow a configured medium allowlist to the kinds that can actually take
 * effect: integral, unprotected, and within the high-trust ceiling.
 */
export function getEffectiveMediumAllowKinds(
  kinds: readonly number[]
): number[] {
  return kinds.filter(
    (kind) =>
      isSignableKindValue(kind) &&
      !isProtectedKind(kind) &&
      isHighTrustAllowedKind(kind)
  );
}

/** Trust levels the engine recognises. Anything else is treated as `low`. */
const TRUST_LEVELS: readonly TrustLevel[] = ["low", "medium", "high"];

/**
 * Coerce a stored trust level to a known one.
 *
 * A record that was hand-edited, written by an older build, or corrupted must
 * not inherit a permissive default, so an unrecognised or missing value reads
 * as `low` - ask for everything.
 */
export function normaliseTrustLevel(value: unknown): TrustLevel {
  return TRUST_LEVELS.includes(value as TrustLevel)
    ? (value as TrustLevel)
    : "low";
}

/**
 * The trust-level default for a kind with no explicit rule.
 *
 * Resolution order: an unusable kind value asks, a protected kind asks, `low`
 * asks, `medium` allows only kinds in both its configured list and the ceiling,
 * `high` allows only allowlisted kinds. Everything else asks.
 */
export function defaultForTrust(
  trustLevel: TrustLevel,
  kind: number,
  mediumAllowKinds: readonly number[]
): Extract<Authorisation, "allow" | "ask"> {
  if (!isSignableKindValue(kind) || isProtectedKind(kind)) {
    return "ask";
  }

  const level = normaliseTrustLevel(trustLevel);

  if (level === "high") {
    return isHighTrustAllowedKind(kind) ? "allow" : "ask";
  }

  if (level === "medium") {
    return mediumAllowKinds.includes(kind) && isHighTrustAllowedKind(kind)
      ? "allow"
      : "ask";
  }

  return "ask";
}

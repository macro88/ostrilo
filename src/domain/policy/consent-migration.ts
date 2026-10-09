import { wellFormedKeyIds } from "./disclosure-grants";
import { resolveSessionTTLMinutes } from "./session-grants";

/**
 * Bumped when a new consent repair is added. A stored settings object at or
 * above this version is left alone, which is what makes re-running a no-op.
 */
export const CONSENT_MIGRATION_VERSION = 2;

/**
 * The consent migration. Versioned: each step runs once, for a settings object
 * stamped below the version that introduced it (repair of trust levels: 1,
 * disclosure binding: 2), and the stamp is written with the result.
 *
 * Steps take one stored origin record - untyped, because it is read from
 * storage that older versions wrote - and return a new one, leaving fields
 * they do not own alone.
 */

/**
 * Undo trust levels the extension, not the user, assigned. Every stored
 * `medium` was assigned by `setPerKindRule` or `setOriginPolicy`: no shipped UI
 * path has ever written a trust level. `high` cannot have come from those paths,
 * so it is left alone, and explicit per-kind rules are untouched. Stored `allow`
 * rules for the newly protected kinds stay in place: evaluation forces a
 * protected kind to `ask` regardless, so they are inert.
 */
function repairFabricatedTrust(origin: any): any {
  const next = { ...origin };
  if (next.trustLevel === "medium") {
    next.trustLevel = "low";
  }
  if (next.sessionGrantAll === true) {
    // Live grant state is session storage only; a persisted `true` is stale.
    delete next.sessionGrantAll;
  }
  return next;
}

/**
 * Bind a disclosure `allow` to the key selected now. An allow granted before
 * disclosure was per key was granted for the identity the user was using, so
 * that key keeps it and no other inherits it. A record already holding a list
 * keeps only its well-formed ids; with no selected key there is nothing honest
 * to bind to. Anything that ends up naming no key is not an allow. It only ever
 * narrows: no step adds an allow or a key to one.
 */
function bindDisclosureToKeys(origin: any, selectedKeyId?: string): any {
  if (origin.identityDisclosure !== "allow") {
    return origin;
  }
  const next = { ...origin };
  const held: unknown = origin.identityDisclosureKeyIds;
  const keyIds =
    held === undefined
      ? selectedKeyId
        ? [selectedKeyId]
        : []
      : wellFormedKeyIds(held);
  if (keyIds.length > 0) {
    next.identityDisclosureKeyIds = keyIds;
  } else {
    next.identityDisclosure = "ask";
    delete next.identityDisclosureKeyIds;
  }
  return next;
}

/**
 * Apply every step a settings object has not had.
 *
 * @returns The migrated settings, or undefined when there is nothing to migrate:
 *   no settings stored yet, or already at `version`.
 */
export function migrateConsentSettings(
  current: any,
  version: number
): any | undefined {
  if (!current || typeof current !== "object") {
    return undefined;
  }
  const stamped =
    typeof current.__consentMigrations === "number"
      ? current.__consentMigrations
      : 0;
  if (stamped >= version) {
    return undefined;
  }

  const selectedKeyId =
    typeof current.selectedKeyId === "string" && current.selectedKeyId
      ? current.selectedKeyId
      : undefined;
  const origins: any[] = Array.isArray(current.origins) ? current.origins : [];
  return {
    ...current,
    origins: origins.map((origin) => {
      if (!origin || typeof origin !== "object") {
        return origin;
      }
      let next = { ...origin };
      if (stamped < 1) next = repairFabricatedTrust(next);
      if (stamped < 2) next = bindDisclosureToKeys(next, selectedKeyId);
      return next;
    }),
    // Part of the trust-level repair, so settings that already had it keep the
    // value they hold.
    ...(stamped < 1 && {
      sessionTTLMinutes: resolveSessionTTLMinutes(current.sessionTTLMinutes),
    }),
    __consentMigrations: version,
  };
}

import {
  Authorisation,
  NostrEventKindAuthorisation,
  OriginPolicy,
  PolicyOutput,
} from "@/domain/types";
import { evaluatePolicy } from "@/domain/policy/evaluate";
import { DEFAULT_MEDIUM_ALLOW_KINDS } from "@/domain/policy/trust-definitions";
import {
  computeGrantExpiry,
  isGrantActive,
  resolveSessionTTLMinutes,
} from "@/domain/policy/session-grants";
import { StorageSuite } from "@/application/ports/storage";
import { SETTINGS_CHANGED_EVENT, defaultSettings } from "./settings.service";

const SETTINGS_KEY = "appSettings";

export class PolicyService {
  private consentMigrationDone = false;
  private consentMigrationInFlight?: Promise<any | undefined>;

  constructor(private storage: StorageSuite) {}

  async loadContext(): Promise<{
    unlocked: boolean;
    mediumAllowKinds: number[];
    policies: OriginPolicy[];
    sessionGrants: Record<string, number>;
  }> {
    const [settings, lock, grants] = await Promise.all([
      this.storage.sync.get<any>(SETTINGS_KEY),
      this.storage.session.get<{ isLocked?: boolean }>("lockState"),
      this.storage.session.get<Record<string, number>>(SESSION_GRANTS_KEY),
    ]);
    // Repair consent data written by the fabricated-trust bug before the first
    // evaluation reads it. Idempotent, and marked so it runs once.
    const migrated = await this.ensureConsentMigration(settings);
    const effective = migrated ?? settings;
    const mediumAllowKinds: number[] = Array.isArray(effective?.mediumAllowKinds)
      ? effective.mediumAllowKinds
      : [...DEFAULT_MEDIUM_ALLOW_KINDS];
    const origins: OriginPolicy[] = effective?.origins ?? [];
    const unlocked: boolean = lock?.isLocked === false;
    return {
      unlocked,
      mediumAllowKinds,
      policies: origins,
      sessionGrants: grants ?? {},
    };
  }

  async evaluate(input: { origin: string; kind: number }): Promise<PolicyOutput> {
    const { unlocked, mediumAllowKinds, policies, sessionGrants } =
      await this.loadContext();
    // Apply an active session grant if one is present and unexpired. There is
    // no "never expires" value: a grant with no future expiry is simply not
    // active.
    const hasGrant = isGrantActive(sessionGrants[input.origin]);
    const patchedPolicies = policies.map((p: OriginPolicy) =>
      p.origin === input.origin ? { ...p, sessionGrantAll: hasGrant } : p
    );
    const result = evaluatePolicy({
      origin: input.origin,
      kind: input.kind,
      unlocked,
      mediumAllowKinds,
      policies: patchedPolicies,
      sessionGrants
    });

    // An explicit remembered DISCLOSURE DENY forces signing back to `ask`.
    //
    // A successful signature returns the public key to the origin inside the
    // signed event, so a remembered per-kind `allow` would silently hand over
    // the identity on every later signature while Settings displayed "identity
    // disclosure: deny". That is the same class of defect as the write-only
    // `sessionGrantAll` switch this consent work exists to remove: a decision
    // the product shows the user but does not enforce.
    //
    // It downgrades to `ask`, never to `deny`. The user refused to hand over
    // their identity for the asking; they did not say the site may never sign
    // anything. Asking is the honest middle.
    if (result.mode === "allow") {
      const policy = policies.find(
        (p: OriginPolicy) => p.origin === input.origin
      );
      if (policy?.identityDisclosure === "deny") {
        return {
          ...result,
          mode: "ask",
          reason: "identity_disclosure_denied",
        };
      }
    }

    return result;
  }

  private async getSettings(): Promise<any> {
    return (
      (await this.storage.sync.get<any>(SETTINGS_KEY)) ?? defaultSettings()
    );
  }

  private async putSettings(next: any): Promise<void> {
    await this.storage.sync.set<any>(SETTINGS_KEY, next);
    // emit event so UI updates
    try {
      const { browser } = await import("wxt/browser");
      browser.runtime.sendMessage({ __event: SETTINGS_CHANGED_EVENT });
    } catch {
      // No listener is the normal case (no extension page open); the
      // broadcast is best-effort and its failure changes nothing here.
    }
  }

  async setOriginPolicy(
    origin: string,
    patch: Partial<OriginPolicy>
  ): Promise<void> {
    const settings = await this.getSettings();
    const origins: OriginPolicy[] = settings.origins ?? [];
    const idx = origins.findIndex((o) => o.origin === origin);
    const now = Math.floor(Date.now() / 1000);
    if (idx >= 0) {
      origins[idx] = {
        ...origins[idx],
        ...patch,
        updatedAt: now,
      } as OriginPolicy;
    } else {
      // A record created as a side effect of a decision starts untrusted. The
      // caller's patch may still set a level the user actually chose.
      origins.push({
        origin,
        trustLevel: "low",
        rules: {},
        updatedAt: now,
        ...patch,
      } as OriginPolicy);
    }
    const next = { ...settings, origins };
    await this.putSettings(next);
  }

  async removeOriginPolicy(origin: string): Promise<void> {
    const settings = await this.getSettings();
    const origins: OriginPolicy[] = (settings.origins ?? []).filter(
      (o: OriginPolicy) => o.origin !== origin
    );
    await this.putSettings({ ...settings, origins });
  }

  /**
   * Record whether an origin may read the user's public key.
   *
   * Per ORIGIN, not per kind - an identity disclosure signs nothing, so there
   * is no kind to key it on. Like `setPerKindRule`, creating a record here
   * grants `low` trust and nothing else: a remembered decision must never also
   * hand the origin a trust level it was not given.
   */
  async setIdentityDisclosure(
    origin: string,
    mode: Authorisation
  ): Promise<void> {
    const settings = await this.getSettings();
    const origins: OriginPolicy[] = settings.origins ?? [];
    const idx = origins.findIndex((o) => o.origin === origin);
    const now = Math.floor(Date.now() / 1000);
    if (idx >= 0) {
      origins[idx] = {
        ...origins[idx],
        identityDisclosure: mode,
        updatedAt: now,
      };
    } else {
      origins.push({
        origin,
        trustLevel: "low",
        rules: {},
        identityDisclosure: mode,
        updatedAt: now,
      });
    }
    await this.putSettings({ ...settings, origins });
  }

  /**
   * The recorded disclosure decision for an origin, or undefined when none has
   * been recorded.
   *
   * UNDEFINED IS NOT CONSENT. It is the prompting state. Nothing infers consent
   * from a stored policy record, a trust level or a per-kind rule: a record is
   * written whenever a signing decision is made, INCLUDING a refusal, so its
   * existence is evidence of a decision about signing and of nothing else.
   */
  async getIdentityDisclosure(
    origin: string
  ): Promise<Authorisation | undefined> {
    const settings = await this.getSettings();
    const origins: OriginPolicy[] = settings.origins ?? [];
    return origins.find((o) => o.origin === origin)?.identityDisclosure;
  }

  async setPerKindRule(
    origin: string,
    kind: number,
    mode: Authorisation
  ): Promise<void> {
    const settings = await this.getSettings();
    const origins: OriginPolicy[] = settings.origins ?? [];
    const idx = origins.findIndex((o) => o.origin === origin);
    const now = Math.floor(Date.now() / 1000);
    if (idx >= 0) {
      const rules: NostrEventKindAuthorisation = { ...origins[idx].rules };
      rules[kind] = mode;
      origins[idx] = { ...origins[idx], rules, updatedAt: now };
    } else {
      // A remembered decision grants exactly the decision the user made. It
      // must never also hand the origin a trust level, which would auto-allow
      // kinds the user was never asked about - including on a remembered DENY.
      origins.push({
        origin,
        trustLevel: "low",
        rules: { [kind]: mode },
        updatedAt: now,
      });
    }
    await this.putSettings({ ...settings, origins });
  }

  /**
   * Live session-grant state: which origins currently hold a grant-everything
   * session, and when each expires.
   *
   * Surfaces must read this rather than the persisted `sessionGrantAll` field
   * on an origin record, which nothing writes `true` to and which therefore
   * always renders a grant as inactive.
   */
  async getSessionGrants(
    now: number = Date.now()
  ): Promise<Array<{ origin: string; expiresAt: number }>> {
    const grants =
      (await this.storage.session.get<Record<string, number>>(
        SESSION_GRANTS_KEY
      )) ?? {};
    return Object.entries(grants)
      .filter(([, expiresAt]) => isGrantActive(expiresAt, now))
      .map(([origin, expiresAt]) => ({ origin, expiresAt }));
  }

  /**
   * Repair consent data written before trust levels stopped being fabricated.
   *
   * Every stored `medium` trust level was assigned by `setPerKindRule` or
   * `setOriginPolicy`, not chosen by a user: no shipped UI path has ever
   * written a trust level. `high` cannot have come from those paths, so it is
   * left alone, and explicit per-kind rules are preserved untouched - the
   * migration changes one field per record.
   *
   * Stored `allow` rules for the newly protected kinds are deliberately left in
   * place: evaluation forces a protected kind to `ask` regardless, so they are
   * inert, and the settings surface shows them as always requiring approval.
   *
   * @param settings - Settings already read by the caller, to avoid a second read.
   * @returns The migrated settings when a write happened, otherwise undefined.
   */
  async runConsentMigration(settings?: any): Promise<any | undefined> {
    const current =
      settings ?? (await this.storage.sync.get<any>(SETTINGS_KEY));

    if (!current || typeof current !== "object") {
      // Nothing stored yet, so nothing to repair.
      return undefined;
    }

    if (
      typeof current.__consentMigrations === "number" &&
      current.__consentMigrations >= CONSENT_MIGRATION_VERSION
    ) {
      return undefined;
    }

    const origins: any[] = Array.isArray(current.origins) ? current.origins : [];
    const migratedOrigins = origins.map((origin) => {
      if (!origin || typeof origin !== "object") {
        return origin;
      }
      const next = { ...origin };
      if (next.trustLevel === "medium") {
        next.trustLevel = "low";
      }
      if (next.sessionGrantAll === true) {
        // Live grant state is session storage only; a persisted `true` is stale.
        delete next.sessionGrantAll;
      }
      return next;
    });

    const next = {
      ...current,
      origins: migratedOrigins,
      sessionTTLMinutes: resolveSessionTTLMinutes(current.sessionTTLMinutes),
      __consentMigrations: CONSENT_MIGRATION_VERSION,
    };

    await this.putSettings(next);
    return next;
  }

  /**
   * Run the consent migration at most once per service instance, before the
   * first policy evaluation reads the data. A failure is logged and retried on
   * the next call rather than wedging evaluation.
   */
  private ensureConsentMigration(settings: any): Promise<any | undefined> {
    if (this.consentMigrationDone) {
      return Promise.resolve(undefined);
    }

    if (!this.consentMigrationInFlight) {
      this.consentMigrationInFlight = this.runConsentMigration(settings)
        .then((migrated) => {
          this.consentMigrationDone = true;
          return migrated;
        })
        .catch((err) => {
          console.error("[PolicyService] Consent migration failed:", err);
          return undefined;
        })
        .finally(() => {
          this.consentMigrationInFlight = undefined;
        });
    }

    return this.consentMigrationInFlight;
  }

  async clearSessionGrant(origin: string): Promise<void> {
    const grants =
      (await this.storage.session.get<Record<string, number>>(
        SESSION_GRANTS_KEY
      )) ?? {};
    if (origin in grants) {
      delete grants[origin];
      await this.storage.session.set<Record<string, number>>(
        SESSION_GRANTS_KEY,
        grants
      );
    }
  }

  async setSessionGrant(origin: string, enabled: boolean): Promise<void> {
    const settings = await this.getSettings();
    const grants =
      (await this.storage.session.get<Record<string, number>>(
        SESSION_GRANTS_KEY
      )) ?? {};
    if (enabled) {
      // A stored TTL of 0 reads as the default lifetime, not as "until lock".
      grants[origin] = computeGrantExpiry(settings.sessionTTLMinutes);
    } else {
      delete grants[origin];
    }
    await this.storage.session.set<Record<string, number>>(
      SESSION_GRANTS_KEY,
      grants
    );
  }
}

const SESSION_GRANTS_KEY = "sessionGrants";

/**
 * Bumped when a new consent repair is added. A stored settings object at or
 * above this version is left alone, which is what makes re-running a no-op.
 */
const CONSENT_MIGRATION_VERSION = 1;

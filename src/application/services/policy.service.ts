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
} from "@/domain/policy/session-grants";
import { migrateConsentSettings } from "@/domain/policy/consent-migration";
import {
  disclosureFor,
  disclosureKeyIds,
  withDisclosureDecision,
  withDisclosureGrant,
  withoutDisclosureGrant,
} from "@/domain/policy/disclosure-grants";
import { StorageSuite } from "@/application/ports/storage";
import { SETTINGS_CHANGED_EVENT, defaultSettings } from "./settings.service";
import { SettingsStore } from "./settings-store";

export class PolicyService {
  private consentMigrationDone = false;
  private consentMigrationInFlight?: Promise<any | undefined>;

  constructor(
    private storage: StorageSuite,
    private store: SettingsStore = new SettingsStore(storage)
  ) {}

  async loadContext(): Promise<{
    unlocked: boolean;
    mediumAllowKinds: number[];
    policies: OriginPolicy[];
    sessionGrants: Record<string, number>;
  }> {
    const [settings, lock, grants] = await Promise.all([
      this.store.read<any>(),
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
      (await this.store.read<any>()) ?? defaultSettings()
    );
  }

  private async putSettings(next: any): Promise<void> {
    await this.store.write<any>(next);
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
    // A disclosure `allow` names a key and a patch does not, so it is not
    // written here: `grantIdentityDisclosure` is the only way to record one, and
    // the key list is never taken from a patch. Any other decision withdraws
    // every key grant with it.
    const { identityDisclosure, ...rest } = patch;
    delete rest.identityDisclosureKeyIds;
    // A record created as a side effect of a decision starts untrusted (see
    // `updateOriginRecord`). The caller's patch may still set a level the user
    // actually chose.
    await this.updateOriginRecord(origin, (record) => {
      const merged = { ...record, ...rest } as OriginPolicy;
      return identityDisclosure === undefined || identityDisclosure === "allow"
        ? merged
        : withDisclosureDecision(merged, identityDisclosure);
    });
  }

  async removeOriginPolicy(origin: string): Promise<void> {
    const settings = await this.getSettings();
    const origins: OriginPolicy[] = (settings.origins ?? []).filter(
      (o: OriginPolicy) => o.origin !== origin
    );
    await this.putSettings({ ...settings, origins });
  }

  /**
   * Record a refused or withdrawn disclosure decision for an origin.
   *
   * A refusal is per ORIGIN: it covers every key, because "this site may not
   * know who I am" is not a statement about one identity. An `allow` is never
   * written here - it belongs to one key; see `grantIdentityDisclosure`.
   * Either decision drops every key grant, so a later revoke-to-ask cannot bring
   * an old grant back.
   *
   * Like `setPerKindRule`, creating a record here grants `low` trust and
   * nothing else: a remembered decision must never also hand the origin a trust
   * level it was not given.
   */
  async setIdentityDisclosure(
    origin: string,
    mode: Exclude<Authorisation, "allow">
  ): Promise<void> {
    await this.updateOriginRecord(origin, (record) =>
      withDisclosureDecision(record, mode)
    );
  }

  /** Allow an origin to read one more key. Replaces a refusal; names no other key. */
  async grantIdentityDisclosure(origin: string, keyId: string): Promise<void> {
    await this.updateOriginRecord(origin, (record) =>
      withDisclosureGrant(record, keyId)
    );
  }

  /**
   * Withdraw one key's grant. The origin goes back to being asked about that
   * key; its grants for other keys stand. A refusal, and a key that holds no
   * grant, are left as they are and nothing is written.
   */
  async revokeIdentityDisclosureKey(
    origin: string,
    keyId: string
  ): Promise<void> {
    const settings = await this.getSettings();
    const record = (settings.origins ?? []).find(
      (o: OriginPolicy) => o.origin === origin
    );
    if (!disclosureKeyIds(record).includes(keyId)) return;
    await this.updateOriginRecord(origin, (current) =>
      withoutDisclosureGrant(current, keyId)
    );
  }

  /**
   * The disclosure decision in force for an origin AND a key, or undefined when
   * none applies.
   *
   * UNDEFINED IS NOT CONSENT. It is the prompting state. Nothing infers consent
   * from a stored policy record, a trust level or a per-kind rule: a record is
   * written whenever a signing decision is made, INCLUDING a refusal, so its
   * existence is evidence of a decision about signing and of nothing else.
   * `disclosureFor` is the one place that decides which key an `allow` covers.
   */
  async getIdentityDisclosure(
    origin: string,
    keyId: string
  ): Promise<Authorisation | undefined> {
    const read = await this.store.read<any>();
    // A legacy `allow` has no key list until migrated, and the answer below is
    // only right for migrated data.
    const settings = (await this.ensureConsentMigration(read)) ?? read;
    const origins: OriginPolicy[] = settings?.origins ?? [];
    return disclosureFor(
      origins.find((o) => o.origin === origin),
      keyId
    );
  }

  /** Read-modify-write of one origin's record, created `low` if absent. */
  private async updateOriginRecord(
    origin: string,
    change: (record: OriginPolicy) => OriginPolicy
  ): Promise<void> {
    const settings = await this.getSettings();
    const origins: OriginPolicy[] = settings.origins ?? [];
    const idx = origins.findIndex((o) => o.origin === origin);
    const now = Math.floor(Date.now() / 1000);
    const current: OriginPolicy =
      idx >= 0
        ? origins[idx]
        : { origin, trustLevel: "low", rules: {}, updatedAt: now };
    const updated = { ...change(current), updatedAt: now };
    if (idx >= 0) {
      origins[idx] = updated;
    } else {
      origins.push(updated);
    }
    await this.putSettings({ ...settings, origins });
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
   * Repair and reshape stored consent data; the steps are in
   * `@/domain/policy/consent-migration`. Versioned and idempotent: the stamp is
   * written with the result, so re-running is a no-op.
   *
   * @param settings - Settings already read by the caller, to avoid a second read.
   * @returns The migrated settings when a write happened, otherwise undefined.
   */
  async runConsentMigration(settings?: any): Promise<any | undefined> {
    const next = migrateConsentSettings(
      settings ?? (await this.store.read<any>()),
      CONSENT_MIGRATION_VERSION
    );
    if (!next) return undefined;
    await this.putSettings(next);
    return next;
  }

  /**
   * Run the consent migration now. The background calls this at worker start,
   * so the "selected key at migration time" is the one the user had when the
   * extension was updated, not whichever they switch to before a site first
   * asks.
   */
  async migrate(): Promise<void> {
    await this.ensureConsentMigration(await this.store.read<any>());
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
const CONSENT_MIGRATION_VERSION = 2;

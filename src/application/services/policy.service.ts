import {
  Authorisation,
  OriginPolicy,
  PolicyContext,
  PolicyInput,
  PolicyOutput,
} from "@/src/domain/types";
import { evaluatePolicy } from "@/src/domain/policy/evaluate";
import { StorageSuite } from "@/src/application/ports/storage";
import { SETTINGS_CHANGED_EVENT, defaultSettings } from "./settings.service";

const SETTINGS_KEY = "appSettings";

export class PolicyService {
  constructor(private storage: StorageSuite) {}

  async loadContext(): Promise<
    PolicyContext & {
      policies: OriginPolicy[];
      sessionGrants: Record<string, number>;
    }
  > {
    const [settings, lock, grants] = await Promise.all([
      this.storage.sync.get<any>(SETTINGS_KEY),
      this.storage.session.get<{ isLocked?: boolean }>("lockState"),
      this.storage.session.get<Record<string, number>>(SESSION_GRANTS_KEY),
    ]);
    const mediumAllowKinds: number[] = settings?.mediumAllowKinds ?? [
      6, 16, 7, 10002,
    ];
    const origins: OriginPolicy[] = settings?.origins ?? [];
    const unlocked: boolean = lock?.isLocked === false;
    return {
      unlocked,
      mediumAllowKinds,
      policies: origins,
      sessionGrants: grants ?? {},
    };
  }

  async evaluate(input: PolicyInput): Promise<PolicyOutput> {
    const { unlocked, mediumAllowKinds, policies, sessionGrants } =
      await this.loadContext();
    // Apply active session grant if present and not expired
    const grant = sessionGrants[input.origin];
    const now = Date.now();
    const hasGrant = typeof grant === "number" && (grant === 0 || grant > now);
    const patchedPolicies = policies.map((p) =>
      p.origin === input.origin ? { ...p, sessionGrantAll: hasGrant } : p
    );
    return evaluatePolicy(
      input,
      { unlocked, mediumAllowKinds },
      patchedPolicies
    );
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
    } catch {}
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
      origins.push({
        origin,
        trustLevel: "medium",
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
      const rules = { ...(origins[idx].rules ?? {}) } as Record<
        number,
        Authorisation
      > as any;
      (rules as any)[kind] = mode;
      origins[idx] = { ...origins[idx], rules, updatedAt: now };
    } else {
      origins.push({
        origin,
        trustLevel: "medium",
        rules: { [kind]: mode } as any,
        updatedAt: now,
      });
    }
    await this.putSettings({ ...settings, origins });
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
    const ttlMin: number = settings.sessionTTLMinutes ?? 0;
    const grants =
      (await this.storage.session.get<Record<string, number>>(
        SESSION_GRANTS_KEY
      )) ?? {};
    if (enabled) {
      const expiresAt = ttlMin > 0 ? Date.now() + ttlMin * 60 * 1000 : 0;
      grants[origin] = expiresAt;
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

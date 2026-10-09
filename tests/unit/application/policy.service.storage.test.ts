import { describe, it, expect, beforeEach, vi } from "vitest";
import { PolicyService } from "@/application/services/policy.service";
import type { StorageSuite } from "@/application/ports/storage";
import type { AppSettingsV1, OriginPolicy } from "@/domain/types";
import { DEFAULT_MEDIUM_ALLOW_KINDS } from "@/domain/policy/trust-definitions";
import { SettingsService } from "@/application/services/settings.service";
import { memoryStorage, testVault, TEST_VAULT_PASSWORD } from "../../helpers/vault";

const A = "https://a.example";
const B = "https://b.example";
const KEY_A = "11111111-1111-4111-8111-111111111111";

function policy(origin: string, overrides: Partial<OriginPolicy> = {}): OriginPolicy {
  return { origin, trustLevel: "low", rules: {}, updatedAt: 1, ...overrides };
}

describe("PolicyService stored-settings handling", () => {
  let storage: StorageSuite;
  let service: PolicyService;

  const stored = async () => storage.local.get<AppSettingsV1 & { __consentMigrations?: number }>("appSettings");

  beforeEach(async () => {
    storage = memoryStorage();
    service = new PolicyService(storage);
    await storage.session.set("lockState", { isLocked: false });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("settings stored without an origins list", () => {
    beforeEach(async () => {
      await storage.local.set("appSettings", { __version: "settings.v1", __consentMigrations: 2 });
    });

    it("creates a low-trust record when setting an origin policy", async () => {
      await service.setOriginPolicy(A, { name: "A" });

      expect((await stored())?.origins).toEqual([
        expect.objectContaining({ origin: A, name: "A", trustLevel: "low", rules: {} }),
      ]);
    });

    it("removes nothing and writes an empty list", async () => {
      await service.removeOriginPolicy(A);
      expect((await stored())?.origins).toEqual([]);
    });

    it("records an identity disclosure decision", async () => {
      await service.setIdentityDisclosure(A, "deny");
      expect(await service.getIdentityDisclosure(A, KEY_A)).toBe("deny");
    });

    it("reports no disclosure decision for an unknown origin", async () => {
      expect(await service.getIdentityDisclosure(A, KEY_A)).toBeUndefined();
    });

    it("records a per-kind rule", async () => {
      await service.setPerKindRule(A, 1, "allow");
      expect((await stored())?.origins?.[0].rules).toEqual({ 1: "allow" });
    });

    it("falls back to the default medium allow-list when none is stored", async () => {
      const context = await service.loadContext();
      expect(context.mediumAllowKinds).toEqual([...DEFAULT_MEDIUM_ALLOW_KINDS]);
      expect(context.policies).toEqual([]);
    });
  });

  it("merges a patch into an existing origin policy and keeps its rules", async () => {
    await service.setPerKindRule(A, 1, "allow");
    vi.spyOn(Date, "now").mockReturnValue(5_000_000_000_000);

    await service.setOriginPolicy(A, { trustLevel: "high" });

    const origins = (await stored())?.origins ?? [];
    expect(origins).toHaveLength(1);
    expect(origins[0]).toMatchObject({
      origin: A,
      trustLevel: "high",
      rules: { 1: "allow" },
      updatedAt: 5_000_000_000,
    });
  });

  it("applies a session grant only to the origin that holds it", async () => {
    await storage.local.set("appSettings", {
      __version: "settings.v1",
      __consentMigrations: 1,
      origins: [policy(A), policy(B)],
    });
    await service.setSessionGrant(B, true);

    const forA = await service.evaluate({ origin: A, kind: 7 });
    const forB = await service.evaluate({ origin: B, kind: 7 });

    expect(forA.mode).toBe("ask");
    expect(forB).toEqual({ mode: "allow", reason: "session" });
  });

  describe("consent migration", () => {
    it("treats a non-array origins field as empty", async () => {
      const migrated = await service.runConsentMigration({ origins: "corrupt" });

      expect(migrated?.origins).toEqual([]);
      expect((await stored())?.origins).toEqual([]);
    });

    it("passes malformed origin entries through untouched", async () => {
      const migrated = await service.runConsentMigration({
        origins: [null, 7, policy(A, { trustLevel: "medium" })],
      });

      expect(migrated?.origins).toEqual([null, 7, policy(A)]);
    });

    describe("a fresh install", () => {
      /** A worker restart: a new service over the same storage, started by `migrate()`. */
      const restartWorker = () => new PolicyService(storage).migrate();

      it("does not migrate again, so an origin the user set to medium is not lowered", async () => {
        // Worker start on a fresh install: no settings yet, so nothing to migrate.
        await service.migrate();
        await testVault(storage).vault.generateKey(TEST_VAULT_PASSWORD, "first");
        await service.setOriginPolicy(A, { trustLevel: "medium" });

        await restartWorker();

        expect((await stored())?.__consentMigrations).toBe(2);
        expect((await stored())?.origins?.[0]).toMatchObject({
          origin: A,
          trustLevel: "medium",
        });
      });

      it("is stamped when settings are first written by the settings page", async () => {
        await service.migrate();
        await new SettingsService(storage).get();
        await service.setOriginPolicy(A, { trustLevel: "medium" });

        await restartWorker();

        expect((await stored())?.origins?.[0].trustLevel).toBe("medium");
      });

      it("still migrates an upgrader whose stored settings carry no stamp, after a key is selected", async () => {
        await storage.local.set("appSettings", {
          __version: "settings.v1",
          origins: [policy(A, { trustLevel: "medium" })],
        });
        const { vault } = testVault(storage);
        await vault.generateKey(TEST_VAULT_PASSWORD, "first");
        expect((await stored())?.__consentMigrations).toBeUndefined();

        await restartWorker();

        expect((await stored())?.__consentMigrations).toBe(2);
        expect((await stored())?.origins?.[0].trustLevel).toBe("low");
      });
    });

    it("keeps evaluating when the migration write fails, and retries on the next call", async () => {
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        origins: [policy(A, { trustLevel: "medium" })],
      });
      const realSet = storage.local.set.bind(storage.local);
      storage.local.set = async () => {
        throw new Error("storage quota");
      };

      const first = await service.evaluate({ origin: A, kind: 1 });

      expect(first.mode).toBe("ask");
      expect((await stored())?.__consentMigrations).toBeUndefined();

      storage.local.set = realSet;
      await service.evaluate({ origin: A, kind: 1 });

      expect((await stored())?.__consentMigrations).toBe(2);
      expect((await stored())?.origins?.[0].trustLevel).toBe("low");
    });
  });

  describe("clearSessionGrant", () => {
    it("writes nothing when no grants are stored", async () => {
      await service.clearSessionGrant(A);
      expect(await storage.session.get("sessionGrants")).toBeUndefined();
    });

    it("leaves other origins' grants in place when the origin holds none", async () => {
      await service.setSessionGrant(B, true);
      const before = await storage.session.get<Record<string, number>>("sessionGrants");

      await service.clearSessionGrant(A);

      expect(await storage.session.get("sessionGrants")).toEqual(before);
      expect(Object.keys(before ?? {})).toEqual([B]);
    });

    it("removes only the named origin's grant", async () => {
      await service.setSessionGrant(A, true);
      await service.setSessionGrant(B, true);

      await service.clearSessionGrant(A);

      const grants = (await service.getSessionGrants()).map((g) => g.origin);
      expect(grants).toEqual([B]);
    });
  });
});

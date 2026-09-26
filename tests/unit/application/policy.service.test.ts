import { describe, it, expect, beforeEach } from "vitest";
import { PolicyService } from "@/application/services/policy.service";
import type { StorageSuite } from "@/application/ports/storage";
import { DEFAULT_MEDIUM_ALLOW_KINDS } from "@/domain/policy/trust-definitions";
import { DEFAULT_SESSION_TTL_MINUTES } from "@/domain/policy/session-grants";

// Simple in-memory storage adapter for testing
function createMemoryStorage(): StorageSuite {
  const maps = {
    local: new Map<string, any>(),
    sync: new Map<string, any>(),
    session: new Map<string, any>(),
  };
  const make = (m: Map<string, any>) => ({
    async get<T>(key: string): Promise<T | undefined> {
      return m.get(key);
    },
    async set<T>(key: string, value: T): Promise<void> {
      m.set(key, value);
    },
    async remove(key: string): Promise<void> {
      m.delete(key);
    },
  });
  return {
    local: make(maps.local),
    sync: make(maps.sync),
    session: make(maps.session),
  };
}

describe("PolicyService", () => {
  let service: PolicyService;
  let storage: StorageSuite;

  beforeEach(() => {
    storage = createMemoryStorage();
    service = new PolicyService(storage);
  });

  describe("loadContext", () => {
    it("loads default context when no settings exist", async () => {
      const context = await service.loadContext();
      
      expect(context.unlocked).toBe(false); // Default locked state
      expect(context.mediumAllowKinds).toEqual([...DEFAULT_MEDIUM_ALLOW_KINDS]); // Default allowed kinds
      expect(context.policies).toEqual([]); // No policies by default
      expect(context.sessionGrants).toEqual({}); // No session grants by default
    });

    it("loads unlocked state from session storage", async () => {
      await storage.session.set("lockState", { isLocked: false });
      
      const context = await service.loadContext();
      expect(context.unlocked).toBe(true);
    });

    it("loads session grants from session storage", async () => {
      const grants = { "example.com": Date.now() + 60000 }; // Grant valid for 1 minute
      await storage.session.set("sessionGrants", grants);
      
      const context = await service.loadContext();
      expect(context.sessionGrants).toEqual(grants);
    });
  });

  describe("policy evaluation", () => {
    it("evaluates policy for unknown origin", async () => {
      const result = await service.evaluate({ origin: "unknown.com", kind: 1 });
      
      expect(result).toBeDefined();
      expect(result.mode).toBeDefined();
      expect(result.reason).toBeDefined();
    });

    it("evaluates policy for known medium-allow kinds", async () => {
      const result = await service.evaluate({ origin: "example.com", kind: 6 }); // Kind 6 is in mediumAllowKinds
      
      expect(result).toBeDefined();
      expect(result.mode).toBeDefined();
    });

    it("does not allow active session grants to bypass protected kinds", async () => {
      await storage.session.set("lockState", { isLocked: false });
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        origins: [
          {
            origin: "example.com",
            trustLevel: "high",
            rules: {},
            updatedAt: 1,
          },
        ],
        mediumAllowKinds: [...DEFAULT_MEDIUM_ALLOW_KINDS],
      });
      await storage.session.set("sessionGrants", {
        "example.com": Date.now() + 60_000,
      });

      const result = await service.evaluate({ origin: "example.com", kind: 1 });

      expect(result).toEqual({ mode: "ask", reason: "protected" });
    });

    it("ignores protected kinds in legacy medium-trust settings", async () => {
      await storage.session.set("lockState", { isLocked: false });
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        origins: [
          {
            origin: "example.com",
            trustLevel: "medium",
            rules: {},
            updatedAt: 1,
          },
        ],
        mediumAllowKinds: [1, 6, 9734],
      });

      const result = await service.evaluate({ origin: "example.com", kind: 9734 });

      expect(result).toEqual({ mode: "ask", reason: "protected" });
    });
  });

  describe("origin policy management", () => {
    it("sets origin policy", async () => {
      await expect(
        service.setOriginPolicy("example.com", { 
          trustLevel: "medium",
          rules: {},
          updatedAt: Date.now()
        })
      ).resolves.not.toThrow();
    });

    it("removes origin policy", async () => {
      await service.setOriginPolicy("example.com", { 
        trustLevel: "medium",
        rules: {},
        updatedAt: Date.now()
      });
      
      await expect(
        service.removeOriginPolicy("example.com")
      ).resolves.not.toThrow();
    });
  });

  describe("remembered decisions never widen authority", () => {
    async function unlock(storage: StorageSuite) {
      await storage.session.set("lockState", { isLocked: false });
      // The consent migration must not be what makes these pass: with the
      // marker set it is a no-op, so the write path is on its own.
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        origins: [],
        __consentMigrations: 1,
      });
    }

    it("stores only the deny rule when the user denies and remembers", async () => {
      await unlock(storage);

      await service.setPerKindRule("https://example.com", 1, "deny");

      const stored = await storage.local.get<any>("appSettings");
      const record = stored.origins.find(
        (o: any) => o.origin === "https://example.com"
      );
      expect(record.rules).toEqual({ 1: "deny" });
      // The bug this fences: the record used to be created with
      // trustLevel "medium", which auto-allows 6, 16, 7 and 10002. Saying no
      // to a note handed the site silent reposts, reactions and relay-list
      // writes.
      expect(record.trustLevel).toBe("low");
    });

    it("leaves every medium-default kind asking after a remembered deny", async () => {
      await unlock(storage);
      await service.setPerKindRule("https://example.com", 1, "deny");

      for (const kind of DEFAULT_MEDIUM_ALLOW_KINDS) {
        const out = await service.evaluate({
          origin: "https://example.com",
          kind,
        });
        expect(
          out.mode,
          `SECURITY REGRESSION: deny-and-remember on kind 1 granted silent signing of kind ${kind}.`
        ).toBe("ask");
      }
    });

    it("keeps a remembered allow scoped to the approved kind", async () => {
      await unlock(storage);
      await service.setPerKindRule("https://example.com", 10002, "allow");

      const allowed = await service.evaluate({
        origin: "https://example.com",
        kind: 10002,
      });
      expect(allowed).toEqual({ mode: "allow", reason: "rule" });

      for (const kind of [6, 7, 16, 30078]) {
        const out = await service.evaluate({
          origin: "https://example.com",
          kind,
        });
        expect(out.mode).toBe("ask");
      }
    });

    it("preserves a trust level the user actually chose", async () => {
      await unlock(storage);
      await service.setOriginPolicy("https://example.com", {
        trustLevel: "high",
      });

      await service.setPerKindRule("https://example.com", 5, "deny");

      const stored = await storage.local.get<any>("appSettings");
      const record = stored.origins.find(
        (o: any) => o.origin === "https://example.com"
      );
      expect(record.trustLevel).toBe("high");
      expect(record.rules).toEqual({ 5: "deny" });
    });

    it("creates an untrusted record when setOriginPolicy supplies no level", async () => {
      await service.setOriginPolicy("https://example.com", { name: "Example" });

      const stored = await storage.local.get<any>("appSettings");
      const record = stored.origins.find(
        (o: any) => o.origin === "https://example.com"
      );
      expect(record.trustLevel).toBe("low");
    });
  });

  describe("consent migration", () => {
    it("downgrades an extension-assigned medium trust level", async () => {
      await storage.session.set("lockState", { isLocked: false });
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        origins: [
          {
            origin: "https://example.com",
            trustLevel: "medium",
            rules: { 1: "deny" },
            name: "Example",
            updatedAt: 42,
            sessionGrantAll: true,
          },
        ],
        mediumAllowKinds: [...DEFAULT_MEDIUM_ALLOW_KINDS],
        sessionTTLMinutes: 0,
      });

      await service.loadContext();

      const stored = await storage.local.get<any>("appSettings");
      const record = stored.origins[0];
      expect(record.trustLevel).toBe("low");
      // One field changes. Everything the user actually chose survives.
      expect(record.rules).toEqual({ 1: "deny" });
      expect(record.name).toBe("Example");
      expect(record.updatedAt).toBe(42);
      // Live grant state lives in session storage; the persisted flag is stale.
      expect(record.sessionGrantAll).toBeUndefined();
      expect(stored.sessionTTLMinutes).toBe(DEFAULT_SESSION_TTL_MINUTES);
      expect(stored.__consentMigrations).toBe(1);

      const out = await service.evaluate({
        origin: "https://example.com",
        kind: 7,
      });
      expect(out.mode).toBe("ask");
    });

    it("leaves a user-set high trust level alone", async () => {
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        origins: [
          { origin: "https://a.example", trustLevel: "high", rules: {}, updatedAt: 1 },
          { origin: "https://b.example", trustLevel: "low", rules: {}, updatedAt: 1 },
        ],
      });

      await service.loadContext();

      const stored = await storage.local.get<any>("appSettings");
      expect(stored.origins[0].trustLevel).toBe("high");
      expect(stored.origins[1].trustLevel).toBe("low");
    });

    it("is idempotent", async () => {
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        origins: [
          {
            origin: "https://example.com",
            trustLevel: "medium",
            rules: { 1: "deny" },
            updatedAt: 42,
          },
        ],
      });

      await service.runConsentMigration();
      const afterFirst = await storage.local.get<any>("appSettings");

      // A fresh service instance, so the in-memory guard cannot be what makes
      // the second run a no-op.
      const second = new PolicyService(storage);
      const result = await second.runConsentMigration();

      expect(result).toBeUndefined();
      expect(await storage.local.get<any>("appSettings")).toEqual(afterFirst);
    });

    it("leaves stored allow rules for newly protected kinds in place but inert", async () => {
      await storage.session.set("lockState", { isLocked: false });
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        origins: [
          {
            origin: "https://example.com",
            trustLevel: "medium",
            rules: { 5: "allow", 27235: "allow" },
            updatedAt: 1,
          },
        ],
      });

      await service.loadContext();

      const stored = await storage.local.get<any>("appSettings");
      expect(stored.origins[0].rules).toEqual({ 5: "allow", 27235: "allow" });

      for (const kind of [5, 27235]) {
        const out = await service.evaluate({
          origin: "https://example.com",
          kind,
        });
        expect(out).toEqual({ mode: "ask", reason: "protected" });
      }
    });
  });

  describe("per-kind rules", () => {
    it("sets per-kind rule", async () => {
      await expect(
        service.setPerKindRule("example.com", 1, "allow")
      ).resolves.not.toThrow();
    });

    it("stores remembered allow rules and lets users change them", async () => {
      await service.setPerKindRule("https://primal.net", 10002, "allow");

      const afterAllow = await storage.local.get<any>("appSettings");
      expect(afterAllow.origins).toEqual([
        expect.objectContaining({
          origin: "https://primal.net",
          rules: { 10002: "allow" },
        }),
      ]);

      await service.setPerKindRule("https://primal.net", 10002, "ask");
      const afterAsk = await storage.local.get<any>("appSettings");
      expect(afterAsk.origins[0].rules[10002]).toBe("ask");

      await service.setPerKindRule("https://primal.net", 10002, "deny");
      const afterDeny = await storage.local.get<any>("appSettings");
      expect(afterDeny.origins[0].rules[10002]).toBe("deny");
    });
  });

  describe("session grants", () => {
    it("sets session grant", async () => {
      await expect(
        service.setSessionGrant("example.com", true)
      ).resolves.not.toThrow();
    });

    it("clears session grant", async () => {
      await service.setSessionGrant("example.com", true);
      
      await expect(
        service.clearSessionGrant("example.com")
      ).resolves.not.toThrow();
    });

    it("writes a bounded future expiry even when the stored TTL is zero", async () => {
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        origins: [],
        sessionTTLMinutes: 0,
      });

      const before = Date.now();
      await service.setSessionGrant("https://example.com", true);

      const grants = await storage.session.get<Record<string, number>>(
        "sessionGrants"
      );
      const expiresAt = grants!["https://example.com"];
      // The old behaviour stored 0 and read it as "active until lock".
      expect(expiresAt).not.toBe(0);
      expect(expiresAt).toBeGreaterThan(before);
      expect(expiresAt).toBeLessThanOrEqual(
        before + DEFAULT_SESSION_TTL_MINUTES * 60 * 1000 + 1000
      );
    });

    it("does not allow on an expired grant", async () => {
      await storage.session.set("lockState", { isLocked: false });
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        origins: [
          {
            origin: "https://example.com",
            trustLevel: "low",
            rules: {},
            updatedAt: 1,
          },
        ],
      });
      await storage.session.set("sessionGrants", {
        "https://example.com": Date.now() - 60_000,
      });

      const out = await service.evaluate({
        origin: "https://example.com",
        kind: 7,
      });
      expect(out.reason).not.toBe("session");
      expect(out.mode).toBe("ask");
    });

    it("does not allow on a legacy zero-expiry grant", async () => {
      await storage.session.set("lockState", { isLocked: false });
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        origins: [
          {
            origin: "https://example.com",
            trustLevel: "low",
            rules: {},
            updatedAt: 1,
          },
        ],
      });
      // Written by the pre-change setSessionGrant with sessionTTLMinutes 0.
      await storage.session.set("sessionGrants", { "https://example.com": 0 });

      const out = await service.evaluate({
        origin: "https://example.com",
        kind: 7,
      });
      expect(out.reason).not.toBe("session");
      expect(out.mode).toBe("ask");
    });

    it("still allows an unprotected kind while the grant is live", async () => {
      await storage.session.set("lockState", { isLocked: false });
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        origins: [
          {
            origin: "https://example.com",
            trustLevel: "low",
            rules: {},
            updatedAt: 1,
          },
        ],
      });
      await storage.session.set("sessionGrants", {
        "https://example.com": Date.now() + 60_000,
      });

      const out = await service.evaluate({
        origin: "https://example.com",
        kind: 7,
      });
      expect(out).toEqual({ mode: "allow", reason: "session" });
    });

    it("reports only live grants through getSessionGrants", async () => {
      const now = Date.now();
      await storage.session.set("sessionGrants", {
        "https://live.example": now + 60_000,
        "https://expired.example": now - 60_000,
        "https://legacy.example": 0,
      });

      const grants = await service.getSessionGrants(now);

      expect(grants).toEqual([
        { origin: "https://live.example", expiresAt: now + 60_000 },
      ]);
    });
  });
});

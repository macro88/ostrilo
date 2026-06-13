import { describe, it, expect, beforeEach } from "vitest";
import { PolicyService } from "@/application/services/policy.service";
import type { StorageSuite } from "@/application/ports/storage";
import { DEFAULT_MEDIUM_ALLOW_KINDS } from "@/domain/policy/trust-definitions";

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
      await storage.sync.set("appSettings", {
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
      await storage.sync.set("appSettings", {
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

  describe("per-kind rules", () => {
    it("sets per-kind rule", async () => {
      await expect(
        service.setPerKindRule("example.com", 1, "allow")
      ).resolves.not.toThrow();
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
  });
});

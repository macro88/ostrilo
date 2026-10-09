import { beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyService } from "@/application/services/policy.service";
import type { StorageSuite } from "@/application/ports/storage";
import { memoryStorage } from "../../helpers/vault";

const SITE = "https://site.example";
const OTHER = "https://other.example";
const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";
const KEY_C = "33333333-3333-4333-8333-333333333333";

type Stored = {
  __consentMigrations?: number;
  selectedKeyId?: string;
  origins: Array<Record<string, unknown>>;
  [field: string]: unknown;
};

describe("per-key identity disclosure", () => {
  let storage: StorageSuite;
  let service: PolicyService;

  const stored = async () => storage.local.get<Stored>("appSettings");
  const record = async (origin = SITE) =>
    (await stored())?.origins.find((o) => o.origin === origin);

  beforeEach(async () => {
    storage = memoryStorage();
    service = new PolicyService(storage);
    await storage.local.set("appSettings", {
      __version: "settings.v1",
      origins: [],
      __consentMigrations: 2,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("granting", () => {
    it("answers allow for the granted key and nothing for any other", async () => {
      await service.grantIdentityDisclosure(SITE, KEY_A);

      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBe("allow");
      expect(await service.getIdentityDisclosure(SITE, KEY_B)).toBeUndefined();
      expect(await service.getIdentityDisclosure(OTHER, KEY_A)).toBeUndefined();
    });

    it("holds several keys at once and does not duplicate one", async () => {
      await service.grantIdentityDisclosure(SITE, KEY_A);
      await service.grantIdentityDisclosure(SITE, KEY_B);
      await service.grantIdentityDisclosure(SITE, KEY_A);

      expect((await record())?.identityDisclosureKeyIds).toEqual([KEY_A, KEY_B]);
      expect(await service.getIdentityDisclosure(SITE, KEY_B)).toBe("allow");
    });

    it("creates a low-trust record with no rules, granting nothing else", async () => {
      await service.grantIdentityDisclosure(SITE, KEY_A);

      expect(await record()).toMatchObject({
        origin: SITE,
        trustLevel: "low",
        rules: {},
        identityDisclosure: "allow",
      });
    });

    it("leaves trust, name and rules of an existing record alone", async () => {
      await service.setOriginPolicy(SITE, { name: "Site", trustLevel: "high" });
      await service.setPerKindRule(SITE, 7, "deny");

      await service.grantIdentityDisclosure(SITE, KEY_A);

      expect(await record()).toMatchObject({
        name: "Site",
        trustLevel: "high",
        rules: { 7: "deny" },
      });
    });

    it("replaces a refusal, because the user has just decided the other way", async () => {
      await service.setIdentityDisclosure(SITE, "deny");
      await service.grantIdentityDisclosure(SITE, KEY_A);

      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBe("allow");
    });

    it("does not revive a stale key list left behind by a non-allow state", async () => {
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        __consentMigrations: 2,
        origins: [
          {
            origin: SITE,
            trustLevel: "low",
            rules: {},
            updatedAt: 1,
            identityDisclosure: "ask",
            identityDisclosureKeyIds: [KEY_A],
          },
        ],
      });

      await service.grantIdentityDisclosure(SITE, KEY_B);

      expect((await record())?.identityDisclosureKeyIds).toEqual([KEY_B]);
      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBeUndefined();
    });
  });

  describe("a refusal is per origin", () => {
    it("covers every key", async () => {
      await service.setIdentityDisclosure(SITE, "deny");

      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBe("deny");
      expect(await service.getIdentityDisclosure(SITE, KEY_B)).toBe("deny");
    });

    it("drops every key grant, so revoking the refusal does not bring them back", async () => {
      await service.grantIdentityDisclosure(SITE, KEY_A);
      await service.setIdentityDisclosure(SITE, "deny");
      await service.setIdentityDisclosure(SITE, "ask");

      expect((await record())?.identityDisclosureKeyIds).toBeUndefined();
      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBeUndefined();
    });
  });

  describe("revoking one grant", () => {
    it("asks again for that key and leaves the others standing", async () => {
      await service.grantIdentityDisclosure(SITE, KEY_A);
      await service.grantIdentityDisclosure(SITE, KEY_B);

      await service.revokeIdentityDisclosureKey(SITE, KEY_A);

      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBeUndefined();
      expect(await service.getIdentityDisclosure(SITE, KEY_B)).toBe("allow");
    });

    it("leaves the origin undecided, not refused, once the last grant goes", async () => {
      await service.grantIdentityDisclosure(SITE, KEY_A);

      await service.revokeIdentityDisclosureKey(SITE, KEY_A);

      expect(await record()).toMatchObject({ identityDisclosure: "ask" });
      expect((await record())?.identityDisclosureKeyIds).toBeUndefined();
    });

    it("is a no-op for a key that holds no grant, and writes nothing", async () => {
      await service.grantIdentityDisclosure(SITE, KEY_A);
      const before = JSON.stringify(await stored());

      await service.revokeIdentityDisclosureKey(SITE, KEY_B);
      await service.revokeIdentityDisclosureKey(OTHER, KEY_A);

      expect(JSON.stringify(await stored())).toBe(before);
    });

    it("never turns a refusal into anything else", async () => {
      await service.setIdentityDisclosure(SITE, "deny");

      await service.revokeIdentityDisclosureKey(SITE, KEY_A);

      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBe("deny");
    });
  });

  describe("a patch cannot grant disclosure", () => {
    it("ignores an allow and a key list in a patch", async () => {
      await service.setOriginPolicy(SITE, {
        identityDisclosure: "allow",
        identityDisclosureKeyIds: [KEY_A],
      });

      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBeUndefined();
      expect((await record())?.identityDisclosureKeyIds).toBeUndefined();
    });

    it("does not widen existing grants through a key list in a patch", async () => {
      await service.grantIdentityDisclosure(SITE, KEY_A);

      await service.setOriginPolicy(SITE, {
        name: "Renamed",
        identityDisclosureKeyIds: [KEY_A, KEY_B],
      });

      expect((await record())?.identityDisclosureKeyIds).toEqual([KEY_A]);
      expect((await record())?.name).toBe("Renamed");
    });

    it("withdraws every grant when the patch sets ask or deny", async () => {
      await service.grantIdentityDisclosure(SITE, KEY_A);

      await service.setOriginPolicy(SITE, { identityDisclosure: "ask" });

      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBeUndefined();
      expect((await record())?.identityDisclosureKeyIds).toBeUndefined();
    });
  });

  describe("answers only what the stored data proves", () => {
    it.each([
      ["a legacy allow with no key list", { identityDisclosure: "allow" }],
      ["an allow with an empty list", { identityDisclosure: "allow", identityDisclosureKeyIds: [] }],
      ["an allow with a non-array list", { identityDisclosure: "allow", identityDisclosureKeyIds: KEY_A }],
      ["a list under ask", { identityDisclosure: "ask", identityDisclosureKeyIds: [KEY_A] }],
      ["a list with no decision", { identityDisclosureKeyIds: [KEY_A] }],
    ])("does not disclose on %s", async (_name, fields) => {
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        __consentMigrations: 2,
        origins: [{ origin: SITE, trustLevel: "low", rules: {}, updatedAt: 1, ...fields }],
      });

      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBeUndefined();
    });
  });

  describe("migration of stored grants", () => {
    const legacy = (fields: Record<string, unknown>, extra: Partial<Stored> = {}) =>
      storage.local.set("appSettings", {
        __version: "settings.v1",
        selectedKeyId: KEY_A,
        origins: [
          { origin: SITE, trustLevel: "low", rules: {}, updatedAt: 1, ...fields },
        ],
        ...extra,
      });

    it("binds an existing allow to the key selected when it runs, and to no other", async () => {
      await legacy({ identityDisclosure: "allow" });

      await service.migrate();

      expect((await record())?.identityDisclosureKeyIds).toEqual([KEY_A]);
      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBe("allow");
      expect(await service.getIdentityDisclosure(SITE, KEY_B)).toBeUndefined();
      expect((await stored())?.__consentMigrations).toBe(2);
    });

    it("binds to the key selected at the time, not a key chosen afterwards", async () => {
      await legacy({ identityDisclosure: "allow" });
      await service.migrate();

      const settings = (await stored())!;
      await storage.local.set("appSettings", { ...settings, selectedKeyId: KEY_B });
      const fresh = new PolicyService(storage);

      expect(await fresh.getIdentityDisclosure(SITE, KEY_B)).toBeUndefined();
      expect(await fresh.getIdentityDisclosure(SITE, KEY_A)).toBe("allow");
    });

    it("migrates on first read when the worker-start run has not happened", async () => {
      await legacy({ identityDisclosure: "allow" });

      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBe("allow");
      expect(await service.getIdentityDisclosure(SITE, KEY_B)).toBeUndefined();
    });

    it("drops an allow to ask when no key is selected", async () => {
      await legacy({ identityDisclosure: "allow" }, { selectedKeyId: undefined });

      await service.migrate();

      expect((await record())?.identityDisclosure).toBe("ask");
      expect((await record())?.identityDisclosureKeyIds).toBeUndefined();
      expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBeUndefined();
    });

    it("treats an empty selected key id as no selection", async () => {
      await legacy({ identityDisclosure: "allow" }, { selectedKeyId: "" });

      await service.migrate();

      expect((await record())?.identityDisclosure).toBe("ask");
    });

    it("never widens: refusals, asks and undecided origins are left as they are", async () => {
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        selectedKeyId: KEY_A,
        origins: [
          { origin: "https://deny.example", trustLevel: "low", rules: {}, updatedAt: 1, identityDisclosure: "deny" },
          { origin: "https://ask.example", trustLevel: "low", rules: {}, updatedAt: 1, identityDisclosure: "ask" },
          { origin: "https://none.example", trustLevel: "low", rules: { 7: "allow" }, updatedAt: 1 },
        ],
      });

      await service.migrate();

      const origins = (await stored())!.origins;
      expect(origins[0]).toMatchObject({ identityDisclosure: "deny" });
      expect(origins[1]).toMatchObject({ identityDisclosure: "ask" });
      expect(origins[2].identityDisclosure).toBeUndefined();
      for (const origin of origins) {
        expect(origin.identityDisclosureKeyIds).toBeUndefined();
      }
    });

    it("keeps only well-formed ids of a list it finds, and drops an empty result to ask", async () => {
      await storage.local.set("appSettings", {
        __version: "settings.v1",
        selectedKeyId: KEY_C,
        origins: [
          { origin: SITE, trustLevel: "low", rules: {}, updatedAt: 1, identityDisclosure: "allow", identityDisclosureKeyIds: [KEY_A, 7, "", null] },
          { origin: OTHER, trustLevel: "low", rules: {}, updatedAt: 1, identityDisclosure: "allow", identityDisclosureKeyIds: "not-a-list" },
        ],
      });

      await service.migrate();

      const [kept, dropped] = (await stored())!.origins;
      expect(kept.identityDisclosureKeyIds).toEqual([KEY_A]);
      expect(dropped.identityDisclosure).toBe("ask");
      expect(dropped.identityDisclosureKeyIds).toBeUndefined();
    });

    it("preserves unknown fields on records and on the settings object", async () => {
      await legacy(
        { identityDisclosure: "allow", futureField: { nested: [1, 2] }, name: "Site" },
        { futureSetting: "kept" }
      );

      await service.migrate();

      expect(await record()).toMatchObject({
        futureField: { nested: [1, 2] },
        name: "Site",
        trustLevel: "low",
        updatedAt: 1,
      });
      expect((await stored())?.futureSetting).toBe("kept");
    });

    it("is idempotent, including across a fresh service instance", async () => {
      await legacy({ identityDisclosure: "allow" });
      await service.migrate();
      const afterFirst = await stored();

      const second = new PolicyService(storage);
      await second.migrate();
      const result = await second.runConsentMigration();

      expect(result).toBeUndefined();
      expect(await stored()).toEqual(afterFirst);
    });

    it("does not bind a second time after the user switched keys", async () => {
      await legacy({ identityDisclosure: "allow" });
      await service.migrate();
      await service.revokeIdentityDisclosureKey(SITE, KEY_A);
      const settings = (await stored())!;
      await storage.local.set("appSettings", { ...settings, selectedKeyId: KEY_B });

      await new PolicyService(storage).migrate();

      expect(await new PolicyService(storage).getIdentityDisclosure(SITE, KEY_B)).toBeUndefined();
    });

    it("runs the key-binding step for settings stamped by the earlier migration", async () => {
      await legacy(
        { identityDisclosure: "allow" },
        { __consentMigrations: 1 }
      );

      await service.migrate();

      expect((await record())?.identityDisclosureKeyIds).toEqual([KEY_A]);
      expect((await stored())?.__consentMigrations).toBe(2);
    });

    it("does not redo the earlier repair for settings that already had it", async () => {
      await legacy(
        { trustLevel: "medium", identityDisclosure: "allow" },
        { __consentMigrations: 1 }
      );

      await service.migrate();

      // A `medium` stamped after step 1 was chosen by the user, not fabricated.
      expect((await record())?.trustLevel).toBe("medium");
    });

    it("writes nothing when there are no settings yet", async () => {
      const empty = memoryStorage();

      await new PolicyService(empty).migrate();

      expect(await empty.local.get("appSettings")).toBeUndefined();
    });
  });
});

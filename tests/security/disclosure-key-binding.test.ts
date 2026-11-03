import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: { getURL: (path: string) => `chrome-extension://ostrilo-test${path}` },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
  },
}));

import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";
import { PolicyService } from "@/application/services/policy.service";
import { OriginPolicyPatchSchema } from "@/infrastructure/validation/schemas";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { KeyRecord } from "@/domain/types";
import { memoryStorage } from "../helpers/vault";
import {
  SECRET_ONE,
  SECRET_TWO,
  STRONG_PASSWORD,
  realContext,
} from "../unit/infrastructure/messaging-fixture";

/**
 * SEC-026: a site consented to learn ONE identity. Switching keys must not hand
 * it the next one.
 *
 * Disclosure is not secrecy - the npub is public - but it is linkage, and the
 * user's choice of which identity a site may tie to their browsing is the thing
 * consent protects. A grant that followed the selection would turn "I let this
 * site know my main key" into "this site is told whichever key I am using".
 */

const SITE = "https://site.example";
const KEY_A = "a1111111-1111-4111-8111-111111111111";
const KEY_B = "b2222222-2222-4222-8222-222222222222";

const record = (fields: Record<string, unknown>) => ({
  origin: SITE,
  trustLevel: "low",
  rules: {},
  updatedAt: 1,
  ...fields,
});

/** Every stored shape that could be read as consent, for A, by B's reader. */
const SHAPES: Array<[string, Record<string, unknown>]> = [
  ["a grant for A", { identityDisclosure: "allow", identityDisclosureKeyIds: [KEY_A] }],
  ["a grant for A and a third key", { identityDisclosure: "allow", identityDisclosureKeyIds: [KEY_A, "33333333-3333-4333-8333-333333333333"] }],
  ["a legacy allow that names no key", { identityDisclosure: "allow" }],
  ["an allow with an empty list", { identityDisclosure: "allow", identityDisclosureKeyIds: [] }],
  ["B's id in a different case", { identityDisclosure: "allow", identityDisclosureKeyIds: [KEY_B.toUpperCase()] }],
  ["a prefix of B's id", { identityDisclosure: "allow", identityDisclosureKeyIds: [KEY_B.slice(0, 8)] }],
  ["B's id as a non-list value", { identityDisclosure: "allow", identityDisclosureKeyIds: { 0: KEY_B } }],
  ["B's id under ask", { identityDisclosure: "ask", identityDisclosureKeyIds: [KEY_B] }],
  ["a per-kind allow and high trust", { trustLevel: "high", rules: { 7: "allow", 1: "allow" } }],
];

describe("a stored grant never answers for a key it does not name", () => {
  it.each(SHAPES)("%s does not disclose B", async (_name, fields) => {
    const storage = memoryStorage();
    await storage.local.set("appSettings", {
      __version: "settings.v1",
      selectedKeyId: KEY_A,
      origins: [record(fields)],
    });
    const service = new PolicyService(storage);

    // Both before and after the migration has had its chance to reshape it.
    expect(await service.getIdentityDisclosure(SITE, KEY_B)).not.toBe("allow");
    await service.migrate();
    expect(await new PolicyService(storage).getIdentityDisclosure(SITE, KEY_B)).not.toBe("allow");
  });

  it("a grant written through the service names exactly the key it was given", async () => {
    const service = new PolicyService(memoryStorage());
    await service.grantIdentityDisclosure(SITE, KEY_A);

    expect(await service.getIdentityDisclosure(SITE, KEY_A)).toBe("allow");
    expect(await service.getIdentityDisclosure(SITE, KEY_B)).toBeUndefined();
    expect(await service.getIdentityDisclosure(SITE, "")).toBeUndefined();
  });
});

describe("a grant cannot be planted without choosing a key", () => {
  it("the origin patch cannot carry a key list", () => {
    const parsed = OriginPolicyPatchSchema.safeParse({
      identityDisclosureKeyIds: [KEY_B],
    });
    expect(parsed.success).toBe(false);
  });

  it("the service ignores a key list and an allow in a patch", async () => {
    const service = new PolicyService(memoryStorage());

    await service.setOriginPolicy(SITE, {
      identityDisclosure: "allow",
      identityDisclosureKeyIds: [KEY_B],
    });

    expect(await service.getIdentityDisclosure(SITE, KEY_B)).toBeUndefined();
  });
});

describe("migration only ever narrows a grant", () => {
  it("leaves no key with an allow that it did not have before", async () => {
    const keys = [KEY_A, KEY_B, "33333333-3333-4333-8333-333333333333"];
    for (const [name, fields] of SHAPES) {
      for (const selectedKeyId of [KEY_A, undefined]) {
        const storage = memoryStorage();
        await storage.local.set("appSettings", {
          __version: "settings.v1",
          selectedKeyId,
          origins: [record(fields)],
        });
        // What the shape allowed before: a legacy allow answered for every key.
        const before = fields.identityDisclosure === "allow" ? keys : [];
        const service = new PolicyService(storage);

        await service.migrate();

        for (const key of keys) {
          const after = (await service.getIdentityDisclosure(SITE, key)) === "allow";
          expect(
            !after || before.includes(key),
            `${name}: migration widened a grant to ${key}`
          ).toBe(true);
        }
      }
    }
  });

  it("binds a legacy allow to the selected key and to no more than that one", async () => {
    const storage = memoryStorage();
    await storage.local.set("appSettings", {
      __version: "settings.v1",
      selectedKeyId: KEY_A,
      origins: [record({ identityDisclosure: "allow" })],
    });
    const service = new PolicyService(storage);
    await service.migrate();

    const allowed = [];
    for (const key of [KEY_A, KEY_B, "33333333-3333-4333-8333-333333333333"]) {
      if ((await service.getIdentityDisclosure(SITE, key)) === "allow") allowed.push(key);
    }
    expect(allowed).toEqual([KEY_A]);
  });
});

describe("getPublicKey after a key switch, through the handler", () => {
  let queue: ApprovalQueueService;
  let context: ServiceContext;
  let nostr: NostrRpcHandler;
  let keyA: KeyRecord;
  let keyB: KeyRecord;

  beforeEach(async () => {
    queue = new ApprovalQueueService();
    const built = realContext();
    context = built.context;
    await built.vault.importKey(SECRET_ONE, STRONG_PASSWORD, "Main");
    await built.vault.importKey(SECRET_TWO, STRONG_PASSWORD, "Work");
    await built.vault.unlock(STRONG_PASSWORD);
    [keyA, keyB] = await built.vault.listKeys();
    nostr = new NostrRpcHandler(queue, async () => 1);
  });

  afterEach(() => {
    queue.clear();
  });

  it("returns no key to a site that consented only for the other one", async () => {
    await context.vault.selectKey(keyA.id);
    await context.policy.grantIdentityDisclosure(SITE, keyA.id);
    await context.vault.selectKey(keyB.id);

    const pending = nostr.handleRequest({ type: "nostr.getPublicKey", origin: SITE }, context);
    await vi.waitFor(() => expect(queue.count()).toBe(1));
    const prompt = queue.getNextPending()!;
    expect(prompt.signingKeyId).toBe(keyB.id);

    queue.clear();
    const res = await pending;
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(keyB.pubkey);
  });

  it("answers only the granted key's pubkey, whatever the selection is when it is asked", async () => {
    await context.policy.grantIdentityDisclosure(SITE, keyA.id);

    for (const selected of [keyA, keyB, keyA]) {
      await context.vault.selectKey(selected.id);
      const pending = nostr.handleRequest({ type: "nostr.getPublicKey", origin: SITE }, context);
      if (selected.id === keyA.id) {
        const res = await pending;
        expect(res.ok && (res.data as { pubkey: string }).pubkey).toBe(keyA.pubkey);
      } else {
        await vi.waitFor(() => expect(queue.count()).toBe(1));
        queue.clear();
        expect(JSON.stringify(await pending)).not.toContain(keyB.pubkey);
      }
    }
  });
});

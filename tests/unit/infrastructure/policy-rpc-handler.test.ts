import { beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyRpcHandler } from "@/infrastructure/messaging/handlers/policy-rpc";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { RpcRequest } from "@/infrastructure/messaging/rpc";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { PolicyService } from "@/application/services/policy.service";
import type { OriginPolicy } from "@/domain/types";
import type { StorageSuite } from "@/application/ports/storage";
import {
  SECRET_ONE,
  SECRET_TWO,
  STRONG_PASSWORD,
  dataOf,
  errorCodeOf,
  realContext,
} from "./messaging-fixture";

const SITE = "https://site.example";

let handler: PolicyRpcHandler;
let context: ServiceContext;
let policy: PolicyService;
let storage: StorageSuite;

const send = (req: RpcRequest) => handler.handleRequest(req, context);

async function storedPolicy(origin: string): Promise<OriginPolicy | undefined> {
  const settings = await storage.local.get<{ origins?: OriginPolicy[] }>("appSettings");
  return settings?.origins?.find((o) => o.origin === origin);
}

beforeEach(async () => {
  handler = new PolicyRpcHandler();
  const built = realContext();
  ({ context, policy, storage } = built);
  await built.vault.importKey(SECRET_ONE, STRONG_PASSWORD);
  await built.vault.unlock(STRONG_PASSWORD);
});

describe("origin validation", () => {
  it.each([
    { type: "policy.evaluate", origin: "javascript:alert(1)", kind: 1 },
    { type: "policy.setOrigin", origin: "not a url", patch: { name: "x" } },
    { type: "policy.setKindRule", origin: "ftp://site.example", kind: 1, mode: "deny" },
    { type: "policy.clearSession", origin: "" },
    { type: "policy.setSession", origin: "chrome://settings", enabled: false },
    { type: "policy.removeOrigin", origin: "file:///etc/passwd" },
    { type: "policy.revokeDisclosure", origin: "file:///etc/passwd", keyId: "x" },
  ] as RpcRequest[])("refuses $type for a non-web origin", async (req) => {
    expect(errorCodeOf(await send(req))).toBe(RPC_ERROR_CODES.INVALID_ORIGIN);
  });

  it("rejects an unknown policy method", async () => {
    const res = await send({ type: "policy.grantEverything" } as unknown as RpcRequest);
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
  });
});

describe("policy.evaluate", () => {
  it("rejects a kind that is not a non-negative integer", async () => {
    const res = await send({ type: "policy.evaluate", origin: SITE, kind: -1 });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
  });

  it("asks for an origin that has never been decided", async () => {
    const res = await send({ type: "policy.evaluate", origin: SITE, kind: 1 });
    expect(dataOf<{ mode: string }>(res).mode).toBe("ask");
  });
});

describe("policy.setOrigin", () => {
  it("rejects a patch with an unknown field and writes nothing", async () => {
    const res = await send({
      type: "policy.setOrigin",
      origin: SITE,
      patch: { trustLevel: "low", sneaky: true } as never,
    });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    expect(await storedPolicy(SITE)).toBeUndefined();
  });

  it("renames an origin without asking for the password", async () => {
    expect(
      await send({ type: "policy.setOrigin", origin: SITE, patch: { name: "Site" } })
    ).toEqual({ ok: true, data: null });
    expect((await storedPolicy(SITE))?.name).toBe("Site");
  });

  it("refuses to raise an origin to high trust without the password", async () => {
    const res = await send({ type: "policy.setOrigin", origin: SITE, patch: { trustLevel: "high" } });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(await storedPolicy(SITE)).toBeUndefined();
  });

  it("refuses high trust under a wrong password", async () => {
    const res = await send({
      type: "policy.setOrigin",
      origin: SITE,
      patch: { trustLevel: "high" },
      password: "definitely-not-it",
    });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(await storedPolicy(SITE)).toBeUndefined();
  });

  it("grants high trust under the vault password", async () => {
    const res = await send({
      type: "policy.setOrigin",
      origin: SITE,
      patch: { trustLevel: "high" },
      password: STRONG_PASSWORD,
    });
    expect(res.ok).toBe(true);
    expect((await storedPolicy(SITE))?.trustLevel).toBe("high");
  });
});

describe("policy.setKindRule", () => {
  it("rejects a non-integer kind", async () => {
    const res = await send({ type: "policy.setKindRule", origin: SITE, kind: 1.5, mode: "deny" });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
  });

  it("rejects an unknown mode", async () => {
    const res = await send({
      type: "policy.setKindRule",
      origin: SITE,
      kind: 1,
      mode: "always" as never,
    });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    expect(await storedPolicy(SITE)).toBeUndefined();
  });

  it("records a deny rule without the password", async () => {
    await send({ type: "policy.setKindRule", origin: SITE, kind: 1, mode: "deny" });
    expect((await storedPolicy(SITE))?.rules[1]).toBe("deny");
  });

  it("refuses a standing allow rule without the password", async () => {
    const res = await send({ type: "policy.setKindRule", origin: SITE, kind: 1, mode: "allow" });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(await storedPolicy(SITE)).toBeUndefined();
  });

  it("records an allow rule under the vault password", async () => {
    await send({
      type: "policy.setKindRule",
      origin: SITE,
      kind: 1,
      mode: "allow",
      password: STRONG_PASSWORD,
    });
    expect((await storedPolicy(SITE))?.rules[1]).toBe("allow");
  });
});

describe("session grants", () => {
  it("refuses to enable a session grant without the password", async () => {
    const res = await send({ type: "policy.setSession", origin: SITE, enabled: true });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(dataOf(await send({ type: "policy.getSessionGrants" }))).toEqual([]);
  });

  it("enables a grant under the password and lists it as live", async () => {
    await send({ type: "policy.setSession", origin: SITE, enabled: true, password: STRONG_PASSWORD });

    const grants = dataOf<Array<{ origin: string; expiresAt: number }>>(
      await send({ type: "policy.getSessionGrants" })
    );

    expect(grants.map((g) => g.origin)).toEqual([SITE]);
    expect(grants[0].expiresAt).toBeGreaterThan(Date.now());
  });

  it("turns a grant off without the password", async () => {
    await policy.setSessionGrant(SITE, true);

    await send({ type: "policy.setSession", origin: SITE, enabled: false });

    expect(await policy.getSessionGrants()).toEqual([]);
  });

  it("clears a grant", async () => {
    await policy.setSessionGrant(SITE, true);

    expect(await send({ type: "policy.clearSession", origin: SITE })).toEqual({ ok: true, data: null });
    expect(await policy.getSessionGrants()).toEqual([]);
  });
});

describe("policy.removeOrigin", () => {
  it("forgets every decision recorded for the origin", async () => {
    await policy.setPerKindRule(SITE, 1, "deny");

    expect(await send({ type: "policy.removeOrigin", origin: SITE })).toEqual({ ok: true, data: null });
    expect(await storedPolicy(SITE)).toBeUndefined();
  });
});

describe("per-key disclosure grants over RPC", () => {
  const selectedId = async () =>
    (await context.vault.listKeys()).find((k) => k.isSelected)!.id;

  it("binds a password-gated allow patch to the selected key only", async () => {
    await context.vault.importKey(SECRET_TWO, STRONG_PASSWORD, "second");
    const first = await selectedId();

    const res = await send({
      type: "policy.setOrigin",
      origin: SITE,
      patch: { identityDisclosure: "allow" },
      password: STRONG_PASSWORD,
    });

    expect(res.ok).toBe(true);
    expect((await storedPolicy(SITE))?.identityDisclosureKeyIds).toEqual([first]);
    const [, second] = await context.vault.listKeys();
    expect(await policy.getIdentityDisclosure(SITE, second.id)).toBeUndefined();
  });

  it("refuses an allow patch when no key is selected, and writes nothing", async () => {
    const keys = await context.vault.listKeys();
    vi.spyOn(context.vault, "listKeys").mockResolvedValue(
      keys.map((k) => ({ ...k, isSelected: false }))
    );

    const res = await send({
      type: "policy.setOrigin",
      origin: SITE,
      patch: { identityDisclosure: "allow" },
      password: STRONG_PASSWORD,
    });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.NO_KEY_SELECTED);
    expect(await storedPolicy(SITE)).toBeUndefined();
  });

  it("revokes one key's grant and leaves the other", async () => {
    await context.vault.importKey(SECRET_TWO, STRONG_PASSWORD, "second");
    const [a, b] = await context.vault.listKeys();
    await policy.grantIdentityDisclosure(SITE, a.id);
    await policy.grantIdentityDisclosure(SITE, b.id);

    const res = await send({ type: "policy.revokeDisclosure", origin: SITE, keyId: a.id });

    expect(res.ok).toBe(true);
    expect(await policy.getIdentityDisclosure(SITE, a.id)).toBeUndefined();
    expect(await policy.getIdentityDisclosure(SITE, b.id)).toBe("allow");
  });

  it("needs no password to revoke", async () => {
    const id = await selectedId();
    await policy.grantIdentityDisclosure(SITE, id);

    const res = await send({ type: "policy.revokeDisclosure", origin: SITE, keyId: id });

    expect(res.ok).toBe(true);
  });

  it("refuses a key id that is not a key id", async () => {
    const res = await send({
      type: "policy.revokeDisclosure",
      origin: SITE,
      keyId: "../../etc",
    });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
  });

  it("refuses a patch that tries to write the key list", async () => {
    const res = await send({
      type: "policy.setOrigin",
      origin: SITE,
      patch: { identityDisclosureKeyIds: ["anything"] },
    } as unknown as RpcRequest);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    expect(await storedPolicy(SITE)).toBeUndefined();
  });
});

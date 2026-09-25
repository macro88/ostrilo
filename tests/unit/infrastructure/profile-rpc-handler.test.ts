import { beforeEach, describe, expect, it } from "vitest";
import { ProfileRpcHandler } from "@/infrastructure/messaging/handlers/profile-rpc";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { RpcRequest } from "@/infrastructure/messaging/rpc";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { ActivityLogService } from "@/application/services/activity-log.service";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import type { StorageSuite } from "@/application/ports/storage";
import { memoryStorage } from "../../helpers/vault";
import {
  MemoryRelay,
  PUBKEY_ONE,
  SECRET_ONE,
  STRONG_PASSWORD,
  dataOf,
  errorCodeOf,
  realContext,
} from "./messaging-fixture";

let handler: ProfileRpcHandler;
let context: ServiceContext;
let relay: MemoryRelay;
let vault: KeyVaultService;
let activityLog: ActivityLogService;
let storage: StorageSuite;

const send = (req: RpcRequest) => handler.handleRequest(req, context);

beforeEach(async () => {
  handler = new ProfileRpcHandler();
  ({ context, relay, vault, activityLog, storage } = realContext());
  await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
  await vault.unlock(STRONG_PASSWORD);
});

describe("profile.update", () => {
  it("requires a metadata object", async () => {
    for (const params of [undefined, { metadata: "Alice" }, {}]) {
      const res = await send({ type: "profile.update", params } as RpcRequest);
      expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    }
    expect(relay.published).toHaveLength(0);
  });

  it("rejects metadata the schema refuses and publishes nothing", async () => {
    const res = await send({
      type: "profile.update",
      params: { metadata: { name: "Alice", nip05: "not-an-address" } },
    });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    if (!res.ok) expect(res.error.data.details).toContain("nip05");
    expect(relay.published).toHaveLength(0);
  });

  it("publishes a kind 0 event signed by the selected key and logs it", async () => {
    const res = await send({ type: "profile.update", params: { metadata: { name: "Alice" } } });

    expect(res).toEqual({ ok: true, data: null });
    expect(relay.published).toHaveLength(1);
    expect(relay.published[0]).toMatchObject({ kind: 0, pubkey: PUBKEY_ONE });
    expect(JSON.parse(relay.published[0].content)).toEqual({ name: "Alice" });

    const [entry] = await activityLog.getRecent(10, 0);
    expect(entry).toMatchObject({ origin: "extension://profile", kind: 0, decision: "allow" });
  });

  it("reports a relay that refuses the event as a network error and logs nothing", async () => {
    relay.failPublish = true;

    const res = await send({ type: "profile.update", params: { metadata: { name: "Alice" } } });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.NETWORK_ERROR);
    expect(await activityLog.count()).toBe(0);
  });

  it("refuses to sign a profile while the vault is locked", async () => {
    await vault.lock();

    const res = await send({ type: "profile.update", params: { metadata: { name: "Alice" } } });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.LOCKED);
    expect(relay.published).toHaveLength(0);
  });
});

describe("profile.get", () => {
  it("requires a string pubkey", async () => {
    for (const params of [undefined, { pubkey: 42 }]) {
      const res = await send({ type: "profile.get", params } as unknown as RpcRequest);
      expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    }
  });

  it("returns a profile the relay holds for the key", async () => {
    await send({ type: "profile.update", params: { metadata: { name: "Alice" } } });
    await send({ type: "profile.clearCache", params: { pubkey: PUBKEY_ONE } });

    const res = await send({ type: "profile.get", params: { pubkey: PUBKEY_ONE, forceFetch: true } });

    expect(dataOf(res)).toEqual({ name: "Alice" });
  });

  it("returns null for a key nobody has published a profile for", async () => {
    const res = await send({ type: "profile.get", params: { pubkey: "ab".repeat(32) } });
    expect(dataOf(res)).toBeNull();
  });

  it("reports storage failure while reading the cache as an error", async () => {
    const broken = memoryStorage();
    broken.session.get = async () => {
      throw new Error("session storage unavailable");
    };

    const res = await handler.handleRequest(
      { type: "profile.get", params: { pubkey: PUBKEY_ONE } },
      realContext(broken).context
    );

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
  });
});

describe("profile.getAll", () => {
  it("maps each managed pubkey to its cached profile", async () => {
    await send({ type: "profile.update", params: { metadata: { about: "hi" } } });

    const res = await send({ type: "profile.getAll" });

    expect(dataOf(res)).toEqual({ [PUBKEY_ONE]: { about: "hi" } });
  });

  it("reports a key list that cannot be read as an error", async () => {
    const broken = memoryStorage();
    broken.local.get = async () => {
      throw new Error("local storage unavailable");
    };

    const res = await handler.handleRequest({ type: "profile.getAll" }, realContext(broken).context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
  });
});

describe("profile.clearCache", () => {
  it("drops every cached profile when no pubkey is named", async () => {
    await send({ type: "profile.update", params: { metadata: { name: "Alice" } } });
    relay.published.length = 0;

    expect(await send({ type: "profile.clearCache" })).toEqual({ ok: true, data: null });

    expect(await storage.session.get("profileCache")).toBeUndefined();
    expect(dataOf(await send({ type: "profile.getAll" }))).toEqual({});
  });

  it("reports storage failure as an error", async () => {
    const broken = memoryStorage();
    broken.session.remove = async () => {
      throw new Error("session storage unavailable");
    };

    const res = await handler.handleRequest({ type: "profile.clearCache" }, realContext(broken).context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
  });
});

it("rejects an unknown profile method", async () => {
  const res = await send({ type: "profile.delete" } as unknown as RpcRequest);
  expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
});

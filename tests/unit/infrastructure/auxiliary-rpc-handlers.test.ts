import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ActivityRpcHandler,
  CryptoRpcHandler,
  SettingsRpcHandler,
  StateRpcHandler,
} from "@/infrastructure/messaging/handlers";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { RpcRequest } from "@/infrastructure/messaging/rpc";
import {
  RPC_ERROR_CODES,
  createRpcError,
  getRpcErrorCode,
} from "@/infrastructure/messaging/error-codes";
import type { ActivityLogService } from "@/application/services/activity-log.service";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import type { StorageSuite } from "@/application/ports/storage";
import { SECRET_ONE, STRONG_PASSWORD, dataOf, errorCodeOf, realContext } from "./messaging-fixture";

type ArmHook = { __ostriloArmAutoLock?: () => Promise<void> };

let context: ServiceContext;
let activityLog: ActivityLogService;
let vault: KeyVaultService;
let storage: StorageSuite;

beforeEach(async () => {
  ({ context, activityLog, vault, storage } = realContext());
  await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
  await vault.unlock(STRONG_PASSWORD);
});

afterEach(() => {
  delete (globalThis as ArmHook).__ostriloArmAutoLock;
});

it.each([
  [new SettingsRpcHandler(), "settings.reset"],
  [new StateRpcHandler(), "state.forceUnlock"],
  [new CryptoRpcHandler(), "crypto.exportSecret"],
  [new ActivityRpcHandler(), "activity.rewrite"],
])("answers an unknown method with unknown_method (%#)", async (handler, type) => {
  const res = await handler.handleRequest({ type } as unknown as RpcRequest, context);
  expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
});

describe("settings.update", () => {
  const handler = new SettingsRpcHandler();

  it("shrinks the activity log to a lowered capacity", async () => {
    for (let i = 0; i < 12; i++) {
      await activityLog.addEntry({ origin: `https://site${i}.example`, kind: 1, decision: "allow" });
    }

    const res = await handler.handleRequest(
      { type: "settings.update", patch: { maxActivityEntries: 10 } },
      context
    );

    expect(dataOf<{ maxActivityEntries: number }>(res).maxActivityEntries).toBe(10);
    expect(await activityLog.count()).toBe(10);
  });

  it("keeps the settings change when the activity log cannot persist its new capacity", async () => {
    await activityLog.count();
    // Only the activity log's own write fails; settings share the area.
    const realSet = storage.local.set.bind(storage.local);
    storage.local.set = async <T>(key: string, value: T) => {
      if (key === "appSettings") return realSet(key, value);
      throw new Error("quota exceeded");
    };

    const res = await handler.handleRequest(
      { type: "settings.update", patch: { maxActivityEntries: 25 } },
      context
    );

    expect(dataOf<{ maxActivityEntries: number }>(res).maxActivityEntries).toBe(25);
    expect((await context.settings.get())?.maxActivityEntries).toBe(25);
  });
});

describe("state.touch", () => {
  it("re-arms the auto-lock alarm when the background installed the hook", async () => {
    let armed = 0;
    (globalThis as ArmHook).__ostriloArmAutoLock = async () => {
      armed += 1;
    };

    const res = await new StateRpcHandler().handleRequest({ type: "state.touch" }, context);

    expect(res).toEqual({ ok: true, data: null });
    expect(armed).toBe(1);
  });
});

describe("activity validation", () => {
  const handler = new ActivityRpcHandler();

  it("rejects a page size above the cap", async () => {
    const res = await handler.handleRequest({ type: "activity.getRecent", limit: 1000 }, context);
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
  });

  it("rejects a filter origin that is not a web origin", async () => {
    const res = await handler.handleRequest(
      { type: "activity.filterBy", origin: "javascript:alert(1)" },
      context
    );
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
  });
});

it("reads the machine error code back out of an error object", () => {
  expect(getRpcErrorCode(createRpcError(RPC_ERROR_CODES.LOCKED))).toBe(RPC_ERROR_CODES.LOCKED);
});

import { beforeEach, describe, expect, it } from "vitest";
import { BackupRpcHandler } from "@/infrastructure/messaging/handlers/backup-rpc";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { RpcRequest } from "@/infrastructure/messaging/rpc";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { isLockedReachable, RpcRouter } from "@/infrastructure/messaging/rpc-router";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import {
  SECRET_ONE,
  STRONG_PASSWORD,
  dataOf,
  errorCodeOf,
  realContext,
} from "./messaging-fixture";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let handler: BackupRpcHandler;
let context: ServiceContext;
let vault: KeyVaultService;

const send = (req: RpcRequest) => handler.handleRequest(req, context);
type Statuses = { statuses: Array<{ keyId: string; state: string }> };

beforeEach(() => {
  handler = new BackupRpcHandler();
  ({ context, vault } = realContext());
});

describe("backup.list", () => {
  it("lists the keys that have a record", async () => {
    const made = await vault.generateKey(STRONG_PASSWORD, "made");
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD, "imported");

    const { statuses } = dataOf<Statuses>(await send({ type: "backup.list" }));

    expect(statuses).toEqual([
      expect.objectContaining({ keyId: made.id, state: "pending" }),
    ]);
  });
});

describe("backup.markVerified", () => {
  it("marks a pending key verified", async () => {
    const made = await vault.generateKey(STRONG_PASSWORD, "made");

    dataOf(await send({ type: "backup.markVerified", keyId: made.id }));

    const { statuses } = dataOf<Statuses>(await send({ type: "backup.list" }));
    expect(statuses[0]).toMatchObject({ keyId: made.id, state: "verified" });
  });

  it("refuses a key id that is not a key id", async () => {
    expect(
      errorCodeOf(await send({ type: "backup.markVerified", keyId: "not-an-id" }))
    ).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
  });

  it("refuses a key the vault does not hold, and records nothing", async () => {
    await vault.generateKey(STRONG_PASSWORD, "made");
    expect(
      errorCodeOf(await send({ type: "backup.markVerified", keyId: UNKNOWN_ID }))
    ).toBe(RPC_ERROR_CODES.KEY_NOT_FOUND);
    const { statuses } = dataOf<Statuses>(await send({ type: "backup.list" }));
    expect(statuses.map((s) => s.keyId)).not.toContain(UNKNOWN_ID);
  });

  it("offers no way to set pending or clear a record", async () => {
    const res = await send({ type: "backup.markPending", keyId: UNKNOWN_ID } as never);
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
  });
});

describe("backup namespace access", () => {
  it("is lock-gated and not reachable by a web page", () => {
    expect(isLockedReachable("backup.list")).toBe(false);
    expect(isLockedReachable("backup.markVerified")).toBe(false);
    expect(RpcRouter.isPageReachable("backup")).toBe(false);
  });
});

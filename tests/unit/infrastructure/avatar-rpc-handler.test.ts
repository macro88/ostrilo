import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarRpcHandler } from "@/infrastructure/messaging/handlers/avatar-rpc";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { RpcRequest } from "@/infrastructure/messaging/rpc";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { isLockedReachable, RpcRouter } from "@/infrastructure/messaging/rpc-router";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import { AVATAR_MAX_DATA_URL_CHARS } from "@/domain/profile/avatar";
import {
  PNG_DATA_URL,
  SOURCE_URL,
  WEBP_DATA_URL,
} from "../../helpers/avatar-fixtures";
import {
  PUBKEY_ONE,
  SECRET_ONE,
  SECRET_TWO,
  STRONG_PASSWORD,
  dataOf,
  errorCodeOf,
  realContext,
} from "./messaging-fixture";

const NOT_IN_VAULT = "e".repeat(64);

let handler: AvatarRpcHandler;
let context: ServiceContext;
let vault: KeyVaultService;

const send = (req: RpcRequest) => handler.handleRequest(req, context);
const save = (over: Partial<Extract<RpcRequest, { type: "avatar.save" }>> = {}) =>
  send({
    type: "avatar.save",
    pubkey: PUBKEY_ONE,
    sourceUrl: SOURCE_URL,
    dataUrl: PNG_DATA_URL,
    ...over,
  });
const get = async (pubkey: string) =>
  dataOf<{ avatar: { dataUrl: string; sourceUrl: string; pubkey: string } | null }>(
    await send({ type: "avatar.get", pubkey })
  ).avatar;

beforeEach(async () => {
  handler = new AvatarRpcHandler();
  ({ context, vault } = realContext());
  await vault.importKey(SECRET_ONE, STRONG_PASSWORD, "one");
});

describe("avatar.save", () => {
  it("stores the copy for a key the vault holds", async () => {
    dataOf(await save());
    expect(await get(PUBKEY_ONE)).toEqual(
      expect.objectContaining({ pubkey: PUBKEY_ONE, dataUrl: PNG_DATA_URL, sourceUrl: SOURCE_URL })
    );
  });

  it("accepts a webp copy", async () => {
    dataOf(await save({ dataUrl: WEBP_DATA_URL }));
    expect((await get(PUBKEY_ONE))?.dataUrl).toBe(WEBP_DATA_URL);
  });

  it.each([
    ["a pubkey that is not hex", { pubkey: "npub1xyz" }],
    ["an uppercase pubkey", { pubkey: PUBKEY_ONE.toUpperCase() }],
    ["a non-https source", { sourceUrl: "http://images.example/a.png" }],
    ["a javascript: source", { sourceUrl: "javascript:alert(1)" }],
    ["a missing source", { sourceUrl: undefined as unknown as string }],
    ["an https URL as the image", { dataUrl: "https://images.example/a.png" }],
    ["an svg image", { dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" }],
    ["a gif image", { dataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }],
    ["an image whose bytes do not match its type", { dataUrl: PNG_DATA_URL.replace("image/png", "image/webp") }],
    ["an image over 64 KiB", { dataUrl: `${PNG_DATA_URL}${"A".repeat(AVATAR_MAX_DATA_URL_CHARS)}` }],
  ])("refuses %s and stores nothing", async (_name, over) => {
    expect(errorCodeOf(await save(over))).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    expect(await get(PUBKEY_ONE)).toBeNull();
  });

  it("refuses a public key the vault does not hold, and stores nothing", async () => {
    expect(errorCodeOf(await save({ pubkey: NOT_IN_VAULT }))).toBe(
      RPC_ERROR_CODES.KEY_NOT_FOUND
    );
    expect(await get(NOT_IN_VAULT)).toBeNull();
  });

  it("keeps at most one entry per vault key as copies are replaced and keys come and go", async () => {
    const two = await vault.importKey(SECRET_TWO, STRONG_PASSWORD, "two");
    dataOf(await save());
    dataOf(await save({ pubkey: two.pubkey }));
    dataOf(await save({ dataUrl: WEBP_DATA_URL }));

    await vault.deleteKey(two.id);

    expect(await get(PUBKEY_ONE)).toMatchObject({ dataUrl: WEBP_DATA_URL });
    expect(await get(two.pubkey)).toBeNull();
  });
});

describe("avatar.get and avatar.remove", () => {
  it("reports no copy as null, not as an error", async () => {
    expect(await get(PUBKEY_ONE)).toBeNull();
  });

  it("refuses a pubkey that is not 64 lowercase hex characters", async () => {
    expect(errorCodeOf(await send({ type: "avatar.get", pubkey: "nope" }))).toBe(
      RPC_ERROR_CODES.INVALID_PARAMS
    );
    expect(errorCodeOf(await send({ type: "avatar.remove", pubkey: "nope" }))).toBe(
      RPC_ERROR_CODES.INVALID_PARAMS
    );
  });

  it("removes the copy", async () => {
    dataOf(await save());
    dataOf(await send({ type: "avatar.remove", pubkey: PUBKEY_ONE }));
    expect(await get(PUBKEY_ONE)).toBeNull();
  });

  it("treats removing a copy that is not there as done", async () => {
    dataOf(await send({ type: "avatar.remove", pubkey: PUBKEY_ONE }));
  });

  it("offers no method that fetches a picture", async () => {
    const res = await send({ type: "avatar.fetch", pubkey: PUBKEY_ONE } as never);
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
  });
});

describe("avatar namespace access and network behaviour", () => {
  it("is lock-gated and not reachable by a web page", () => {
    for (const method of ["avatar.get", "avatar.save", "avatar.remove"]) {
      expect(isLockedReachable(method)).toBe(false);
    }
    expect(RpcRouter.isPageReachable("avatar")).toBe(false);
  });

  it("makes no network request while storing or reading a copy", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      dataOf(await save());
      await get(PUBKEY_ONE);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

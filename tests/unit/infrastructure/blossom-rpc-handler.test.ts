import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityRpcHandler } from "@/infrastructure/messaging/handlers/activity-rpc";
import { BlossomRpcHandler } from "@/infrastructure/messaging/handlers/blossom-rpc";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { RpcRequest } from "@/infrastructure/messaging/rpc";
import {
  PUBKEY_ONE,
  SECRET_ONE,
  STRONG_PASSWORD,
  dataOf,
  errorCodeOf,
  realContext,
} from "./messaging-fixture";

const HASH = "ab".repeat(32);

function request(extra: Record<string, unknown> = {}): RpcRequest {
  return {
    type: "blossom.authorizeUpload",
    pubkey: PUBKEY_ONE,
    sha256: HASH,
    serverId: "primal",
    ...extra,
  } as RpcRequest;
}

describe("BlossomRpcHandler", () => {
  let fixture: ReturnType<typeof realContext>;
  const handler = new BlossomRpcHandler();

  beforeEach(async () => {
    fixture = realContext();
    await fixture.vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await fixture.vault.unlock(STRONG_PASSWORD);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns exactly an authorization header value", async () => {
    const res = await handler.handleRequest(request(), fixture.context);

    const data = dataOf<{ authorization: string }>(res);
    expect(Object.keys(data)).toEqual(["authorization"]);
    expect(data.authorization.startsWith("Nostr ")).toBe(true);
    expect(data.authorization.slice(6)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ["a kind", { kind: 1 }],
    ["a tag list", { tags: [["t", "delete"]] }],
    ["content", { content: "anything" }],
    ["an expiry", { expiration: 9_999_999_999 }],
    ["a created_at", { created_at: 1 }],
    ["an unrelated field", { origin: "https://evil.example" }],
  ])("refuses a request carrying %s", async (_name, extra) => {
    const signSpy = vi.spyOn(fixture.vault, "signEvent");

    const res = await handler.handleRequest(request(extra), fixture.context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    expect(signSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["an unlisted server id", { serverId: "evil.example" }],
    ["a server URL in place of an id", { serverId: "https://blossom.primal.net" }],
    ["an uppercase server id", { serverId: "PRIMAL" }],
    ["an uppercase hash", { sha256: HASH.toUpperCase() }],
    ["a short hash", { sha256: HASH.slice(2) }],
    ["a non-hex hash", { sha256: "zz".repeat(32) }],
    ["a short pubkey", { pubkey: PUBKEY_ONE.slice(2) }],
    ["a missing hash", { sha256: undefined }],
    ["a non-string pubkey", { pubkey: 7 }],
  ])("refuses %s", async (_name, extra) => {
    const signSpy = vi.spyOn(fixture.vault, "signEvent");

    const res = await handler.handleRequest(request(extra), fixture.context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    expect(signSpy).not.toHaveBeenCalled();
  });

  it("refuses a key the vault does not hold", async () => {
    const signSpy = vi.spyOn(fixture.vault, "signEvent");

    const res = await handler.handleRequest(
      request({ pubkey: "ef".repeat(32) }),
      fixture.context
    );

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.KEY_NOT_FOUND);
    expect(signSpy).not.toHaveBeenCalled();
    expect(await fixture.activityLog.getRecent(10)).toEqual([]);
  });

  it("answers a locked vault with the locked code", async () => {
    await fixture.vault.lock();

    const res = await handler.handleRequest(request(), fixture.context);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.LOCKED);
    expect(await fixture.activityLog.getRecent(10)).toEqual([]);
  });

  it("records the authorisation in the activity log", async () => {
    await handler.handleRequest(request(), fixture.context);

    const entries = await fixture.activityLog.getRecent(10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      origin: "extension://profile",
      kind: 24242,
      decision: "allow",
    });
  });

  it("keeps its activity entry out of the site filter's list of origins", async () => {
    await handler.handleRequest(request(), fixture.context);

    const logged = await fixture.activityLog.getRecent(10);
    expect(logged.map((entry) => entry.origin)).toContain("extension://profile");

    const res = await new ActivityRpcHandler().handleRequest(
      { type: "activity.origins" },
      fixture.context
    );
    expect(dataOf<{ origins: string[] }>(res).origins).not.toContain(
      "extension://profile"
    );
  });

  it("makes no network request", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("the background must not use the network for an upload");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await handler.handleRequest(request(), fixture.context);

    expect(res.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers any other method in its namespace as unknown", async () => {
    const res = await handler.handleRequest(
      { type: "blossom.listBlobs" } as unknown as RpcRequest,
      fixture.context
    );

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RPC_ERROR_CODES,
  createRpcErrorResponse,
} from "@/infrastructure/messaging/error-codes";

const sendMessageMock = vi.hoisted(() => vi.fn());

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      sendMessage: sendMessageMock,
    },
  },
}));

import {
  RpcClientError,
  authorizeBlossomUpload,
} from "@/infrastructure/messaging/client";

const PARAMS = {
  pubkey: "ab".repeat(32),
  sha256: "cd".repeat(32),
  serverId: "primal" as const,
};

describe("authorizeBlossomUpload", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
  });

  it("sends exactly the three fields and returns the header value", async () => {
    sendMessageMock.mockResolvedValueOnce({
      ok: true,
      data: { authorization: "Nostr eyJhIjoiYiJ9" },
    });

    await expect(authorizeBlossomUpload(PARAMS)).resolves.toBe(
      "Nostr eyJhIjoiYiJ9"
    );
    expect(sendMessageMock).toHaveBeenCalledWith({
      type: "blossom.authorizeUpload",
      ...PARAMS,
    });
  });

  it.each([
    ["no scheme", "eyJhIjoiYiJ9"],
    ["another scheme", "Bearer eyJhIjoiYiJ9"],
    ["padding", "Nostr eyJhIjoiYiJ9=="],
    ["the standard alphabet", "Nostr a+b/c"],
    ["whitespace inside", "Nostr abc def"],
    ["an empty token", "Nostr "],
    ["a non-string", 7],
    ["a missing value", undefined],
  ])("rejects a reply with %s", async (_name, authorization) => {
    sendMessageMock.mockResolvedValueOnce({ ok: true, data: { authorization } });

    await expect(authorizeBlossomUpload(PARAMS)).rejects.toThrow();
  });

  it("rejects a reply that carries more than the header", async () => {
    sendMessageMock.mockResolvedValueOnce({
      ok: true,
      data: { authorization: "Nostr abc", extra: "x" },
    });

    await expect(authorizeBlossomUpload(PARAMS)).rejects.toThrow();
  });

  it("surfaces a refusal as an RpcClientError with its code", async () => {
    sendMessageMock.mockResolvedValueOnce(
      createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, {
        details: "locked",
        method: "blossom.authorizeUpload",
      })
    );

    await expect(authorizeBlossomUpload(PARAMS)).rejects.toMatchObject({
      errorCode: RPC_ERROR_CODES.LOCKED,
    });
    sendMessageMock.mockResolvedValueOnce(
      createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, {
        details: "locked",
        method: "blossom.authorizeUpload",
      })
    );
    await expect(authorizeBlossomUpload(PARAMS)).rejects.toBeInstanceOf(
      RpcClientError
    );
  });
});

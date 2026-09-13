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

import { RpcClientError, rpc } from "@/infrastructure/messaging/client";

describe("RPC client", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
  });

  it("returns response data for successful RPC calls", async () => {
    sendMessageMock.mockResolvedValueOnce({
      ok: true,
      data: { isLocked: false },
    });

    await expect(rpc({ type: "state.getLock" })).resolves.toEqual({
      isLocked: false,
    });
    expect(sendMessageMock).toHaveBeenCalledWith({ type: "state.getLock" });
  });

  it("throws RpcClientError for structured RPC errors", async () => {
    const response = createRpcErrorResponse(RPC_ERROR_CODES.DENIED, {
      details: "user rejected",
      method: "nostr.signEvent",
    });
    sendMessageMock.mockResolvedValueOnce(response);

    try {
      await rpc({ type: "nostr.signEvent" } as any);
      expect.fail("Expected rpc() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RpcClientError);
      expect(error).toMatchObject({
        message: "rpc:nostr.signEvent:denied",
        method: "nostr.signEvent",
        errorCode: RPC_ERROR_CODES.DENIED,
        rpcError: response.error,
      });
    }
  });

  it("keeps temporary compatibility with legacy string errors", async () => {
    sendMessageMock.mockResolvedValueOnce({
      ok: false,
      error: RPC_ERROR_CODES.LOCKED,
    });

    await expect(rpc({ type: "vault.reveal" } as any)).rejects.toThrow(
      "rpc:vault.reveal:locked"
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RpcRouter } from "@/infrastructure/messaging/rpc-router";
import { VaultRpcHandler } from "@/infrastructure/messaging/handlers/vault-rpc";
import { PolicyRpcHandler } from "@/infrastructure/messaging/handlers/policy-rpc";
import { SettingsRpcHandler } from "@/infrastructure/messaging/handlers/settings-rpc";
import { CryptoRpcHandler } from "@/infrastructure/messaging/handlers/crypto-rpc";
import { StateRpcHandler } from "@/infrastructure/messaging/handlers/state-rpc";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";

describe("RPC Router and Handlers", () => {
  let router: RpcRouter;
  let mockContext: ServiceContext;

  beforeEach(() => {
    router = new RpcRouter();

    // Create mock service context
    mockContext = {
      vault: {
        unlock: vi.fn().mockResolvedValue({ selectedKeyId: "test-key" }),
        lock: vi.fn().mockResolvedValue(undefined),
        generateKey: vi.fn().mockResolvedValue({ publicKey: "generated-key" }),
        importKey: vi.fn().mockResolvedValue({ publicKey: "imported-key" }),
        selectKey: vi.fn().mockResolvedValue(undefined),
        sign: vi.fn().mockResolvedValue("signature"),
        listKeys: vi.fn().mockResolvedValue([]),
        getLockState: vi.fn().mockResolvedValue({ isLocked: false }),
      },
      policy: {
        evaluate: vi.fn().mockResolvedValue({ allowed: true }),
        setOriginPolicy: vi.fn().mockResolvedValue(undefined),
        setPerKindRule: vi.fn().mockResolvedValue(undefined),
        clearSessionGrant: vi.fn().mockResolvedValue(undefined),
        setSessionGrant: vi.fn().mockResolvedValue(undefined),
        removeOriginPolicy: vi.fn().mockResolvedValue(undefined),
      },
      settings: {
        get: vi.fn().mockResolvedValue({ theme: "dark" }),
        update: vi.fn().mockResolvedValue({ theme: "light" }),
      },
      crypto: {
        evaluatePassword: vi.fn().mockResolvedValue({ score: 4 }),
        parsePrivateKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
      },
    } as any;
  });

  describe("RpcRouter", () => {
    it("should register modules correctly", () => {
      const vaultHandler = new VaultRpcHandler();
      router.registerModule("vault", vaultHandler);

      expect(router.getRegisteredNamespaces()).toContain("vault");
    });

    it("should route requests to correct module", async () => {
      const mockHandler = {
        handleRequest: vi.fn().mockResolvedValue({ ok: true, data: "test" }),
      };

      router.registerModule("test", mockHandler);

      const message = { type: "test.method" as any };
      const result = await router.handleRequest(message, mockContext);

      expect(mockHandler.handleRequest).toHaveBeenCalledWith(
        message,
        mockContext
      );
      expect(result).toEqual({ ok: true, data: "test" });
    });

    it("should handle unknown namespace", async () => {
      const message = { type: "unknown.method" as any };
      const result = await router.handleRequest(message, mockContext);

      expect(result).toEqual({
        ok: false,
        error: "unknown_namespace: unknown",
      });
    });

    it("should handle invalid message type", async () => {
      const message = { type: "" as any };
      const result = await router.handleRequest(message, mockContext);

      expect(result).toEqual({ ok: false, error: "invalid_message_type" });
    });

    it("should handle module errors", async () => {
      const mockHandler = {
        handleRequest: vi.fn().mockRejectedValue(new Error("Test error")),
      };

      router.registerModule("test", mockHandler);

      const message = { type: "test.method" as any };
      const result = await router.handleRequest(message, mockContext);

      expect(result).toEqual({ ok: false, error: "Test error" });
    });
  });

  describe("VaultRpcHandler", () => {
    let handler: VaultRpcHandler;

    beforeEach(() => {
      handler = new VaultRpcHandler();
    });

    it("should handle vault.unlock", async () => {
      const message = {
        type: "vault.unlock",
        password: "test-password",
      } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.vault.unlock).toHaveBeenCalledWith("test-password");
      expect(result).toEqual({ ok: true, data: { selectedKeyId: "test-key" } });
    });

    it("should handle vault.lock", async () => {
      const message = { type: "vault.lock" } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.vault.lock).toHaveBeenCalled();
      expect(result).toEqual({ ok: true, data: null });
    });

    it("should handle keys.list", async () => {
      const message = { type: "keys.list" } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.vault.listKeys).toHaveBeenCalled();
      expect(result).toEqual({
        ok: true,
        data: [],
      });
    });

    it("should handle unsupported methods", async () => {
      const message = { type: "vault.unsupported" } as any;
      const result = await handler.handleRequest(message, mockContext);

      expect(result).toEqual({
        ok: false,
        error: "unsupported_method: vault.unsupported",
      });
    });
  });

  describe("PolicyRpcHandler", () => {
    let handler: PolicyRpcHandler;

    beforeEach(() => {
      handler = new PolicyRpcHandler();
    });

    it("should handle policy.evaluate", async () => {
      const message = {
        type: "policy.evaluate",
        origin: "https://example.com",
        kind: 1,
      } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.policy.evaluate).toHaveBeenCalledWith({
        origin: "https://example.com",
        kind: 1,
      });
      expect(result).toEqual({ ok: true, data: { allowed: true } });
    });
  });

  describe("SettingsRpcHandler", () => {
    let handler: SettingsRpcHandler;

    beforeEach(() => {
      handler = new SettingsRpcHandler();
    });

    it("should handle settings.get", async () => {
      const message = { type: "settings.get" } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.settings.get).toHaveBeenCalled();
      expect(result).toEqual({ ok: true, data: { theme: "dark" } });
    });

    it("should handle settings.update", async () => {
      const message = {
        type: "settings.update",
        patch: { theme: "light" },
      } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.settings.update).toHaveBeenCalledWith({
        theme: "light",
      });
      expect(result).toEqual({ ok: true, data: { theme: "light" } });
    });
  });

  describe("StateRpcHandler", () => {
    let handler: StateRpcHandler;

    beforeEach(() => {
      handler = new StateRpcHandler();
    });

    it("should handle state.getLock", async () => {
      const message = { type: "state.getLock" } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.vault.getLockState).toHaveBeenCalled();
      expect(result).toEqual({ ok: true, data: { isLocked: false } });
    });
  });

  describe("CryptoRpcHandler", () => {
    let handler: CryptoRpcHandler;

    beforeEach(() => {
      handler = new CryptoRpcHandler();
    });

    it("should handle crypto.evaluatePassword", async () => {
      // Mock the dynamic import
      const mockEvaluatePasswordStrength = vi
        .fn()
        .mockReturnValue({ score: 4 });
      vi.doMock("@/domain/utils/crypto", () => ({
        evaluatePasswordStrength: mockEvaluatePasswordStrength,
      }));

      const message = {
        type: "crypto.evaluatePassword",
        password: "strong-password",
      } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(true);
    });

    it("should handle crypto.parsePrivateKey", async () => {
      // Mock the dynamic import
      const mockParsePrivateKey = vi
        .fn()
        .mockReturnValue(new Uint8Array([1, 2, 3]));
      vi.doMock("@/domain/utils/crypto", () => ({
        parsePrivateKey: mockParsePrivateKey,
      }));

      const message = {
        type: "crypto.parsePrivateKey",
        keyInput: "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", // Valid nsec format
      } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([1, 2, 3]); // Converted to Array from Uint8Array
      }
    });
  });
});

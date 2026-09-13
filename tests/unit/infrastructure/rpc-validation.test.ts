import { describe, it, expect, vi, beforeEach } from "vitest";
import { PolicyRpcHandler } from "@/infrastructure/messaging/handlers/policy-rpc";
import { VaultRpcHandler } from "@/infrastructure/messaging/handlers/vault-rpc";
import { CryptoRpcHandler } from "@/infrastructure/messaging/handlers/crypto-rpc";
import { SettingsRpcHandler } from "@/infrastructure/messaging/handlers/settings-rpc";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/rpc";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";

describe("RPC Validation", () => {
  let mockContext: ServiceContext;

  beforeEach(() => {
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

  describe("PolicyRpcHandler validation", () => {
    let handler: PolicyRpcHandler;

    beforeEach(() => {
      handler = new PolicyRpcHandler();
    });

    it("should reject invalid origin format", async () => {
      const message = {
        type: "policy.evaluate",
        origin: "invalid-origin", // Missing protocol
        kind: 1,
      } as const;

      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_ORIGIN);
      }
    });

    it("should reject invalid kind", async () => {
      const message = {
        type: "policy.evaluate",
        origin: "https://example.com",
        kind: -1, // Invalid kind
      } as const;

      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
      }
    });

    it("should accept valid inputs", async () => {
      const message = {
        type: "policy.evaluate",
        origin: "https://example.com",
        kind: 1,
      } as const;

      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(true);
      expect(mockContext.policy.evaluate).toHaveBeenCalledWith({
        origin: "https://example.com",
        kind: 1,
      });
    });
  });

  describe("VaultRpcHandler validation", () => {
    let handler: VaultRpcHandler;

    beforeEach(() => {
      handler = new VaultRpcHandler();
    });

    it("should reject empty password", async () => {
      const message = {
        type: "vault.unlock",
        password: "", // Empty password
      } as const;

      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
      }
    });

    it("should reject invalid key input format", async () => {
      const message = {
        type: "vault.import",
        keyInput: "invalid-key", // Invalid format
        password: "test-password",
      } as const;

      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_KEY_INPUT);
      }
    });

    it("no longer exposes vault.sign at all", async () => {
      // vault.sign signed any 32-byte value with no origin, no policy check
      // and no approval. It was removed rather than validated more strictly:
      // the defect was the method existing, not its input handling. Signing
      // goes through nostr.signEvent, which forces the pubkey, recomputes the
      // event id, and evaluates policy before the key is used.
      const result = await handler.handleRequest(
        { type: "vault.sign", hashHex: "ab".repeat(32) } as never,
        mockContext
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
      }
    });

    it("no longer exposes vault.export at all", async () => {
      // vault.export returned the raw nsec with no password and no consent.
      const result = await handler.handleRequest(
        { type: "vault.export" } as never,
        mockContext
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
      }
    });

    it("should accept valid hex key input", async () => {
      const message = {
        type: "vault.import",
        keyInput:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", // Valid 64-char hex
        password: "test-password",
      } as const;

      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(true);
      expect(mockContext.vault.importKey).toHaveBeenCalled();
    });
  });

  describe("CryptoRpcHandler validation", () => {
    let handler: CryptoRpcHandler;

    beforeEach(() => {
      handler = new CryptoRpcHandler();
      // Mock the dynamic import
      vi.doMock("@/domain/utils/crypto", () => ({
        parsePrivateKey: vi.fn().mockReturnValue(new Uint8Array(32)),
        evaluatePasswordStrength: vi.fn().mockReturnValue({ score: 4 }),
      }));
    });

    it("should reject empty password", async () => {
      const message = {
        type: "crypto.evaluatePassword",
        password: "", // Empty password
      } as const;

      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
      }
    });

    it("should reject invalid key input", async () => {
      const message = {
        type: "crypto.parsePrivateKey",
        keyInput: "nsec1", // Too short
      } as const;

      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_KEY_INPUT);
      }
    });
  });

  describe("SettingsRpcHandler validation", () => {
    let handler: SettingsRpcHandler;

    beforeEach(() => {
      handler = new SettingsRpcHandler();
    });

    it("should reject invalid theme value (via any cast)", async () => {
      const message = {
        type: "settings.update",
        patch: { theme: "invalid-theme" as any }, // Use any cast to test runtime validation
      } as const;

      const result = await handler.handleRequest(message as any, mockContext);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
      }
    });

    it("should reject empty patch", async () => {
      const message = {
        type: "settings.update",
        patch: {}, // Empty patch
      } as const;

      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
      }
    });

    it("should accept valid patch", async () => {
      const message = {
        type: "settings.update",
        patch: { theme: "dark" }, // Valid theme
      } as const;

      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(true);
      expect(mockContext.settings.update).toHaveBeenCalledWith({
        theme: "dark",
      });
    });
  });
});

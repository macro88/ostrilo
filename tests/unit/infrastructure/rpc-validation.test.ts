import { describe, it, expect, vi, beforeEach } from "vitest";
import { PolicyRpcHandler } from "@/infrastructure/messaging/handlers/policy-rpc";
import { VaultRpcHandler } from "@/infrastructure/messaging/handlers/vault-rpc";
import { CryptoRpcHandler } from "@/infrastructure/messaging/handlers/crypto-rpc";
import { SettingsRpcHandler } from "@/infrastructure/messaging/handlers/settings-rpc";
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
        expect(result.error).toContain("invalid_origin");
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
        expect(result.error).toContain("invalid_kind");
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
        expect(result.error).toContain("invalid_password");
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
        expect(result.error).toContain("invalid_key_input");
      }
    });

    it("should reject invalid hash format", async () => {
      const message = {
        type: "vault.sign",
        hashHex: "invalid-hash", // Not 64-char hex
      } as const;

      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("invalid_hash");
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
        expect(result.error).toContain("invalid_password");
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
        expect(result.error).toContain("invalid_key_input");
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
        expect(result.error).toContain("invalid_patch");
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
        expect(result.error).toContain("invalid_patch");
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

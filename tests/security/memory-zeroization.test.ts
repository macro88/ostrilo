import { describe, it, expect, beforeEach, vi } from "vitest";
import { KeyVaultService } from "@/application/services/key-vault.service";

// Mock the crypto module to spy on zeroize calls
vi.mock("@/domain/utils/crypto", async () => {
  const actual = await vi.importActual("@/domain/utils/crypto");
  return {
    ...actual,
    zeroize: vi.fn(),
  };
});

// Import the mocked zeroize after setting up the mock
import { zeroize } from "@/domain/utils/crypto";
const mockZeroize = vi.mocked(zeroize);

describe("KeyVaultService - Memory Zeroization Security Tests", () => {
  let keyVaultService: KeyVaultService;
  let mockStorage: any;
  let mockAead: any;
  let mockKdf: any;
  let mockSchnorr: any;

  beforeEach(() => {
    // Reset the mock before each test
    mockZeroize.mockClear();

    // Mock storage
    mockStorage = {
      local: {
        get: vi.fn(),
        set: vi.fn(),
      },
      sync: {
        get: vi.fn(),
        set: vi.fn(),
      },
      session: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
      },
    };

    // Mock crypto interfaces
    mockAead = {
      importKey: vi.fn(),
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    };

    mockKdf = {
      deriveKey: vi.fn(),
    };

    mockSchnorr = {
      getPublicKey: vi.fn(),
      sign: vi.fn(),
    };

    keyVaultService = new KeyVaultService(
      mockStorage,
      mockAead,
      mockKdf,
      mockSchnorr
    );
  });

  describe("unlock method memory zeroization", () => {
    it("should zeroize derived key material in try/finally blocks", async () => {
      // Setup test data
      const testPrivateKey = new Uint8Array(32).fill(1);
      const testDerivedKey = new Uint8Array(32).fill(2);
      const testDecryptedKey = new Uint8Array(32).fill(3);

      mockStorage.sync.get.mockResolvedValue({ selectedKeyId: "test-key-1" });
      mockStorage.local.get.mockResolvedValue([
        {
          id: "test-key-1",
          salt: Array.from(new Uint8Array(16).fill(1)),
          iv: Array.from(new Uint8Array(12).fill(2)),
          ct: Array.from(new Uint8Array(32).fill(3)),
        },
      ]);

      mockKdf.deriveKey.mockResolvedValue(testDerivedKey);
      mockAead.importKey.mockResolvedValue({});
      mockAead.decrypt.mockResolvedValue(testDecryptedKey);

      // Spy on zeroize calls
      const zeroizeSpy = mockZeroize;

      await keyVaultService.unlock("test-password");

      // Verify that zeroize was called on the derived key
      expect(zeroizeSpy).toHaveBeenCalledWith(testDerivedKey);
    });

    it("should zeroize derived key even if decryption fails", async () => {
      const testDerivedKey = new Uint8Array(32).fill(2);

      mockStorage.sync.get.mockResolvedValue({});
      mockStorage.local.get.mockResolvedValue([
        {
          id: "test-key-1",
          salt: Array.from(new Uint8Array(16).fill(1)),
          iv: Array.from(new Uint8Array(12).fill(2)),
          ct: Array.from(new Uint8Array(32).fill(3)),
        },
      ]);

      mockKdf.deriveKey.mockResolvedValue(testDerivedKey);
      mockAead.importKey.mockResolvedValue({});
      mockAead.decrypt.mockRejectedValue(new Error("Decryption failed"));

      const zeroizeSpy = mockZeroize;

      // Should still zeroize the derived key even if decryption fails
      await expect(keyVaultService.unlock("wrong-password")).rejects.toThrow(
        "Decryption failed"
      );

      expect(zeroizeSpy).toHaveBeenCalledWith(testDerivedKey);
    });
  });

  describe("lock method memory zeroization", () => {
    it("should zeroize all unlocked private keys", async () => {
      const testKey1 = new Uint8Array(32).fill(1);
      const testKey2 = new Uint8Array(32).fill(2);

      // Manually add keys to the unlocked map (simulating unlocked state)
      (keyVaultService as any).unlocked.set("key1", testKey1);
      (keyVaultService as any).unlocked.set("key2", testKey2);

      const zeroizeSpy = mockZeroize;

      await keyVaultService.lock();

      // Verify that zeroize was called for each unlocked key
      expect(zeroizeSpy).toHaveBeenCalledWith(testKey1);
      expect(zeroizeSpy).toHaveBeenCalledWith(testKey2);
      expect(zeroizeSpy).toHaveBeenCalledTimes(2);

      // Verify the unlocked map is cleared
      expect((keyVaultService as any).unlocked.size).toBe(0);
    });
  });

  describe("encryptPrivateKey method memory zeroization", () => {
    it("should zeroize derived key material in try/finally", async () => {
      const testPrivateKey = new Uint8Array(32).fill(1);
      const testDerivedKey = new Uint8Array(32).fill(2);
      const testEncrypted = new Uint8Array(32).fill(3);

      mockKdf.deriveKey.mockResolvedValue(testDerivedKey);
      mockAead.importKey.mockResolvedValue({});
      mockAead.encrypt.mockResolvedValue(testEncrypted);

      const zeroizeSpy = mockZeroize;

      // Call the private method through generateKey
      mockSchnorr.getPublicKey.mockResolvedValue(new Uint8Array(33).fill(4));
      mockStorage.local.get.mockResolvedValue([]);
      mockStorage.sync.get.mockResolvedValue({});

      await keyVaultService.generateKey("test-password", "test-key");

      // Verify that zeroize was called on derived keys
      expect(zeroizeSpy).toHaveBeenCalledWith(testDerivedKey);
    });
  });

  describe("generateKey method memory zeroization", () => {
    it("should zeroize generated private key material", async () => {
      mockSchnorr.getPublicKey.mockResolvedValue(new Uint8Array(33).fill(4));
      mockKdf.deriveKey.mockResolvedValue(new Uint8Array(32).fill(2));
      mockAead.importKey.mockResolvedValue({});
      mockAead.encrypt.mockResolvedValue(new Uint8Array(32).fill(3));
      mockStorage.local.get.mockResolvedValue([]);
      mockStorage.sync.get.mockResolvedValue({});

      const zeroizeSpy = mockZeroize;

      await keyVaultService.generateKey("test-password", "test-key");

      // Should have called zeroize multiple times:
      // 1. For the derived key in encryptPrivateKey
      // 2. For the generated private key in generateKey
      expect(zeroizeSpy).toHaveBeenCalledTimes(2);
    });

    it("should zeroize private key even if process fails", async () => {
      mockSchnorr.getPublicKey.mockRejectedValue(new Error("Crypto error"));

      const zeroizeSpy = mockZeroize;

      await expect(
        keyVaultService.generateKey("test-password", "test-key")
      ).rejects.toThrow("Crypto error");

      // Should still zeroize the generated private key
      expect(zeroizeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("importKey method memory zeroization", () => {
    it("should zeroize parsed private key material", async () => {
      const validNsecKey =
        "nsec1xyy5s0f8jlk0y3k5z8xjxqj8xk8lk5j8k5z8j5k8l5k8j5k8l5k8j5k8l5k8j";

      mockSchnorr.getPublicKey.mockResolvedValue(new Uint8Array(33).fill(4));
      mockKdf.deriveKey.mockResolvedValue(new Uint8Array(32).fill(2));
      mockAead.importKey.mockResolvedValue({});
      mockAead.encrypt.mockResolvedValue(new Uint8Array(32).fill(3));
      mockStorage.local.get.mockResolvedValue([]);
      mockStorage.sync.get.mockResolvedValue({});

      const zeroizeSpy = mockZeroize;

      // Use a valid hex key instead since nsec parsing is complex
      const hexKey = "0".repeat(64);
      await keyVaultService.importKey(hexKey, "test-password", "test-key");

      // Should have called zeroize multiple times:
      // 1. For the derived key in encryptPrivateKey
      // 2. For the parsed private key in importKey
      expect(zeroizeSpy).toHaveBeenCalledTimes(2);
    });
  });
});

describe("Memory Zeroization Utility Function", () => {
  it("should securely zero out Uint8Array buffers", async () => {
    // We need to test the actual implementation, so let's reset the mock temporarily
    vi.doUnmock("@/domain/utils/crypto");
    const { zeroize: actualZeroize } = await import(
      "../../src/domain/utils/crypto"
    );

    const testData = new Uint8Array([1, 2, 3, 4, 5]);

    actualZeroize(testData);

    // All bytes should be zero
    expect(Array.from(testData)).toEqual([0, 0, 0, 0, 0]);

    // Re-mock for other tests
    vi.doMock("@/domain/utils/crypto", async () => {
      const actual = await vi.importActual("@/domain/utils/crypto");
      return {
        ...actual,
        zeroize: vi.fn(),
      };
    });
  });

  it("should handle null/undefined buffers gracefully", async () => {
    // Test the actual implementation for error handling
    vi.doUnmock("@/domain/utils/crypto");
    const { zeroize: actualZeroize } = await import(
      "../../src/domain/utils/crypto"
    );

    expect(() => actualZeroize(null as any)).not.toThrow();
    expect(() => actualZeroize(undefined as any)).not.toThrow();
  });
});

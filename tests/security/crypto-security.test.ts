import { describe, it, expect, beforeEach } from "vitest";
import { KeyVaultService } from "@/application/services/key-vault.service";
import {
  WebCryptoAesGcm,
  NoblePbkdf2,
  NobleSchnorr,
} from "@/infrastructure/crypto/adapters";
import type { StorageSuite } from "@/application/ports/storage";

// In-memory storage adapter for testing
function createMemoryStorage(): StorageSuite {
  const maps = {
    local: new Map<string, any>(),
    sync: new Map<string, any>(),
    session: new Map<string, any>(),
  };
  const make = (m: Map<string, any>) => ({
    async get<T>(key: string): Promise<T | undefined> {
      return m.get(key);
    },
    async set<T>(key: string, value: T): Promise<void> {
      m.set(key, value);
    },
    async remove(key: string): Promise<void> {
      m.delete(key);
    },
  });
  return {
    local: make(maps.local),
    sync: make(maps.sync),
    session: make(maps.session),
  };
}

describe("Security Testing", () => {
  let keyVault: KeyVaultService;
  let storage: StorageSuite;

  beforeEach(() => {
    storage = createMemoryStorage();
    keyVault = new KeyVaultService(
      storage,
      WebCryptoAesGcm,
      NoblePbkdf2,
      NobleSchnorr
    );
  });

  describe("Cryptographic Security", () => {
    it("generates cryptographically secure private keys", async () => {
      const password = "test-password-123";
      
      // Generate multiple keys and verify they are different
      const key1 = await keyVault.generateKey(password, "Key 1");
      const key2 = await keyVault.generateKey(password, "Key 2");
      const key3 = await keyVault.generateKey(password, "Key 3");

      // Verify all keys have different IDs (derived from public keys)
      expect(key1.id).not.toBe(key2.id);
      expect(key1.id).not.toBe(key3.id);
      expect(key2.id).not.toBe(key3.id);

      // Verify all keys have different public keys
      expect(key1.pubkey).not.toBe(key2.pubkey);
      expect(key1.pubkey).not.toBe(key3.pubkey);
      expect(key2.pubkey).not.toBe(key3.pubkey);

      // Verify public key format (64 hex characters = 32 bytes)
      expect(key1.pubkey).toMatch(/^[0-9a-f]{64}$/);
      expect(key2.pubkey).toMatch(/^[0-9a-f]{64}$/);
      expect(key3.pubkey).toMatch(/^[0-9a-f]{64}$/);

      // Verify public key length (should be 64 characters for 32 bytes)
      expect(key1.pubkey.length).toBe(64);
      expect(key2.pubkey.length).toBe(64);
      expect(key3.pubkey.length).toBe(64);
    });

    it("uses unique salts and IVs for encryption", async () => {
      const password = "encryption-test-456";
      
      // Create multiple keys with same password
      const key1 = await keyVault.generateKey(password, "Test 1");
      const key2 = await keyVault.generateKey(password, "Test 2");

      // Get encrypted key records from storage
      const keys = await keyVault.listKeys();
      expect(keys).toHaveLength(2);

      const record1 = keys.find(k => k.id === key1.id)!;
      const record2 = keys.find(k => k.id === key2.id)!;

      // Verify different salts
      expect(record1.salt).not.toEqual(record2.salt);
      
      // Verify different IVs  
      expect(record1.iv).not.toEqual(record2.iv);

      // Verify different ciphertext (even with same password)
      expect(record1.ct).not.toEqual(record2.ct);

      // Verify salt and IV lengths (should be 16 bytes each for AES-GCM)
      expect(record1.salt).toHaveLength(16);
      expect(record1.iv).toHaveLength(12); // AES-GCM uses 12-byte IV
      expect(record2.salt).toHaveLength(16);
      expect(record2.iv).toHaveLength(12);
    });

    it("creates secure non-deterministic signatures", async () => {
      const password = "signature-test-789";
      const messageHash = "0123456789abcdef".repeat(4); // 32 bytes as hex
      
      const keyRecord = await keyVault.generateKey(password, "Signature Test");
      await keyVault.unlock(password);
      await keyVault.selectKey(keyRecord.id);

      // Sign the same message multiple times
      const sig1 = await keyVault.sign(messageHash);
      const sig2 = await keyVault.sign(messageHash);

      // Schnorr signatures should be different due to random nonces (secure behavior)
      expect(sig1.sigHex).not.toBe(sig2.sigHex);
      expect(sig1.keyId).toBe(sig2.keyId);
      expect(sig1.keyId).toBe(keyRecord.id);

      // Verify signature format (128 hex characters = 64 bytes)
      expect(sig1.sigHex).toMatch(/^[0-9a-f]{128}$/);
      expect(sig1.sigHex.length).toBe(128);
    });

    it("produces different signatures for different messages", async () => {
      const password = "different-message-test";
      const message1 = "0123456789abcdef".repeat(4); // 32 bytes as hex
      const message2 = "fedcba9876543210".repeat(4); // Different 32 bytes
      
      const keyRecord = await keyVault.generateKey(password, "Message Test");
      await keyVault.unlock(password);
      await keyVault.selectKey(keyRecord.id);

      const sig1 = await keyVault.sign(message1);
      const sig2 = await keyVault.sign(message2);

      // Different messages should produce different signatures
      expect(sig1.sigHex).not.toBe(sig2.sigHex);
      expect(sig1.keyId).toBe(sig2.keyId); // Same key used
    });

    it("produces different signatures for different keys", async () => {
      const password = "different-key-test";
      const messageHash = "abcdef0123456789".repeat(4); // 32 bytes as hex
      
      const key1 = await keyVault.generateKey(password, "Key 1");
      const key2 = await keyVault.generateKey(password, "Key 2");
      
      await keyVault.unlock(password);

      // Sign with first key explicitly by keyId
      const sig1 = await keyVault.sign(messageHash, key1.id);

      // Sign with second key explicitly by keyId
      const sig2 = await keyVault.sign(messageHash, key2.id);

      // Same message, different keys should produce different signatures
      expect(sig1.sigHex).not.toBe(sig2.sigHex);
      expect(sig1.keyId).toBe(key1.id);
      expect(sig2.keyId).toBe(key2.id);
    });
  });

  describe("Password Security", () => {
    it("requires correct password for decryption", async () => {
      const correctPassword = "correct-password-123";
      const wrongPassword = "wrong-password-456";
      
      // Create key with correct password
      const keyRecord = await keyVault.generateKey(correctPassword, "Password Test");
      
      // Lock vault
      await keyVault.lock();

      // Wrong password should fail
      await expect(keyVault.unlock(wrongPassword))
        .rejects.toThrow();

      // Correct password should succeed
      const result = await keyVault.unlock(correctPassword);
      expect(result.selectedKeyId).toBe(keyRecord.id);
    });

    it("handles empty and weak passwords gracefully", async () => {
      // Empty password should be rejected rather than creating an insecure key
      await expect(keyVault.generateKey("", "Empty Password")).rejects.toThrow(
        "password_required"
      );

      const createIsolatedVault = () =>
        new KeyVaultService(
          createMemoryStorage(),
          WebCryptoAesGcm,
          NoblePbkdf2,
          NobleSchnorr
        );

      // Very short password should work
      const shortKey = await createIsolatedVault().generateKey("a", "Short Password");
      expect(shortKey.id).toBeDefined();

      // Spaces should be preserved
      const spaceKey = await createIsolatedVault().generateKey(
        "  spaces  ",
        "Space Password"
      );
      expect(spaceKey.id).toBeDefined();

      // Unicode should work
      const unicodeKey = await createIsolatedVault().generateKey(
        "🔐密码",
        "Unicode Password"
      );
      expect(unicodeKey.id).toBeDefined();

      // All keys should be different
      const allKeys = new Set([shortKey.id, spaceKey.id, unicodeKey.id]);
      expect(allKeys.size).toBe(3);
    });

    it("salt provides protection against rainbow table attacks", async () => {
      const commonPassword = "password123";
      
      // Create multiple keys with same password
      const key1 = await keyVault.generateKey(commonPassword, "Key 1");
      const key2 = await keyVault.generateKey(commonPassword, "Key 2");

      const keys = await keyVault.listKeys();
      const record1 = keys.find(k => k.id === key1.id)!;
      const record2 = keys.find(k => k.id === key2.id)!;

      // Different salts should result in different derived keys
      // and thus different ciphertext even with same password
      expect(record1.salt).not.toEqual(record2.salt);
      expect(record1.ct).not.toEqual(record2.ct);

      // Both should unlock with same password
      await keyVault.lock();
      await keyVault.unlock(commonPassword);
      
      const unlockState = await keyVault.getLockState();
      expect(unlockState.isLocked).toBe(false);
    });
  });

  describe("Memory Security", () => {
    it("clears sensitive data from memory on lock", async () => {
      const password = "memory-test-password";
      const keyRecord = await keyVault.generateKey(password, "Memory Test");
      
      // Unlock and verify key is accessible
      await keyVault.unlock(password);
      await keyVault.selectKey(keyRecord.id);

      const messageHash = "a".repeat(64); // 32 bytes as hex
      const signature = await keyVault.sign(messageHash);
      expect(signature.keyId).toBe(keyRecord.id);

      // Lock vault
      await keyVault.lock();

      // Verify key is no longer accessible
      await expect(keyVault.sign(messageHash))
        .rejects.toThrow();

      const lockState = await keyVault.getLockState();
      expect(lockState.isLocked).toBe(true);
    });

    it("maintains key isolation between sessions", async () => {
      const password = "isolation-test";
      
      // Session 1: Create and use key
      const key1 = await keyVault.generateKey(password, "Session 1");
      await keyVault.unlock(password);
      await keyVault.selectKey(key1.id);

      const messageHash = "b".repeat(64);
      const sig1 = await keyVault.sign(messageHash);
      expect(sig1.keyId).toBe(key1.id);

      // Lock and unlock (simulate session restart)
      await keyVault.lock();
      await keyVault.unlock(password);

      // Should still be able to sign (key re-decrypted)
      await keyVault.selectKey(key1.id);
      const sig2 = await keyVault.sign(messageHash);
      
      // Different signatures due to random nonces (secure behavior)
      expect(sig2.sigHex).not.toBe(sig1.sigHex);
      expect(sig2.keyId).toBe(key1.id); // Same key used
    });
  });

  describe("Input Validation Security", () => {
    it("validates message hash format for signing", async () => {
      const password = "validation-test";
      const keyRecord = await keyVault.generateKey(password, "Validation Test");
      await keyVault.unlock(password);
      await keyVault.selectKey(keyRecord.id);

      // Invalid hex characters
      await expect(keyVault.sign("not-hex-at-all"))
        .rejects.toThrow();

      // Wrong length (too short)
      await expect(keyVault.sign("abcd"))
        .rejects.toThrow();

      // Wrong length (too long)
      await expect(keyVault.sign("a".repeat(128)))
        .rejects.toThrow();

      // Mixed case should work (gets normalized)
      const validHash = "ABCDEF0123456789".repeat(4);
      const result = await keyVault.sign(validHash);
      expect(result.sigHex).toBeDefined();
    });

    it("handles edge cases in key operations", async () => {
      const password = "edge-case-test";
      
      // Operations while locked should fail gracefully
      const messageHash = "c".repeat(64);
      await expect(keyVault.sign(messageHash))
        .rejects.toThrow();

      // Create key and test operations
      const keyRecord = await keyVault.generateKey(password, "Edge Case Test");
      await keyVault.unlock(password);

      // With key unlocked, signing should work automatically
      // (uses first unlocked key when no key is explicitly selected)
      const result = await keyVault.sign(messageHash);
      expect(result.keyId).toBe(keyRecord.id);
      
      // Explicitly select key and verify it still works
      await keyVault.selectKey(keyRecord.id);
      const result2 = await keyVault.sign(messageHash);
      expect(result2.keyId).toBe(keyRecord.id);
    });
  });

  describe("Storage Security", () => {
    it("encrypts keys at rest", async () => {
      const password = "storage-security-test";
      const keyRecord = await keyVault.generateKey(password, "Storage Test");

      // Get raw storage data
      const encryptedKeys = await storage.local.get("encryptedKeys") as any[];
      expect(encryptedKeys).toBeDefined();
      expect(Array.isArray(encryptedKeys)).toBe(true);

      const storedRecord = encryptedKeys.find((k: any) => k.id === keyRecord.id);
      expect(storedRecord).toBeDefined();

      // Verify sensitive data is not stored in plaintext
      const storageString = JSON.stringify(storedRecord);
      
      // Should not contain the word "private" or "secret"
      expect(storageString.toLowerCase()).not.toContain("private");
      expect(storageString.toLowerCase()).not.toContain("secret");
      
      // Should not contain nsec format (private key)
      expect(storageString).not.toMatch(/nsec1[a-z0-9]+/);
      
      // Should contain encrypted data fields
      expect(storedRecord.ct).toBeDefined(); // ciphertext
      expect(storedRecord.salt).toBeDefined();
      expect(storedRecord.iv).toBeDefined();
      
      // Should contain public information
      expect(storedRecord.id).toBe(keyRecord.id);
      expect(storedRecord.label).toBe("Storage Test");
      expect(storedRecord.pubkey).toBe(keyRecord.pubkey);
    });

    it("uses secure session storage for lock state", async () => {
      const password = "session-storage-test";
      const keyRecord = await keyVault.generateKey(password, "Session Test");
      
      // Initially no lock state
      const initialState = await storage.session.get("lockState");
      expect(initialState).toBeUndefined();

      // Unlock creates lock state
      await keyVault.unlock(password);
      await keyVault.selectKey(keyRecord.id);

      const lockState = await storage.session.get("lockState") as any;
      expect(lockState).toBeDefined();
      expect(lockState.isLocked).toBe(false);
      expect(lockState.selectedKeyId).toBe(keyRecord.id);

      // Lock clears session state appropriately
      await keyVault.lock();
      const lockedState = await storage.session.get("lockState") as any;
      expect(lockedState.isLocked).toBe(true);
    });
  });
});

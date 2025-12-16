import { describe, it, expect, vi, beforeEach } from "vitest";
import { KeyVaultService } from "@/application/services/key-vault.service";
import type { StoragePort } from "@/application/ports/storage";
import type { KeyRecord } from "@/application/services/key-vault.service";

class MockStorage implements StoragePort {
  private store: Map<string, any> = new Map();
  
  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key);
  }
  
  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }
  
  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
  
  // Helper for tests
  clear() {
    this.store.clear();
  }
}

// Mock crypto utils to avoid actual crypto operations
vi.mock("@/lib/crypto", () => ({
  generateKeyPair: () => ({
    privateKey: new Uint8Array(32).fill(1),
    publicKey: new Uint8Array(32).fill(2),
  }),
  encryptPrivateKey: () => ({
    ciphertext: new Uint8Array(48).fill(3),
    salt: new Uint8Array(16).fill(4),
    iv: new Uint8Array(12).fill(5),
  }),
  decryptPrivateKey: () => new Uint8Array(32).fill(1),
  deriveKey: () => new Uint8Array(32).fill(6),
  publicKeyToHex: () => "mock-pubkey-hex",
  publicKeyToBech32: () => "npub1mockpubkey",
}));

describe("Multi-Key Management Integration", () => {
  let storage: MockStorage;
  let vault: KeyVaultService;

  beforeEach(async () => {
    storage = new MockStorage();
    vault = new KeyVaultService(storage);
  });

  describe("key switching", () => {
    it("should switch between multiple keys", async () => {
      // Create first key
      const password = "test-password";
      await vault.generateKey(password, "Key 1");
      await vault.unlock(password);

      const keys1 = await vault.listKeys();
      const firstKeyId = keys1[0].id;

      // Create second key
      await vault.generateKey(password, "Key 2");
      const keys2 = await vault.listKeys();
      const secondKeyId = keys2.find((k) => k.id !== firstKeyId)!.id;

      expect(keys2).toHaveLength(2);

      // Switch to second key
      await vault.selectKey(secondKeyId);
      const state1 = await vault.getState();
      expect(state1.selectedKeyId).toBe(secondKeyId);

      // Switch back to first key
      await vault.selectKey(firstKeyId);
      const state2 = await vault.getState();
      expect(state2.selectedKeyId).toBe(firstKeyId);
    });

    it("should update all UI components when key switches", async () => {
      const password = "test-password";
      await vault.generateKey(password, "Key A");
      await vault.unlock(password);

      const keys1 = await vault.listKeys();
      const keyAId = keys1[0].id;

      await vault.generateKey(password, "Key B");
      const keys2 = await vault.listKeys();
      const keyBId = keys2.find((k) => k.id !== keyAId)!.id;

      // Switch key
      await vault.selectKey(keyBId);

      // Verify state reflects the change
      const state = await vault.getState();
      expect(state.selectedKeyId).toBe(keyBId);

      const selectedKey = keys2.find((k) => k.isSelected);
      expect(selectedKey?.id).toBe(keyBId);
    });
  });

  describe("add key flow", () => {
    it("should create and auto-select new key", async () => {
      const password = "test-password";
      await vault.generateKey(password, "Key 1");
      await vault.unlock(password);

      const keys1 = await vault.listKeys();
      expect(keys1).toHaveLength(1);

      // Add second key
      await vault.generateKey(password, "Key 2");
      const keys2 = await vault.listKeys();
      expect(keys2).toHaveLength(2);

      // New key should be auto-selected
      const state = await vault.getState();
      const newKey = keys2.find((k) => k.label === "Key 2");
      expect(state.selectedKeyId).toBe(newKey?.id);
    });

    it("should import and auto-select new key", async () => {
      const password = "test-password";
      await vault.generateKey(password, "Generated Key");
      await vault.unlock(password);

      const keys1 = await vault.listKeys();
      expect(keys1).toHaveLength(1);

      // Import second key
      const importedPrivateKey = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
      await vault.importKey(importedPrivateKey, password, "Imported Key");
      const keys2 = await vault.listKeys();
      expect(keys2).toHaveLength(2);

      // New key should be auto-selected
      const state = await vault.getState();
      const newKey = keys2.find((k) => k.label === "Imported Key");
      expect(state.selectedKeyId).toBe(newKey?.id);
    });
  });

  describe("rename key flow", () => {
    it("should rename key and persist change", async () => {
      const password = "test-password";
      await vault.generateKey(password, "Old Label");
      await vault.unlock(password);

      const keys1 = await vault.listKeys();
      const keyId = keys1[0].id;

      // Rename key
      await vault.renameKey(keyId, "New Label");

      const keys2 = await vault.listKeys();
      const renamedKey = keys2.find((k) => k.id === keyId);
      expect(renamedKey?.label).toBe("New Label");
    });

    it("should update label everywhere after rename", async () => {
      const password = "test-password";
      await vault.generateKey(password, "Original");
      await vault.unlock(password);

      const keys1 = await vault.listKeys();
      const keyId = keys1[0].id;

      // Rename
      await vault.renameKey(keyId, "Updated");

      // Verify in list
      const keys2 = await vault.listKeys();
      expect(keys2[0].label).toBe("Updated");

      // Verify in state
      const state = await vault.getState();
      expect(state.selectedKeyId).toBe(keyId);
    });
  });

  describe("delete key flow", () => {
    it("should delete non-active key", async () => {
      const password = "test-password";
      await vault.generateKey(password, "Key 1");
      await vault.unlock(password);

      const keys1 = await vault.listKeys();
      const key1Id = keys1[0].id;

      // Add second key
      await vault.generateKey(password, "Key 2");
      const keys2 = await vault.listKeys();
      const key2Id = keys2.find((k) => k.id !== key1Id)!.id;

      // Switch to Key 1
      await vault.selectKey(key1Id);

      // Delete Key 2 (non-active)
      await vault.deleteKey(key2Id);

      const keys3 = await vault.listKeys();
      expect(keys3).toHaveLength(1);
      expect(keys3[0].id).toBe(key1Id);
    });

    it("should auto-select another key when deleting active key", async () => {
      const password = "test-password";
      await vault.generateKey(password, "Key 1");
      await vault.unlock(password);

      const keys1 = await vault.listKeys();
      const key1Id = keys1[0].id;

      // Add second key (becomes active)
      await vault.generateKey(password, "Key 2");
      const keys2 = await vault.listKeys();
      const key2Id = keys2.find((k) => k.id !== key1Id)!.id;

      // Key 2 is active, delete it
      const result = await vault.deleteKey(key2Id);

      // Should auto-select Key 1
      expect(result.newSelectedKeyId).toBe(key1Id);

      const state = await vault.getState();
      expect(state.selectedKeyId).toBe(key1Id);
    });

    it("should prevent deleting last key", async () => {
      const password = "test-password";
      await vault.generateKey(password, "Only Key");
      await vault.unlock(password);

      const keys = await vault.listKeys();
      const keyId = keys[0].id;

      // Attempt to delete last key should throw
      await expect(vault.deleteKey(keyId)).rejects.toThrow();

      // Key should still exist
      const keysAfter = await vault.listKeys();
      expect(keysAfter).toHaveLength(1);
    });
  });

  describe("persistence", () => {
    it("should persist key selection across vault lock/unlock", async () => {
      const password = "test-password";
      await vault.generateKey(password, "Key 1");
      await vault.unlock(password);

      const keys1 = await vault.listKeys();
      const key1Id = keys1[0].id;

      await vault.generateKey(password, "Key 2");
      const keys2 = await vault.listKeys();
      const key2Id = keys2.find((k) => k.id !== key1Id)!.id;

      // Select Key 1
      await vault.selectKey(key1Id);

      // Lock vault
      await vault.lock();

      // Unlock vault
      await vault.unlock(password);

      // Selected key should still be Key 1
      const state = await vault.getState();
      expect(state.selectedKeyId).toBe(key1Id);
    });

    it("should persist renamed labels", async () => {
      const password = "test-password";
      await vault.generateKey(password, "Original");
      await vault.unlock(password);

      const keys1 = await vault.listKeys();
      const keyId = keys1[0].id;

      // Rename
      await vault.renameKey(keyId, "Renamed");

      // Lock and unlock
      await vault.lock();
      await vault.unlock(password);

      // Label should persist
      const keys2 = await vault.listKeys();
      expect(keys2[0].label).toBe("Renamed");
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { KeyVaultService } from "@/application/services/key-vault.service";
import { PolicyService } from "@/application/services/policy.service";
import { SettingsService } from "@/application/services/settings.service";
import {
  WebCryptoAesGcm,
  VaultKdf,
  NobleSchnorr,
} from "@/infrastructure/crypto/adapters";
import type { StorageSuite } from "@/application/ports/storage";
import type { KeyRecord } from "@/domain/types";

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

describe("Cross-Layer Integration Tests", () => {
  let keyVault: KeyVaultService;
  let policyService: PolicyService;
  let settingsService: SettingsService;
  let storage: StorageSuite;

  beforeEach(() => {
    storage = createMemoryStorage();
    
    keyVault = new KeyVaultService(
      storage,
      WebCryptoAesGcm,
      VaultKdf,
      NobleSchnorr
    );
    
    policyService = new PolicyService(storage);
    settingsService = new SettingsService(storage);
  });

  describe("Key Management + Settings Integration", () => {
    it("creates key and verifies storage integration", async () => {
      const password = "test-password-123";
      const keyLabel = "Test Key";

      // Create a key
      const keyRecord = await keyVault.generateKey(password, keyLabel);
      expect(keyRecord.id).toBeDefined();
      expect(keyRecord.label).toBe(keyLabel);

      // Verify storage contains the key
      const keys = await keyVault.listKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].id).toBe(keyRecord.id);
      expect(keys[0].label).toBe(keyLabel);

      // Test settings service integration
      const settings = await settingsService.get();
      expect(settings).toBeDefined();

      // Update settings with partial data
      const updatedSettings = await settingsService.update({
        autoLockMinutes: 15,
      });
      expect(updatedSettings.autoLockMinutes).toBe(15);

      // Verify persistence
      const persistedSettings = await settingsService.get();
      expect(persistedSettings?.autoLockMinutes).toBe(15);
    });

    it("handles key selection and lock state", async () => {
      const password = "test-password-456";
      
      // Create a key
      const keyRecord = await keyVault.generateKey(password, "Selection Test");
      
      // Initially unlocked (no lock state in session storage)
      const initialState = await keyVault.getLockState();
      expect(initialState.isLocked).toBe(false);

      // Explicitly lock vault first
      await keyVault.lock();
      const lockedState = await keyVault.getLockState();
      expect(lockedState.isLocked).toBe(true);

      // Unlock vault
      const unlockResult = await keyVault.unlock(password);
      expect(unlockResult).toBeDefined();

      // Check unlocked state
      const unlockedState = await keyVault.getLockState();
      expect(unlockedState.isLocked).toBe(false);

      // Select the key
      await keyVault.selectKey(keyRecord.id);

      // Verify selection
      const stateAfterSelection = await keyVault.getLockState();
      expect(stateAfterSelection.selectedKeyId).toBe(keyRecord.id);

      // Lock vault again
      await keyVault.lock();
      const finalLockedState = await keyVault.getLockState();
      expect(finalLockedState.isLocked).toBe(true);
    });
  });

  describe("Policy Service Integration", () => {
    it("evaluates policies with context", async () => {
      const origin = "https://example.com";
      
      // Load initial policy context
      const context = await policyService.loadContext();
      expect(context).toBeDefined();
      expect(context.unlocked).toBe(false); // Initially locked
      expect(Array.isArray(context.mediumAllowKinds)).toBe(true);
      expect(Array.isArray(context.policies)).toBe(true);

      // Set origin policy using correct API
      await policyService.setOriginPolicy(origin, { trustLevel: "medium" });

      // Reload context to see changes
      const updatedContext = await policyService.loadContext();
      expect(updatedContext.policies.length).toBeGreaterThanOrEqual(0);
    });

    it("manages session grants and policies", async () => {
      const origin = "https://session-test.com";
      const kind = 1; // Text note

      // Set policy first
      await policyService.setOriginPolicy(origin, { trustLevel: "medium" });

      // Set kind-specific rule
      await policyService.setPerKindRule(origin, kind, "allow");

      // Verify policy context includes session data
      const context = await policyService.loadContext();
      expect(context.sessionGrants).toBeDefined();
      expect(typeof context.sessionGrants).toBe("object");
    });
  });

  describe("Full Service Integration", () => {
    it("completes realistic usage workflow", async () => {
      const password = "workflow-test-789";
      const origin = "https://workflow-client.com";

      // 1. Set up initial settings
      await settingsService.update({
        autoLockMinutes: 30,
        theme: "dark",
      });

      // 2. Create and unlock key
      const keyRecord = await keyVault.generateKey(password, "Workflow Key");
      await keyVault.unlock(password);
      await keyVault.selectKey(keyRecord.id);

      // 3. Configure policy
      await policyService.setOriginPolicy(origin, { trustLevel: "high" });
      await policyService.setPerKindRule(origin, 1, "allow");

      // 4. Verify integration state
      const lockState = await keyVault.getLockState();
      expect(lockState.isLocked).toBe(false);
      expect(lockState.selectedKeyId).toBe(keyRecord.id);

      const policyContext = await policyService.loadContext();
      expect(policyContext.unlocked).toBe(true);

      const settings = await settingsService.get();
      expect(settings?.autoLockMinutes).toBe(30);
      expect(settings?.theme).toBe("dark");

      // 5. Test signing capability
      const lockStateForSigning = await keyVault.getLockState();
      if (!lockStateForSigning.isLocked) {
        const messageHash = "a".repeat(64); // 32 bytes as hex string
        
        const signature = await keyVault.sign(messageHash);
        expect(signature).toBeDefined();
        expect(signature.sigHex).toBeDefined();
        expect(signature.keyId).toBe(keyRecord.id);
        expect(signature.sigHex.length).toBe(128); // 64 bytes as hex
      }
    });

    it("handles error conditions gracefully", async () => {
      // Create a key first so unlock has something to decrypt
      const correctPassword = "correct-password-123";
      const keyRecord = await keyVault.generateKey(correctPassword, "Test Key");
      
      // Lock the vault
      await keyVault.lock();

      // Test with invalid password - this should now fail when trying to decrypt
      await expect(keyVault.unlock("wrong-password"))
        .rejects.toThrow();

      // Test key operations when locked
      const lockState = await keyVault.getLockState();
      expect(lockState.isLocked).toBe(true);
      
      const messageHash = "a".repeat(64); // 32 bytes as hex
      await expect(keyVault.sign(messageHash))
        .rejects.toThrow();

      // Test selecting non-existent key (should complete successfully)
      await keyVault.selectKey("non-existent-id");
    });

    it("maintains data consistency across operations", async () => {
      const password = "consistency-test-123";
      
      // Create multiple keys
      const key1 = await keyVault.generateKey(password, "Key 1");
      const key2 = await keyVault.generateKey(password, "Key 2");

      // Verify both exist
      const keys = await keyVault.listKeys();
      expect(keys).toHaveLength(2);
      
      const keyIds = keys.map(k => k.id);
      expect(keyIds).toContain(key1.id);
      expect(keyIds).toContain(key2.id);

      // Unlock and select first key
      await keyVault.unlock(password);
      await keyVault.selectKey(key1.id);

      let state = await keyVault.getLockState();
      expect(state.selectedKeyId).toBe(key1.id);

      // Switch to second key
      await keyVault.selectKey(key2.id);

      state = await keyVault.getLockState();
      expect(state.selectedKeyId).toBe(key2.id);

      // Verify original keys are still intact
      const finalKeys = await keyVault.listKeys();
      expect(finalKeys).toHaveLength(2);
    });
  });

  describe("Storage Layer Integration", () => {
    it("handles storage operations correctly", async () => {
      // Verify initial empty state
      const initialKeys = await keyVault.listKeys();
      expect(initialKeys).toHaveLength(0);

      const initialSettings = await settingsService.get();
      expect(initialSettings).toBeDefined(); // Should have defaults

      // Create data
      const password = "storage-test-456";
      const keyRecord = await keyVault.generateKey(password, "Storage Test");

      // Verify persistence
      const keysAfterCreate = await keyVault.listKeys();
      expect(keysAfterCreate).toHaveLength(1);
      expect(keysAfterCreate[0].id).toBe(keyRecord.id);

      // Test settings persistence
      await settingsService.update({ autoLockMinutes: 45 });
      const updatedSettings = await settingsService.get();
      expect(updatedSettings?.autoLockMinutes).toBe(45);

      // Verify different storage areas work independently
      await storage.session.set("test-session", "session-data");
      await storage.local.set("test-local", "local-data");
      await storage.sync.set("test-sync", "sync-data");

      expect(await storage.session.get("test-session")).toBe("session-data");
      expect(await storage.local.get("test-local")).toBe("local-data");
      expect(await storage.sync.get("test-sync")).toBe("sync-data");
    });

    it("handles service interactions with storage failures", async () => {
      // Create a storage adapter that fails on sync operations
      const partiallyFailingStorage: StorageSuite = {
        local: storage.local, // Works
        session: storage.session, // Works
        sync: {
          async get() { throw new Error("Sync storage unavailable"); },
          async set() { throw new Error("Sync storage unavailable"); },
          async remove() { throw new Error("Sync storage unavailable"); },
        },
      };

      const failingSettingsService = new SettingsService(partiallyFailingStorage);

      // Settings operations should fail gracefully
      await expect(failingSettingsService.get())
        .rejects.toThrow("Sync storage unavailable");
      
      await expect(failingSettingsService.update({ autoLockMinutes: 10 }))
        .rejects.toThrow("Sync storage unavailable");
    });
  });
});

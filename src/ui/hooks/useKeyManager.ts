/**
 * Key management and lock state hooks for Ostrilo
 * Handles encrypted key storage, unlock/lock states, and auto-lock timers
 * Now uses React Context for proper state management
 */

import { useCallback } from "react";
import browser from "webextension-polyfill";
import { unlockVault as rpcUnlock } from "@/infrastructure/messaging/client";
import {
  generateKeyPair,
  parsePrivateKey,
  encryptPrivateKey,
  decryptPrivateKey,
  publicKeyToHex,
  publicKeyToBech32,
  privateKeyToBech32,
  zeroize,
  PasswordStrength,
  evaluatePasswordStrength,
} from "@/domain/utils/crypto";
import { KeyRecord } from "@/domain/types";
import { useAppSettings } from "./useAppSettings";
import {
  useKeyManagerContext,
  ENCRYPTED_KEYS_STORAGE,
} from "./KeyManagerContext";
import type { UnlockedKey, LockState } from "./KeyManagerContext";

/**
 * Main hook for key management and lock state
 * Now uses React Context for state management instead of global variables
 */
export function useKeyManager() {
  const { updateSettings, settings } = useAppSettings();
  const {
    lockState,
    keys,
    isLoading,
    biometricAvailable,
    setLockState,
    setIsLoading,
    lock,
    updateActivity,
    saveEncryptedKeys,
    loadKeys,
  } = useKeyManagerContext();

  // Unlock with password
  const unlock = useCallback(
    async (password: string): Promise<boolean> => {
      try {
        setIsLoading(true);

        // Delegate to background vault unlock
        const { selectedKeyId } = await rpcUnlock(password);
        setLockState((prev) => ({
          ...prev,
          isLocked: false,
          selectedKeyId: selectedKeyId ?? prev.selectedKeyId,
        }));

        updateActivity();
        return true;
      } catch (error) {
        console.error("Unlock failed:", error);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [setIsLoading, setLockState, updateActivity]
  );

  // Generate new key
  const generateKey = useCallback(
    async (password: string, label?: string): Promise<string> => {
      try {
        const keyPair = generateKeyPair();
        const publicKeyHex = publicKeyToHex(keyPair.publicKey);

        // Encrypt the private key
        const encrypted = await encryptPrivateKey(keyPair.privateKey, password);

        // Create key record
        const keyRecord: KeyRecord = {
          id: crypto.randomUUID(),
          label,
          pubkey: publicKeyHex,
          ct: encrypted.ct,
          iv: encrypted.iv,
          salt: encrypted.salt,
          createdAt: Math.floor(Date.now() / 1000),
          lastUsedAt: Math.floor(Date.now() / 1000),
          isSelected: keys.length === 0, // First key is selected by default
        };

        // Save to local storage only
        const currentKeys = [...keys, keyRecord];
        console.log("Saving new key, total keys now:", currentKeys.length);
        await saveEncryptedKeys(currentKeys);

        // Update only selectedKeyId in sync settings if this is the first key
        if (keyRecord.isSelected) {
          await updateSettings({
            selectedKeyId: keyRecord.id,
          });
        }

        // If unlocked, add to memory
        if (!lockState.isLocked) {
          const unlockedKey: UnlockedKey = {
            id: keyRecord.id,
            label: label || "Unnamed",
            privateKey: keyPair.privateKey,
            publicKey: keyPair.publicKey,
            publicKeyHex,
            publicKeyBech32: publicKeyToBech32(keyPair.publicKey),
          };

          setLockState((prev) => ({
            ...prev,
            unlockedKeys: new Map(prev.unlockedKeys).set(
              keyRecord.id,
              unlockedKey
            ),
            selectedKeyId: keyRecord.isSelected
              ? keyRecord.id
              : prev.selectedKeyId,
          }));
        } else {
          // Clean up private key from memory
          zeroize(keyPair.privateKey);
        }

        return keyRecord.id;
      } catch (error) {
        console.error("Key generation failed:", error);
        throw error;
      }
    },
    [keys, lockState.isLocked, updateSettings, saveEncryptedKeys, setLockState]
  );

  // Import existing key
  const importKey = useCallback(
    async (
      keyInput: string,
      password: string,
      label?: string
    ): Promise<string> => {
      try {
        const privateKey = parsePrivateKey(keyInput);
        const publicKeyBytes = new Uint8Array(33); // Will be set by getPublicKey

        // Derive public key
        const { getPublicKey } = await import("@/domain/utils/crypto");
        const derivedPublicKey = getPublicKey(privateKey);
        const publicKeyHex = publicKeyToHex(derivedPublicKey);

        // Check if key already exists
        const existingKey = keys.find((k) => k.pubkey === publicKeyHex);
        if (existingKey) {
          throw new Error("This key has already been imported");
        }

        // Encrypt the private key
        const encrypted = await encryptPrivateKey(privateKey, password);

        // Create key record
        const keyRecord: KeyRecord = {
          id: crypto.randomUUID(),
          label,
          pubkey: publicKeyHex,
          ct: encrypted.ct,
          iv: encrypted.iv,
          salt: encrypted.salt,
          createdAt: Math.floor(Date.now() / 1000),
          lastUsedAt: Math.floor(Date.now() / 1000),
          isSelected: keys.length === 0, // First key is selected by default
        };

        // Save to local storage only
        const currentKeys = [...keys, keyRecord];
        await saveEncryptedKeys(currentKeys);

        // Update only selectedKeyId in sync settings if this is the first key
        if (keyRecord.isSelected) {
          await updateSettings({
            selectedKeyId: keyRecord.id,
          });
        }

        // If unlocked, add to memory
        if (!lockState.isLocked) {
          const unlockedKey: UnlockedKey = {
            id: keyRecord.id,
            label: label || "Unnamed",
            privateKey,
            publicKey: derivedPublicKey,
            publicKeyHex,
            publicKeyBech32: publicKeyToBech32(derivedPublicKey),
          };

          setLockState((prev) => ({
            ...prev,
            unlockedKeys: new Map(prev.unlockedKeys).set(
              keyRecord.id,
              unlockedKey
            ),
            selectedKeyId: keyRecord.isSelected
              ? keyRecord.id
              : prev.selectedKeyId,
          }));
        } else {
          // Clean up private key from memory
          zeroize(privateKey);
        }

        return keyRecord.id;
      } catch (error) {
        console.error("Key import failed:", error);
        throw error;
      }
    },
    [keys, lockState.isLocked, updateSettings, saveEncryptedKeys, setLockState]
  );

  // Export key (requires unlock)
  const exportKey = useCallback(
    (keyId: string): string | null => {
      if (lockState.isLocked) {
        throw new Error("Extension must be unlocked to export keys");
      }

      const unlockedKey = lockState.unlockedKeys.get(keyId);
      if (!unlockedKey) {
        throw new Error("Key not found or not unlocked");
      }

      return privateKeyToBech32(unlockedKey.privateKey);
    },
    [lockState.isLocked, lockState.unlockedKeys]
  );

  // Select active key
  const selectKey = useCallback(
    async (keyId: string) => {
      // Allow selection even if locked—BG tracks selected in sync; UI uses selectedKeyId for display

      // Update keys in local storage
      const updatedKeys = keys.map((k) => ({
        ...k,
        isSelected: k.id === keyId,
      }));

      await saveEncryptedKeys(updatedKeys);

      // Update only selectedKeyId in sync settings
      await updateSettings({
        selectedKeyId: keyId,
      });

      // Update lock state
      setLockState((prev) => ({ ...prev, selectedKeyId: keyId }));
      updateActivity();
    },
    [keys, saveEncryptedKeys, updateSettings, setLockState, updateActivity]
  );

  // Get current selected unlocked key
  const selectedUnlockedKey = lockState.selectedKeyId
    ? lockState.unlockedKeys.get(lockState.selectedKeyId)
    : undefined;

  return {
    // State
    isLocked: lockState.isLocked,
    isLoading,
    selectedUnlockedKey,
    hasKeys: keys.length > 0,
    biometricAvailable,

    // Actions
    lock,
    unlock,
    generateKey,
    importKey,
    exportKey,
    selectKey,
    updateActivity,

    // Utilities
    evaluatePasswordStrength,
  };
}

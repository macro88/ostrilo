/**
 * Key management and lock state hooks for Ostrilo
 * Handles encrypted key storage, unlock/lock states, and auto-lock timers
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import browser from 'webextension-polyfill';
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
  isPlatformAuthenticatorAvailable
} from '@/lib/crypto';
import { KeyRecord } from '@/lib/settings';
import { useAppSettings } from './useAppSettings';

// Types
export interface UnlockedKey {
  id: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyHex: string;
  publicKeyBech32: string;
}

export interface LockState {
  isLocked: boolean;
  unlockedKeys: Map<string, UnlockedKey>;
  selectedKeyId?: string;
  lastActivity: number;
}

// Storage keys
const ENCRYPTED_KEYS_STORAGE = 'encryptedKeys';
const LOCK_STATE_STORAGE = 'lockState';

// Memory-only lock state (cleared on extension restart)
let globalLockState: LockState = {
  isLocked: true,
  unlockedKeys: new Map(),
  selectedKeyId: undefined,
  lastActivity: Date.now()
};

/**
 * Main hook for key management and lock state
 */
export function useKeyManager() {
  const { settings, updateSettings, selectedKey: settingsSelectedKey } = useAppSettings();
  const [lockState, setLockState] = useState<LockState>(globalLockState);
  const [isLoading, setIsLoading] = useState(true);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const autoLockTimer = useRef<number | null>(null);

  // Check biometric availability on mount
  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(setBiometricAvailable);
  }, []);

  // Update global state when local state changes
  useEffect(() => {
    globalLockState = lockState;
  }, [lockState]);

  // Auto-lock timer management
  const resetAutoLockTimer = useCallback(() => {
    if (autoLockTimer.current !== null) {
      window.clearTimeout(autoLockTimer.current);
    }

    if (settings.autoLockMinutes > 0 && !lockState.isLocked) {
      autoLockTimer.current = window.setTimeout(() => {
        lock();
      }, settings.autoLockMinutes * 60 * 1000);
    }
  }, [settings.autoLockMinutes, lockState.isLocked]);

  // Update activity timestamp and reset timer
  const updateActivity = useCallback(() => {
    const now = Date.now();
    setLockState(prev => ({ ...prev, lastActivity: now }));
    resetAutoLockTimer();
  }, [resetAutoLockTimer]);

  // Lock the extension
  const lock = useCallback(() => {
    // Zero out all private keys in memory
    globalLockState.unlockedKeys.forEach(key => {
      zeroize(key.privateKey);
    });

    setLockState({
      isLocked: true,
      unlockedKeys: new Map(),
      selectedKeyId: undefined,
      lastActivity: Date.now()
    });

    if (autoLockTimer.current !== null) {
      window.clearTimeout(autoLockTimer.current);
    }
  }, []);

  // Unlock with password
  const unlock = useCallback(async (password: string): Promise<boolean> => {
    try {
      setIsLoading(true);

      // Get encrypted keys from storage
      const result = await browser.storage.local.get([ENCRYPTED_KEYS_STORAGE]);
      const encryptedKeys = result[ENCRYPTED_KEYS_STORAGE] as KeyRecord[] || [];

      if (encryptedKeys.length === 0) {
        // No keys to unlock
        setLockState(prev => ({ ...prev, isLocked: false }));
        updateActivity();
        return true;
      }

      // Try to decrypt at least one key to verify password
      const unlockedKeys = new Map<string, UnlockedKey>();
      let passwordVerified = false;

      for (const keyRecord of encryptedKeys) {
        try {
          const privateKey = await decryptPrivateKey({
            ct: keyRecord.ct,
            iv: keyRecord.iv,
            salt: keyRecord.salt
          }, password);

          const publicKey = keyRecord.pubkey; // Already stored as hex
          const publicKeyBytes = new Uint8Array(
            publicKey.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
          );

          const unlockedKey: UnlockedKey = {
            id: keyRecord.id,
            privateKey,
            publicKey: publicKeyBytes,
            publicKeyHex: publicKey,
            publicKeyBech32: publicKeyToBech32(publicKeyBytes)
          };

          unlockedKeys.set(keyRecord.id, unlockedKey);
          passwordVerified = true;
        } catch (error) {
          console.error(`Failed to decrypt key ${keyRecord.id}:`, error);
          // Continue trying other keys
        }
      }

      if (!passwordVerified) {
        throw new Error('Invalid password');
      }

      // Determine selected key
      let selectedKeyId = settings.selectedKeyId;
      if (!selectedKeyId || !unlockedKeys.has(selectedKeyId)) {
        selectedKeyId = unlockedKeys.keys().next().value;
      }

      setLockState({
        isLocked: false,
        unlockedKeys,
        selectedKeyId,
        lastActivity: Date.now()
      });

      updateActivity();
      return true;
    } catch (error) {
      console.error('Unlock failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [settings.selectedKeyId, updateActivity]);

  // Generate new key
  const generateKey = useCallback(async (password: string, label?: string): Promise<string> => {
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
        isSelected: settings.keys.length === 0 // First key is selected by default
      };

      // Save to storage
      const currentKeys = [...settings.keys, keyRecord];
      await updateSettings({ 
        keys: currentKeys,
        selectedKeyId: keyRecord.isSelected ? keyRecord.id : settings.selectedKeyId
      });

      // Also save encrypted keys separately for unlock process
      await saveEncryptedKeys(currentKeys);

      // If unlocked, add to memory
      if (!lockState.isLocked) {
        const unlockedKey: UnlockedKey = {
          id: keyRecord.id,
          privateKey: keyPair.privateKey,
          publicKey: keyPair.publicKey,
          publicKeyHex,
          publicKeyBech32: publicKeyToBech32(keyPair.publicKey)
        };

        setLockState(prev => ({
          ...prev,
          unlockedKeys: new Map(prev.unlockedKeys).set(keyRecord.id, unlockedKey),
          selectedKeyId: keyRecord.isSelected ? keyRecord.id : prev.selectedKeyId
        }));
      } else {
        // Clean up private key from memory
        zeroize(keyPair.privateKey);
      }

      return keyRecord.id;
    } catch (error) {
      console.error('Key generation failed:', error);
      throw error;
    }
  }, [settings.keys, settings.selectedKeyId, lockState.isLocked, updateSettings]);

  // Import existing key
  const importKey = useCallback(async (keyInput: string, password: string, label?: string): Promise<string> => {
    try {
      const privateKey = parsePrivateKey(keyInput);
      const publicKeyBytes = new Uint8Array(33); // Will be set by getPublicKey
      
      // Derive public key
      const { getPublicKey } = await import('@/lib/crypto');
      const derivedPublicKey = getPublicKey(privateKey);
      const publicKeyHex = publicKeyToHex(derivedPublicKey);
      
      // Check if key already exists
      const existingKey = settings.keys.find(k => k.pubkey === publicKeyHex);
      if (existingKey) {
        throw new Error('This key has already been imported');
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
        isSelected: settings.keys.length === 0 // First key is selected by default
      };

      // Save to storage
      const currentKeys = [...settings.keys, keyRecord];
      await updateSettings({ 
        keys: currentKeys,
        selectedKeyId: keyRecord.isSelected ? keyRecord.id : settings.selectedKeyId
      });

      // Also save encrypted keys separately
      await saveEncryptedKeys(currentKeys);

      // If unlocked, add to memory
      if (!lockState.isLocked) {
        const unlockedKey: UnlockedKey = {
          id: keyRecord.id,
          privateKey,
          publicKey: derivedPublicKey,
          publicKeyHex,
          publicKeyBech32: publicKeyToBech32(derivedPublicKey)
        };

        setLockState(prev => ({
          ...prev,
          unlockedKeys: new Map(prev.unlockedKeys).set(keyRecord.id, unlockedKey),
          selectedKeyId: keyRecord.isSelected ? keyRecord.id : prev.selectedKeyId
        }));
      } else {
        // Clean up private key from memory
        zeroize(privateKey);
      }

      return keyRecord.id;
    } catch (error) {
      console.error('Key import failed:', error);
      throw error;
    }
  }, [settings.keys, settings.selectedKeyId, lockState.isLocked, updateSettings]);

  // Export key (requires unlock)
  const exportKey = useCallback((keyId: string): string | null => {
    if (lockState.isLocked) {
      throw new Error('Extension must be unlocked to export keys');
    }

    const unlockedKey = lockState.unlockedKeys.get(keyId);
    if (!unlockedKey) {
      throw new Error('Key not found or not unlocked');
    }

    return privateKeyToBech32(unlockedKey.privateKey);
  }, [lockState.isLocked, lockState.unlockedKeys]);

  // Select active key
  const selectKey = useCallback(async (keyId: string) => {
    if (!lockState.unlockedKeys.has(keyId)) {
      throw new Error('Key not found or not unlocked');
    }

    // Update settings
    const updatedKeys = settings.keys.map(k => ({
      ...k,
      isSelected: k.id === keyId
    }));

    await updateSettings({
      keys: updatedKeys,
      selectedKeyId: keyId
    });

    // Update lock state
    setLockState(prev => ({ ...prev, selectedKeyId: keyId }));
    updateActivity();
  }, [lockState.unlockedKeys, settings.keys, updateSettings, updateActivity]);

  // Helper to save encrypted keys to local storage
  const saveEncryptedKeys = useCallback(async (keys: KeyRecord[]) => {
    await browser.storage.local.set({
      [ENCRYPTED_KEYS_STORAGE]: keys
    });
  }, []);

  // Initialize lock state on mount
  useEffect(() => {
    const initLockState = async () => {
      try {
        setIsLoading(true);
        
        // Check if we have any keys
        if (settings.keys.length === 0) {
          setLockState(prev => ({ ...prev, isLocked: false }));
        }
        
        updateActivity();
      } finally {
        setIsLoading(false);
      }
    };

    initLockState();
  }, [settings.keys.length, updateActivity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoLockTimer.current !== null) {
        window.clearTimeout(autoLockTimer.current);
      }
    };
  }, []);

  // Get current selected unlocked key
  const selectedUnlockedKey = lockState.selectedKeyId 
    ? lockState.unlockedKeys.get(lockState.selectedKeyId)
    : undefined;

  return {
    // State
    isLocked: lockState.isLocked,
    isLoading,
    selectedUnlockedKey,
    hasKeys: settings.keys.length > 0,
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
    evaluatePasswordStrength
  };
}

/**
 * Hook for first-run detection and onboarding state
 */
export function useOnboarding() {
  const { settings, updateSettings } = useAppSettings();
  const { hasKeys, isLocked } = useKeyManager();
  
  const isFirstRun = settings.keys.length === 0;
  const needsOnboarding = isFirstRun;
  const needsUnlock = hasKeys && isLocked;
  
  const markOnboardingComplete = async () => {
    // Set a flag in settings to indicate onboarding is complete
    // This could be used for showing help tips or other first-time user guidance
    await updateSettings({
      onboardingCompleted: true,
      onboardingCompletedAt: Math.floor(Date.now() / 1000)
    });
  };
  
  return {
    isFirstRun,
    needsOnboarding,
    needsUnlock,
    hasKeys,
    markOnboardingComplete
  };
}

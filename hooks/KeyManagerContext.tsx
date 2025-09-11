/**
 * Key Management Context Provider
 * Provides centralized lock state management using React Context
 * Replaces the problematic global state approach with proper React patterns
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode,
} from "react";
import browser from "webextension-polyfill";
import { zeroize } from "@/lib/crypto";
import { KeyRecord } from "@/lib/settings";
import { useAppSettings } from "./useAppSettings";

// Types
export interface UnlockedKey {
  id: string;
  label: string;
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

export interface KeyManagerContextType {
  // State
  lockState: LockState;
  keys: KeyRecord[];
  isLoading: boolean;
  biometricAvailable: boolean;

  // State setters
  setLockState: React.Dispatch<React.SetStateAction<LockState>>;
  setKeys: React.Dispatch<React.SetStateAction<KeyRecord[]>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;

  // Actions
  lock: () => void;
  updateActivity: () => void;

  // Storage helpers
  saveEncryptedKeys: (keysToSave: KeyRecord[]) => Promise<void>;
  loadKeys: () => Promise<KeyRecord[]>;
}

// Storage keys
export const ENCRYPTED_KEYS_STORAGE = "encryptedKeys";

// Create context
const KeyManagerContext = createContext<KeyManagerContextType | null>(null);

// Provider props
interface KeyManagerProviderProps {
  children: ReactNode;
}

/**
 * KeyManagerProvider - Provides centralized key management state
 *
 * This provider manages:
 * - Lock state (locked/unlocked, unlocked keys, selected key)
 * - Encrypted keys storage and loading
 * - Auto-lock timer functionality
 * - Activity tracking
 *
 * Security considerations:
 * - Private keys are zeroed out on lock
 * - Auto-lock timer clears sensitive data
 * - State is properly cleaned up on unmount
 */
export function KeyManagerProvider({ children }: KeyManagerProviderProps) {
  const { settings } = useAppSettings();

  // Core state
  const [lockState, setLockState] = useState<LockState>({
    isLocked: true,
    unlockedKeys: new Map(),
    selectedKeyId: undefined,
    lastActivity: Date.now(),
  });

  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  // Auto-lock timer
  const autoLockTimer = useRef<number | null>(null);

  // Check biometric availability on mount
  useEffect(() => {
    import("@/lib/crypto").then(({ isPlatformAuthenticatorAvailable }) => {
      isPlatformAuthenticatorAvailable().then(setBiometricAvailable);
    });
  }, []);

  // Auto-lock timer management
  const resetAutoLockTimer = useCallback(() => {
    if (autoLockTimer.current !== null) {
      window.clearTimeout(autoLockTimer.current);
      autoLockTimer.current = null;
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
    setLockState((prev) => ({ ...prev, lastActivity: now }));
    resetAutoLockTimer();
  }, [resetAutoLockTimer]);

  // Lock the extension - SECURITY CRITICAL
  const lock = useCallback(() => {
    // Zero out all private keys in memory for security
    lockState.unlockedKeys.forEach((key) => {
      zeroize(key.privateKey);
    });

    setLockState({
      isLocked: true,
      unlockedKeys: new Map(),
      selectedKeyId: undefined,
      lastActivity: Date.now(),
    });

    // Clear auto-lock timer
    if (autoLockTimer.current !== null) {
      window.clearTimeout(autoLockTimer.current);
      autoLockTimer.current = null;
    }
  }, [lockState.unlockedKeys]);

  // Helper to save encrypted keys to local storage
  const saveEncryptedKeys = useCallback(
    async (keysToSave: KeyRecord[]): Promise<void> => {
      await browser.storage.local.set({
        [ENCRYPTED_KEYS_STORAGE]: keysToSave,
      });
      setKeys(keysToSave);
    },
    []
  );

  // Helper to load keys from local storage
  const loadKeys = useCallback(async (): Promise<KeyRecord[]> => {
    try {
      const result = await browser.storage.local.get([ENCRYPTED_KEYS_STORAGE]);
      const loadedKeys = (result[ENCRYPTED_KEYS_STORAGE] || []) as KeyRecord[];
      setKeys(loadedKeys);
      return loadedKeys;
    } catch (error) {
      console.error("Failed to load keys:", error);
      return [];
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    const initializeKeyManager = async () => {
      try {
        setIsLoading(true);

        // Load keys from storage
        await loadKeys();

        // Initialize activity tracking
        updateActivity();
      } finally {
        setIsLoading(false);
      }
    };

    initializeKeyManager();
  }, [loadKeys, updateActivity]);

  // Reset auto-lock timer when settings or lock state changes
  useEffect(() => {
    resetAutoLockTimer();
  }, [resetAutoLockTimer]);

  // Cleanup on unmount - SECURITY CRITICAL
  useEffect(() => {
    return () => {
      // Clear timer
      if (autoLockTimer.current !== null) {
        window.clearTimeout(autoLockTimer.current);
      }

      // Zero out any remaining private keys
      lockState.unlockedKeys.forEach((key) => {
        zeroize(key.privateKey);
      });
    };
  }, [lockState.unlockedKeys]);

  const contextValue: KeyManagerContextType = {
    // State
    lockState,
    keys,
    isLoading,
    biometricAvailable,

    // State setters
    setLockState,
    setKeys,
    setIsLoading,

    // Actions
    lock,
    updateActivity,

    // Storage helpers
    saveEncryptedKeys,
    loadKeys,
  };

  return (
    <KeyManagerContext.Provider value={contextValue}>
      {children}
    </KeyManagerContext.Provider>
  );
}

/**
 * Hook to access KeyManager context
 * Throws error if used outside of KeyManagerProvider
 */
export function useKeyManagerContext(): KeyManagerContextType {
  const context = useContext(KeyManagerContext);
  if (!context) {
    throw new Error(
      "useKeyManagerContext must be used within a KeyManagerProvider. " +
        "Make sure to wrap your app with <KeyManagerProvider>."
    );
  }
  return context;
}

/**
 * Hook to check if we're inside a KeyManagerProvider
 * Useful for conditional rendering or error boundaries
 */
export function useIsKeyManagerProvided(): boolean {
  return useContext(KeyManagerContext) !== null;
}

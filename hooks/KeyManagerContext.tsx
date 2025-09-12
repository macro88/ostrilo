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

// Storage keys
export const ENCRYPTED_KEYS_STORAGE = "encryptedKeys"; // Local storage for encrypted keys
export const LOCK_STATE_STORAGE = "lockState"; // Session storage for lock state

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

// Serializable lock state for storage (Map cannot be serialized)
interface PersistedLockState {
  isLocked: boolean;
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

  // Derive biometric availability synchronously
  const biometricAvailable =
    typeof navigator !== "undefined" &&
    typeof (navigator as any).credentials !== "undefined" &&
    typeof (navigator as any).credentials.create === "function";

  // Auto-lock timer
  const autoLockTimer = useRef<number | null>(null);

  // Auto-lock timer management
  const resetAutoLockTimer = useCallback(() => {
    if (autoLockTimer.current !== null) {
      window.clearTimeout(autoLockTimer.current);
      autoLockTimer.current = null;
    }

    // Only set timer if auto-lock is enabled
    if (settings.autoLockMinutes > 0) {
      autoLockTimer.current = window.setTimeout(() => {
        // Force lock by calling the lock function
        setLockState((currentState) => {
          // Zero out all private keys in memory for security
          currentState.unlockedKeys.forEach((key) => {
            zeroize(key.privateKey);
          });

          const newLockState = {
            isLocked: true,
            unlockedKeys: new Map(),
            selectedKeyId: undefined,
            lastActivity: Date.now(),
          };

          // Persist locked state to session storage
          const persistedState: PersistedLockState = {
            isLocked: newLockState.isLocked,
            selectedKeyId: newLockState.selectedKeyId,
            lastActivity: newLockState.lastActivity,
          };
          browser.storage.session.set({ [LOCK_STATE_STORAGE]: persistedState });

          return newLockState;
        });
      }, settings.autoLockMinutes * 60 * 1000);
    }
  }, [settings.autoLockMinutes]);

  // Update activity timestamp and reset timer
  const updateActivity = useCallback(async () => {
    const now = Date.now();
    setLockState((prev) => {
      const newState = { ...prev, lastActivity: now };

      // Persist state to session storage if unlocked
      if (!newState.isLocked) {
        const persistedState: PersistedLockState = {
          isLocked: newState.isLocked,
          selectedKeyId: newState.selectedKeyId,
          lastActivity: newState.lastActivity,
        };
        browser.storage.session.set({ [LOCK_STATE_STORAGE]: persistedState });
      }

      return newState;
    });
    resetAutoLockTimer();
  }, [resetAutoLockTimer]);

  // Lock the extension - SECURITY CRITICAL
  const lock = useCallback(async () => {
    // Zero out all private keys in memory for security
    lockState.unlockedKeys.forEach((key) => {
      zeroize(key.privateKey);
    });

    const newLockState = {
      isLocked: true,
      unlockedKeys: new Map(),
      selectedKeyId: undefined,
      lastActivity: Date.now(),
    };

    setLockState(newLockState);

    // Persist lock state to session storage (cleared on browser close)
    const persistedState: PersistedLockState = {
      isLocked: newLockState.isLocked,
      selectedKeyId: newLockState.selectedKeyId,
      lastActivity: newLockState.lastActivity,
    };
    await browser.storage.session.set({ [LOCK_STATE_STORAGE]: persistedState });

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

        // Check if we should restore a previous unlocked session from session storage
        const result = await browser.storage.session.get([LOCK_STATE_STORAGE]);
        const persistedLockState = result[LOCK_STATE_STORAGE] as
          | PersistedLockState
          | undefined;

        if (persistedLockState && !persistedLockState.isLocked) {
          // Check if we're still within the auto-lock window
          const timeSinceLastActivity =
            Date.now() - persistedLockState.lastActivity;
          const autoLockMs = settings.autoLockMinutes * 60 * 1000;

          if (
            settings.autoLockMinutes === 0 ||
            timeSinceLastActivity < autoLockMs
          ) {
            // We're still within the valid session window
            // Set state to unlocked but keys will need to be re-decrypted when accessed
            setLockState({
              isLocked: false,
              unlockedKeys: new Map(), // Empty until password is re-entered
              selectedKeyId: persistedLockState.selectedKeyId,
              lastActivity: persistedLockState.lastActivity,
            });
            // Note: Don't call updateActivity here to avoid initialization loops
            return;
          }
        }

        // If we get here, we should be locked (either no previous state, was locked, or timeout expired)
        await lock();
      } finally {
        setIsLoading(false);
      }
    };

    initializeKeyManager();
  }, [loadKeys, settings.autoLockMinutes]); // Removed updateActivity and lock to prevent loops

  // Reset auto-lock timer when settings change, but only after initialization
  useEffect(() => {
    if (!isLoading) {
      resetAutoLockTimer();
    }
  }, [resetAutoLockTimer, isLoading]);

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

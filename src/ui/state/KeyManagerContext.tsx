/**
 * Secure Key Management Context - UI Layer Only
 * Uses RPC calls to background service, never handles plaintext private keys
 * Follows background-first security principle
 */

import React, {
  createContext,
  use,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import {
  unlockVault,
  lockVault,
  listKeys,
  getLockState,
  generateKey as rpcGenerateKey,
  importKey as rpcImportKey,
  selectKey as rpcSelectKey,
} from "@/infrastructure/messaging/client";
import { KeyRecord } from "@/domain/types";
import { hexToBytes, publicKeyToBech32 } from "@/domain/utils/encoding";

// Secure UI-only types - no plaintext private keys
export interface UIKeyInfo {
  id: string;
  label: string;
  publicKeyHex: string;
  publicKeyBech32: string;
  createdAt: number;
  lastUsedAt: number;
  isSelected: boolean;
}

export interface UILockState {
  isLocked: boolean;
  selectedKeyId?: string;
  lastActivity: number;
}

interface KeyManagerContextType {
  // State
  isLocked: boolean;
  isLoading: boolean;
  selectedKeyInfo?: UIKeyInfo;
  keys: UIKeyInfo[];
  hasKeys: boolean;

  // Actions (all via RPC)
  lock: () => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  generateKey: (password: string, label?: string) => Promise<string>;
  importKey: (
    keyInput: string,
    password: string,
    label?: string
  ) => Promise<string>;
  selectKey: (keyId: string) => Promise<void>;
  refreshKeys: () => Promise<void>;
}

const KeyManagerContext = createContext<KeyManagerContextType | undefined>(
  undefined
);

export function useKeyManagerContext() {
  const context = use(KeyManagerContext);
  if (!context) {
    throw new Error(
      "useKeyManagerContext must be used within KeyManagerProvider"
    );
  }
  return context;
}

interface KeyManagerProviderProps {
  children: ReactNode;
}

export function KeyManagerProvider({ children }: KeyManagerProviderProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [lockState, setLockState] = useState<UILockState>({
    isLocked: true,
    lastActivity: Date.now(),
  });
  const [keys, setKeys] = useState<UIKeyInfo[]>([]);

  // Load initial state
  useEffect(() => {
    const loadInitialState = async () => {
      try {
        setIsLoading(true);
        const [lockStateResult, keysResult] = await Promise.all([
          getLockState(),
          listKeys(),
        ]);

        setLockState({
          isLocked: lockStateResult.isLocked,
          selectedKeyId: lockStateResult.selectedKeyId,
          lastActivity: Date.now(),
        });

        // Convert KeyRecord to UIKeyInfo (remove sensitive fields)
        const uiKeys: UIKeyInfo[] = keysResult.map((key: KeyRecord) => ({
          id: key.id,
          label: key.label || "Unnamed",
          publicKeyHex: key.pubkey,
          publicKeyBech32: publicKeyToBech32(hexToBytes(key.pubkey)),
          createdAt: key.createdAt,
          lastUsedAt: key.lastUsedAt || key.createdAt, // Use createdAt as fallback
          isSelected: key.isSelected || false,
        }));

        setKeys(uiKeys);
      } catch (error) {
        console.error("Failed to load key manager state:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialState();
  }, []);

  const refreshKeys = useCallback(async () => {
    try {
      const keysResult = await listKeys();
      const uiKeys: UIKeyInfo[] = keysResult.map((key: KeyRecord) => ({
        id: key.id,
        label: key.label || "Unnamed",
        publicKeyHex: key.pubkey,
        publicKeyBech32: publicKeyToBech32(hexToBytes(key.pubkey)),
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt || key.createdAt, // Use createdAt as fallback
        isSelected: key.isSelected || false,
      }));
      setKeys(uiKeys);
    } catch (error) {
      console.error("Failed to refresh keys:", error);
    }
  }, []);

  const lock = useCallback(async () => {
    try {
      setIsLoading(true);
      await lockVault();
      setLockState((prev) => ({ ...prev, isLocked: true }));
    } catch (error) {
      console.error("Lock failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      const result = await unlockVault(password);
      setLockState((prev) => ({
        ...prev,
        isLocked: false,
        selectedKeyId: result.selectedKeyId ?? prev.selectedKeyId,
        lastActivity: Date.now(),
      }));
      return true;
    } catch (error) {
      console.error("Unlock failed:", error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const generateKey = useCallback(
    async (password: string, label?: string): Promise<string> => {
      try {
        setIsLoading(true);
        const keyRecord = await rpcGenerateKey(password, label);
        await refreshKeys(); // Refresh to get the new key
        return keyRecord.id; // Return just the ID
      } catch (error) {
        console.error("Generate key failed:", error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [refreshKeys]
  );

  const importKey = useCallback(
    async (
      keyInput: string,
      password: string,
      label?: string
    ): Promise<string> => {
      try {
        setIsLoading(true);
        const keyRecord = await rpcImportKey(keyInput, password, label);
        await refreshKeys(); // Refresh to get the new key
        return keyRecord.id; // Return just the ID
      } catch (error) {
        console.error("Import key failed:", error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [refreshKeys]
  );

  const selectKey = useCallback(
    async (keyId: string) => {
      try {
        await rpcSelectKey(keyId);
        setLockState((prev) => ({ ...prev, selectedKeyId: keyId }));
        await refreshKeys(); // Refresh to update isSelected flags
      } catch (error) {
        console.error("Select key failed:", error);
        throw error;
      }
    },
    [refreshKeys]
  );

  // Get selected key info (public data only)
  const selectedKeyInfo = lockState.selectedKeyId
    ? keys.find((key) => key.id === lockState.selectedKeyId)
    : undefined;

  const contextValue: KeyManagerContextType = {
    // State
    isLocked: lockState.isLocked,
    isLoading,
    selectedKeyInfo,
    keys,
    hasKeys: keys.length > 0,

    // Actions
    lock,
    unlock,
    generateKey,
    importKey,
    selectKey,
    refreshKeys,
  };

  return (
    <KeyManagerContext.Provider value={contextValue}>
      {children}
    </KeyManagerContext.Provider>
  );
}

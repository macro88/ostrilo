/**
 * Secure Key Manager Hook - UI Layer Only
 * Simple wrapper around the secure KeyManagerContext
 * Replaces the insecure useKeyManager that handled plaintext private keys
 */

import { useKeyManagerContext } from "@/ui/state/KeyManagerContext";

export function useKeyManager() {
  const context = useKeyManagerContext();
  
  return {
    // State - only public information, no plaintext private keys
    isLocked: context.isLocked,
    isLoading: context.isLoading,
    selectedUnlockedKey: context.selectedKeyInfo, // Renamed but same concept (public info only)
    hasKeys: context.hasKeys,

    // Actions - all via RPC to background service
    lock: context.lock,
    unlock: context.unlock,
    generateKey: context.generateKey,
    importKey: context.importKey,
    selectKey: context.selectKey,
    refreshKeys: context.refreshKeys,
  };
}

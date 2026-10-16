// aislop-ignore-next-line ai-slop/narrative-comment -- records that an earlier useKeyManager handled plaintext private keys, so this wrapper is not redundant indirection to be collapsed back.
// Replaces an insecure predecessor that handled plaintext private keys.
import { useKeyManagerContext } from "@/ui/state/KeyManagerContext";

export function useKeyManager() {
  const context = useKeyManagerContext();

  return {
    // State - only public information, no plaintext private keys
    isLocked: context.isLocked,
    isLoading: context.isLoading,
    lockAt: context.lockAt,
    lockReason: context.lockReason,
    inactivityMinutes: context.inactivityMinutes,
    lockCheckFailed: context.lockCheckFailed,
    selectedUnlockedKey: context.selectedKeyInfo, // Renamed but same concept (public info only)
    keys: context.keys, // All available keys
    hasKeys: context.hasKeys,

    // Actions - all via RPC to background service
    lock: context.lock,
    unlock: context.unlock,
    generateKey: context.generateKey,
    importKey: context.importKey,
    selectKey: context.selectKey,
    refreshKeys: context.refreshKeys,
    retryLockCheck: context.retryLockCheck,
  };
}

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
  useMemo,
  ReactNode,
} from "react";
import {
  unlockVault,
  lockVault,
  generateKey as rpcGenerateKey,
  importKey as rpcImportKey,
  selectKey as rpcSelectKey,
  reportActivity,
  RpcClientError,
} from "@/infrastructure/messaging/client";
import type { LockReason } from "@/domain/types";
import { useLockSync } from "./lock-sync";
import type { UIKeyInfo } from "./key-hydration";
import { useVaultSession } from "./vault-session";

export type { UIKeyInfo } from "./key-hydration";

/**
 * The code returned when an unlock fails for a reason the background did not
 * express as a structured RPC error.
 *
 * `client.ts` throws a plain `Error` for four transport-level conditions -
 * `no_response` (`:69`), `invalid_response_type` (`:73`), the legacy string
 * error path (`:86`) and `transport_error` (`:101`). Their `message` is a
 * machine string, sometimes with a browser-supplied suffix appended, so none of
 * them is fit to show a user. They collapse to this one code, and the UI picks
 * its own words for it.
 */
export const UNLOCK_FAILED = "unlock_failed";

/**
 * The outcome of an unlock attempt.
 *
 * A result object and not a boolean, so that code which reads a reason must
 * first narrow on `ok`. It does not make discarding the outcome a compile
 * error (`await unlock(p); onUnlock?.()` still type-checks), which is how the
 * lock screen once ran its success path after a wrong password.
 */
export type UnlockResult =
  | { ok: true }
  | { ok: false; code: string; detail?: string };

export interface UILockState {
  isLocked: boolean;
  selectedKeyId?: string;
  lastActivity: number;
  /**
   * Absolute epoch-ms instant the vault auto-locks, as the background reports
   * it. Never computed here: a deadline derived in the UI would be a second
   * definition of when the session ends, and the two would disagree across a
   * suspend, a clock change, or a timeout changed in another surface.
   *
   * Absent while locked, and cleared on every transition to locked.
   */
  lockAt?: number;
  /** Why the vault is locked, when the background said. Cleared on every unlock. */
  lockReason?: LockReason;
  /** The timeout that elapsed, with `lockReason: "inactivity"`. */
  inactivityMinutes?: number;
}

interface KeyManagerContextType {
  // State
  isLocked: boolean;
  isLoading: boolean;
  /**
   * True until the first lock-state and key-list read resolves.
   *
   * Distinct from `isLoading`, which is also true during an unlock, a lock, a
   * key import and a refresh. A surface that hides its whole tree on
   * `isLoading` unmounts the lock screen mid-attempt and destroys the error it
   * was about to show - see `OptionsGate`.
   */
  isInitialising: boolean;
  /** The inactivity deadline, for surfaces that display the time remaining. */
  lockAt?: number;
  /** Why the vault is locked, for the lock screen. Absent when unlocked or unknown. */
  lockReason?: LockReason;
  /** The timeout that elapsed, with `lockReason: "inactivity"`. */
  inactivityMinutes?: number;
  /**
   * True while the background is not answering lock-state requests.
   *
   * Not the same as locked. A request that fails says nothing about the vault:
   * the vault is locked only when the background says so. Surfaces show a
   * retry instead of a lock screen, and show no vault content meanwhile.
   * `isLocked` keeps the last answer the background gave.
   */
  lockCheckFailed: boolean;
  selectedKeyInfo?: UIKeyInfo;
  keys: UIKeyInfo[];
  hasKeys: boolean;

  // Actions (all via RPC)
  lock: () => Promise<void>;
  unlock: (password: string) => Promise<UnlockResult>;
  generateKey: (password: string, label?: string) => Promise<string>;
  importKey: (
    keyInput: string,
    password: string,
    label?: string
  ) => Promise<string>;
  selectKey: (keyId: string) => Promise<void>;
  refreshKeys: () => Promise<void>;
  /** Asks the background again after `lockCheckFailed`. */
  retryLockCheck: () => void;
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
  // True from mount: the first read starts with the first effect, so there is
  // no render in which a load has not begun.
  const [isLoading, setIsLoading] = useState(true);
  const { session, api } = useVaultSession();
  const { hydrate, markLocked, select } = api;
  const refreshKeys = hydrate;
  const { lock: lockState, keys, lockCheckFailed, isInitialising } = session;

  // Bumped by a retry, so the load below is an effect of state and not a
  // function the effect has to call.
  const [loadAttempt, setLoadAttempt] = useState(0);

  const retryLockCheck = useCallback(() => {
    setIsLoading(true);
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  // Load initial state, and again on every retry.
  useEffect(() => {
    let cancelled = false;
    void hydrate().then(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrate, loadAttempt]);

  useLockSync(api);

  const lock = useCallback(async () => {
    try {
      setIsLoading(true);
      await lockVault();
      markLocked("manual");
    } catch (error) {
      console.error("Lock failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, [markLocked]);

  const unlock = useCallback(async (password: string): Promise<UnlockResult> => {
    try {
      setIsLoading(true);
      await unlockVault(password);
      reportActivity();
      // The session is replaced by one read of the lock state and the key
      // list, not patched. While locked the list is identifiers only, so
      // the list a surface opened with is useless after an unlock, and the
      // background - not this surface - knows which key is selected. A
      // failed read does not turn a successful unlock into a failed one: it
      // leaves the surface asking the background again, with a retry.
      await hydrate();
      return { ok: true };
    } catch (error) {
      // `RpcClientError.message` is the machine string `rpc:<method>:<code>`
      // built at `client.ts:17`, not prose - rendering it would show the user
      // `rpc:vault.unlock:invalid_password`. The reason lives in the structured
      // payload, and unwrapping it here keeps the client's error shape out of
      // the components.
      if (error instanceof RpcClientError) {
        console.error("Unlock failed:", error.errorCode);
        return {
          ok: false,
          code: error.errorCode,
          detail: error.rpcError.data.details,
        };
      }
      // Anything else is one of the transport paths: machine strings only.
      console.error("Unlock failed:", UNLOCK_FAILED);
      return { ok: false, code: UNLOCK_FAILED };
    } finally {
      setIsLoading(false);
    }
  }, [hydrate]);

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
        reportActivity();
        select(keyId);
        await hydrate(); // Refresh to update isSelected flags
      } catch (error) {
        console.error("Select key failed:", error);
        throw error;
      }
    },
    [hydrate, select]
  );

  // Get selected key info (public data only)
  const selectedKeyInfo = useMemo(
    () =>
      lockState.selectedKeyId && !lockState.isLocked
        ? keys.find((key) => key.id === lockState.selectedKeyId)
        : undefined,
    [keys, lockState.selectedKeyId, lockState.isLocked]
  );

  // Memoized because this provider now re-renders on a timer: the lock poll
  // runs every few seconds, and a fresh object literal here would re-render
  // every consumer on every tick even when nothing changed.
  const contextValue = useMemo<KeyManagerContextType>(
    () => ({
      // State
      isLocked: lockState.isLocked,
      isLoading,
      isInitialising,
      lockAt: lockState.lockAt,
      lockReason: lockState.lockReason,
      inactivityMinutes: lockState.inactivityMinutes,
      lockCheckFailed,
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
      retryLockCheck,
    }),
    [
      lockState.isLocked,
      lockState.lockAt,
      lockState.lockReason,
      lockState.inactivityMinutes,
      lockCheckFailed,
      retryLockCheck,
      isLoading,
      isInitialising,
      selectedKeyInfo,
      keys,
      lock,
      unlock,
      generateKey,
      importKey,
      selectKey,
      refreshKeys,
    ]
  );

  return (
    <KeyManagerContext.Provider value={contextValue}>
      {children}
    </KeyManagerContext.Provider>
  );
}

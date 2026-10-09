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
  listKeys,
  getLockState,
  generateKey as rpcGenerateKey,
  importKey as rpcImportKey,
  selectKey as rpcSelectKey,
  reportActivity,
  RpcClientError,
} from "@/infrastructure/messaging/client";
import type { KeyListEntry } from "@/infrastructure/messaging/handlers/vault-rpc";
import type { LockReason } from "@/domain/types";
import { applyLockState, useLockSync } from "./lock-sync";

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
 * `unlock` used to return `boolean`, and every caller ignored it - which is how
 * the lock screen came to run its success path after a wrong password. A result
 * object does not make discarding the outcome a compile error (`await
 * unlock(p); onUnlock?.()` still type-checks), but it does mean that any code
 * which reads a reason must first narrow on `ok`.
 */
export type UnlockResult =
  | { ok: true }
  | { ok: false; code: string; detail?: string };

// Secure UI-only types - no plaintext private keys
export interface UIKeyInfo {
  id: string;
  label: string;
  publicKeyHex: string;
  publicKeyBech32: string;
  /**
   * The stored record's public key could not be read, so there is no npub to
   * show. Surfaces have to render this as an error: the previous code called
   * a hex decoder that substituted zero bytes for unparseable characters, so
   * a corrupt record displayed a real, well-formed npub for a key nobody
   * holds, and the user had no way to tell it from their own identity.
   */
  isUnreadable: boolean;
  createdAt: number;
  lastUsedAt: number;
  isSelected: boolean;
}

/**
 * Projects one stored record into the view model.
 *
 * The npub arrives already encoded from the background. The UI used to do
 * `publicKeyToBech32(hexToBytes(key.pubkey))` here, which reached
 * `@scure/base` from a React render and would now throw on a malformed
 * record - an exception a context provider has nowhere to put.
 */
function toUIKeyInfo(key: KeyListEntry): UIKeyInfo {
  return {
    id: key.id,
    label: key.label || "Unnamed",
    publicKeyHex: key.pubkey,
    publicKeyBech32: key.npub ?? "",
    isUnreadable: key.npub === undefined,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt || key.createdAt, // Use createdAt as fallback
    isSelected: key.isSelected || false,
  };
}

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
  const [isInitialising, setIsInitialising] = useState(true);
  // Lazy initializer: `Date.now()` is impure, so the eager form re-ran it on
  // every render to produce a value useState discards after mount. Evaluated
  // once, at mount - which is the only point this timestamp is read, since the
  // effect below overwrites `lastActivity` as soon as the load resolves.
  const [lockState, setLockState] = useState<UILockState>(() => ({
    isLocked: true,
    lastActivity: Date.now(),
  }));
  const [keys, setKeys] = useState<UIKeyInfo[]>([]);
  const [lockCheckFailed, setLockCheckFailed] = useState(false);

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

    const loadState = async () => {
      try {
        const [lockStateResult, keysResult] = await Promise.all([
          getLockState(),
          listKeys(),
        ]);
        if (cancelled) return;

        setLockState((prev) => ({
          ...applyLockState(prev, lockStateResult),
          selectedKeyId: lockStateResult.selectedKeyId,
          lastActivity: Date.now(),
        }));
        setLockCheckFailed(false);

        // Convert KeyRecord to UIKeyInfo (remove sensitive fields)
        const uiKeys: UIKeyInfo[] = keysResult.map(toUIKeyInfo);

        setKeys(uiKeys);
      } catch (error) {
        console.error("Failed to load key manager state:", error);
        if (!cancelled) setLockCheckFailed(true);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsInitialising(false);
        }
      }
    };

    loadState();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  useLockSync(setLockState, setLockCheckFailed);

  const refreshKeys = useCallback(async () => {
    try {
      const keysResult = await listKeys();
      const uiKeys: UIKeyInfo[] = keysResult.map(toUIKeyInfo);
      setKeys(uiKeys);
    } catch (error) {
      console.error("Failed to refresh keys:", error);
    }
  }, []);

  const lock = useCallback(async () => {
    try {
      setIsLoading(true);
      await lockVault();
      setLockState((prev) => ({
        ...prev,
        isLocked: true,
        lockAt: undefined,
        lockReason: "manual",
        inactivityMinutes: undefined,
      }));
    } catch (error) {
      console.error("Lock failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const unlock = useCallback(async (password: string): Promise<UnlockResult> => {
    try {
      setIsLoading(true);
      const result = await unlockVault(password);
      reportActivity();
      // One read of the deadline on a deliberate action, so a surface that
      // displays it has it as the vault opens rather than up to a poll
      // interval later. A failure here leaves the deadline absent - the
      // countdown's documented "not available" state, which the poll fills in
      // - because it must not turn a successful unlock into a failed one.
      const deadline = await getLockState().then(
        (state) => state.lockAt,
        () => undefined
      );
      setLockState((prev) => ({
        ...prev,
        isLocked: false,
        selectedKeyId: result.selectedKeyId ?? prev.selectedKeyId,
        lastActivity: Date.now(),
        lockAt: deadline,
        lockReason: undefined,
        inactivityMinutes: undefined,
      }));
      setLockCheckFailed(false);
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
        reportActivity();
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
  const selectedKeyInfo = useMemo(
    () =>
      lockState.selectedKeyId
        ? keys.find((key) => key.id === lockState.selectedKeyId)
        : undefined,
    [keys, lockState.selectedKeyId]
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

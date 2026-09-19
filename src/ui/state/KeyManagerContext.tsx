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
import { BROADCAST_EVENTS } from "@/infrastructure/messaging/events";
import { browser } from "wxt/browser";

/**
 * How often an open surface re-checks the lock state.
 *
 * Short enough that a vault which locks behind a visible page is noticed
 * within a few seconds; long enough that an idle options page is not what
 * keeps the MV3 service worker alive.
 */
const LOCK_POLL_MS = 5_000;

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
          lockAt: lockStateResult.isLocked ? undefined : lockStateResult.lockAt,
        });

        // Convert KeyRecord to UIKeyInfo (remove sensitive fields)
        const uiKeys: UIKeyInfo[] = keysResult.map(toUIKeyInfo);

        setKeys(uiKeys);
      } catch (error) {
        console.error("Failed to load key manager state:", error);
      } finally {
        setIsLoading(false);
        setIsInitialising(false);
      }
    };

    loadInitialState();
  }, []);

  /**
   * Keeps an open surface honest about the lock state.
   *
   * It was read once on mount and never again, so a vault that locked while
   * the options page was open left the page showing key labels, origin
   * policies and the relay list until someone reloaded it. Mutation from
   * that stale page is refused by the background, but the disclosure had
   * already happened.
   *
   * Two signals, because neither is sufficient alone:
   *  - the broadcast, which is immediate but is lost if the worker was
   *    evicted before it could send;
   *  - the poll, which is the backstop, and is also what evaluates the
   *    auto-lock deadline, since that is checked lazily on access.
   */
  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      try {
        const state = await getLockState();
        if (cancelled) return;
        // `lockAt` is compared as well as `isLocked`, and both are usually
        // unchanged: the deadline only moves when activity is recorded or the
        // timeout changes. Returning `prev` on a match keeps the poll from
        // re-rendering every consumer every five seconds.
        const lockAt = state.isLocked ? undefined : state.lockAt;
        setLockState((prev) =>
          prev.isLocked === state.isLocked && prev.lockAt === lockAt
            ? prev
            : { ...prev, isLocked: state.isLocked, lockAt }
        );
      } catch {
        // Unreachable background: assume locked. Failing closed here costs
        // the user a password; failing open costs them their key material.
        if (!cancelled) {
          setLockState((prev) =>
            prev.isLocked && prev.lockAt === undefined
              ? prev
              : { ...prev, isLocked: true, lockAt: undefined }
          );
        }
      }
    };

    const onMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "__event" in message &&
        (message as { __event?: unknown }).__event ===
          BROADCAST_EVENTS.VAULT_LOCKED
      ) {
        setLockState((prev) => ({ ...prev, isLocked: true, lockAt: undefined }));
      }
    };

    browser.runtime.onMessage.addListener(onMessage);
    const interval = setInterval(sync, LOCK_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

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
      setLockState((prev) => ({ ...prev, isLocked: true, lockAt: undefined }));
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
      }));
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
    }),
    [
      lockState.isLocked,
      lockState.lockAt,
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

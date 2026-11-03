import { useCallback, useMemo, useRef, useState } from "react";
import type { LockStatePayload } from "@/infrastructure/messaging/rpc";
import type { LockReason } from "@/domain/types";
import { applyLockState } from "./lock-sync";
import { readVaultSnapshot, redactKeys, type UIKeyInfo } from "./key-hydration";
import type { UILockState } from "./KeyManagerContext";

/**
 * Everything a surface knows about the vault, in one value.
 *
 * The lock state and the key list are one fact: while locked the list is
 * redacted identifiers, while unlocked it carries names and public keys.
 * Held apart they drifted - a surface that opened locked kept its redacted
 * list after the unlock and showed an unnamed key with an unreadable public
 * key.
 */
export interface VaultSession {
  lock: UILockState;
  keys: UIKeyInfo[];
  lockCheckFailed: boolean;
  /** True until the first read of the lock state and the key list lands. */
  isInitialising: boolean;
}

/** Taken before a request, and compared when its answer arrives. */
export interface ReadStamp {
  hydration: number;
  lockEpoch: number;
}

/** Re-reads allowed when a lock falls between the request and its answer. */
const MAX_HYDRATE_ATTEMPTS = 3;

function initialSession(): VaultSession {
  return {
    lock: { isLocked: true, lastActivity: Date.now() },
    keys: [],
    lockCheckFailed: false,
    isInitialising: true,
  };
}

/**
 * The session, held in a ref as well as in state.
 *
 * The ref is what the decisions below read; the state only drives rendering. A
 * functional state update could not decide whether to start a read, and
 * reading state from a closure would see a stale session.
 */
function useSessionStore() {
  const [session, setSession] = useState<VaultSession>(initialSession);
  const latest = useRef(session);

  const update = useCallback((next: (prev: VaultSession) => VaultSession) => {
    const prev = latest.current;
    const value = next(prev);
    // Compared by part, because every caller spreads: a poll that learned
    // nothing would otherwise hand every consumer a new object every tick.
    if (
      value.lock === prev.lock &&
      value.keys === prev.keys &&
      value.lockCheckFailed === prev.lockCheckFailed &&
      value.isInitialising === prev.isInitialising
    ) {
      return;
    }
    latest.current = value;
    setSession(value);
  }, []);

  return { session, latest, update };
}

type SessionUpdate = ReturnType<typeof useSessionStore>["update"];

/**
 * Two counters decide whether an answer may be applied:
 *  - `hydration` counts full reads. An answer from an older one is dropped,
 *    because a newer one is on its way and was asked after whatever the older
 *    answer predates: an unlock, or a change of selection.
 *  - `lockEpoch` counts transitions to locked. An answer requested before a
 *    lock describes a vault that no longer exists, so it is never applied: a
 *    late unlocked read cannot repopulate a locked view. Where a full read
 *    straddled the lock, it is read again instead of dropped, so the surface
 *    still ends up with the locked state and its list.
 * A locked answer cannot overwrite newer unlocked data for the same reason: an
 * unlock starts a full read, which takes a newer ticket than the answer.
 *
 * A class held for the life of the provider, not two refs handed between
 * hooks: the counters are mutated from event handlers and promise callbacks,
 * never during render.
 */
class ReadStamps {
  private hydration = 0;
  private lockEpoch = 0;

  begin(): ReadStamp {
    return { hydration: this.hydration, lockEpoch: this.lockEpoch };
  }

  isCurrent(stamp: ReadStamp): boolean {
    return stamp.hydration === this.hydration && stamp.lockEpoch === this.lockEpoch;
  }

  /** A full read starts. Returns its ticket. */
  startHydration(): number {
    this.hydration += 1;
    return this.hydration;
  }

  isLatestHydration(ticket: number): boolean {
    return ticket === this.hydration;
  }

  /** The vault is now locked: every answer asked for before this is stale. */
  lock(): void {
    this.lockEpoch += 1;
  }

  /** The epoch a read is asked in, to be compared when its answer lands. */
  epoch(): number {
    return this.lockEpoch;
  }
}

/** Builds the full read: lock state and key list together, replacing the session. */
function useHydrate(update: SessionUpdate, stamps: ReadStamps) {
  return useCallback(async (): Promise<void> => {
    const ticket = stamps.startHydration();
    const fail = () => {
      if (stamps.isLatestHydration(ticket)) {
        update((prev) => ({ ...prev, lockCheckFailed: true, isInitialising: false }));
      }
    };

    const attempt = async (remaining: number): Promise<void> => {
      if (remaining === 0) return fail();
      const epoch = stamps.epoch();
      let snapshot;
      try {
        snapshot = await readVaultSnapshot();
      } catch {
        return fail();
      }
      if (!stamps.isLatestHydration(ticket)) return;
      if (epoch !== stamps.epoch()) return attempt(remaining - 1);
      update((prev) => ({
        lock: {
          ...applyLockState(prev.lock, snapshot.lock),
          selectedKeyId: snapshot.lock.selectedKeyId,
          lastActivity: Date.now(),
        },
        keys: snapshot.keys,
        lockCheckFailed: false,
        isInitialising: false,
      }));
    };

    return attempt(MAX_HYDRATE_ATTEMPTS);
  }, [update, stamps]);
}

/** What a lock-state answer, a broadcast or a failed request does to the session. */
function useLockObservers(
  store: ReturnType<typeof useSessionStore>,
  stamps: ReadStamps,
  hydrate: () => Promise<void>
) {
  const { latest, update } = store;

  /** The vault locked. Drops what a locked vault would not disclose. */
  const markLocked = useCallback(
    (reason?: LockReason) => {
      stamps.lock();
      update((prev) => ({
        ...prev,
        lock: {
          ...prev.lock,
          isLocked: true,
          lockAt: undefined,
          lockReason: reason,
          inactivityMinutes: undefined,
        },
        keys: prev.lock.isLocked ? prev.keys : redactKeys(prev.keys),
      }));
    },
    [update, stamps]
  );

  /**
   * A lock-state answer from a poll or a broadcast.
   *
   * It carries no key list, so an unlock it reports is not applied as one: the
   * surface asks for a full read instead, which is what puts names and public
   * keys back. The same goes for a selection another surface changed.
   */
  const observe = useCallback(
    (state: LockStatePayload, stamp: ReadStamp) => {
      if (!stamps.isCurrent(stamp)) return;
      const prev = latest.current;
      if (state.isLocked) {
        // A surface whose first read failed never loaded its key list. Marking
        // it healthy over that empty list would tell a vault that has keys it
        // has none, so it reads the list instead.
        if (prev.lockCheckFailed && prev.lock.isLocked) {
          void hydrate();
          return;
        }
        if (!prev.lock.isLocked) stamps.lock();
        update((p) => ({
          ...p,
          lock: applyLockState(p.lock, state),
          keys: p.lock.isLocked ? p.keys : redactKeys(p.keys),
          lockCheckFailed: false,
        }));
        return;
      }
      if (prev.lock.isLocked || state.selectedKeyId !== prev.lock.selectedKeyId) {
        void hydrate();
        return;
      }
      update((p) => ({
        ...p,
        lock: applyLockState(p.lock, state),
        lockCheckFailed: false,
      }));
    },
    [hydrate, stamps, update, latest]
  );

  const markUnavailable = useCallback(
    (stamp: ReadStamp) => {
      if (!stamps.isCurrent(stamp)) return;
      update((prev) => (prev.lockCheckFailed ? prev : { ...prev, lockCheckFailed: true }));
    },
    [stamps, update]
  );

  return { markLocked, observe, markUnavailable };
}

/** Owns the session and keeps stale answers out of it. */
export function useVaultSession() {
  const store = useSessionStore();
  const { session, update } = store;
  const [stamps] = useState(() => new ReadStamps());
  const hydrate = useHydrate(update, stamps);
  const { markLocked, observe, markUnavailable } = useLockObservers(
    store,
    stamps,
    hydrate
  );
  const beginRead = useCallback(() => stamps.begin(), [stamps]);

  /**
   * The user chose a key, and the background has it. The full read that
   * follows takes a newer ticket than any read begun before the choice, so one
   * still in flight cannot put the previous selection back.
   */
  const select = useCallback(
    (keyId: string) => {
      update((prev) => ({
        ...prev,
        lock: { ...prev.lock, selectedKeyId: keyId },
        keys: prev.keys.map((key) => ({ ...key, isSelected: key.id === keyId })),
      }));
    },
    [update]
  );

  const api = useMemo(
    () => ({ hydrate, markLocked, observe, markUnavailable, select, beginRead }),
    [hydrate, markLocked, observe, markUnavailable, select, beginRead]
  );

  return { session, api };
}

export type VaultSessionApi = ReturnType<typeof useVaultSession>["api"];

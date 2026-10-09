import { useEffect, type Dispatch, type SetStateAction } from "react";
import { isLockReason } from "@/domain/types";
import { BROADCAST_EVENTS } from "@/infrastructure/messaging/events";
import { getLockState } from "@/infrastructure/messaging/client";
import type { LockStatePayload } from "@/infrastructure/messaging/rpc";
import { browser } from "wxt/browser";
import type { UILockState } from "./KeyManagerContext";

/**
 * How often an open surface re-checks the lock state.
 *
 * Short enough that a vault which locks behind a visible page is noticed
 * within a few seconds; long enough that an idle options page is not what
 * keeps the MV3 service worker alive.
 */
const LOCK_POLL_MS = 5_000;

/**
 * Applies a lock-state answer from the background.
 *
 * The reason and the deadline are the two halves of one fact and never
 * coexist: a deadline means unlocked, a reason means locked. Returns `prev`
 * unchanged on a match so a poll that learns nothing does not re-render every
 * consumer.
 */
export function applyLockState(prev: UILockState, state: LockStatePayload): UILockState {
  const lockAt = state.isLocked ? undefined : state.lockAt;
  const lockReason =
    state.isLocked && isLockReason(state.lockReason) ? state.lockReason : undefined;
  const inactivityMinutes =
    lockReason === "inactivity" ? state.inactivityMinutes : undefined;
  if (
    prev.isLocked === state.isLocked &&
    prev.lockAt === lockAt &&
    prev.lockReason === lockReason &&
    prev.inactivityMinutes === inactivityMinutes
  ) {
    return prev;
  }
  return { ...prev, isLocked: state.isLocked, lockAt, lockReason, inactivityMinutes };
}

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
export function useLockSync(
  setLockState: Dispatch<SetStateAction<UILockState>>,
  setLockCheckFailed: Dispatch<SetStateAction<boolean>>
): void {
  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      try {
        const state = await getLockState();
        if (cancelled) return;
        // `lockAt` is compared as well as `isLocked`, and both are usually
        // unchanged: the deadline only moves when activity is recorded or the
        // timeout changes. `applyLockState` returns `prev` on a match, which
        // keeps the poll from re-rendering every consumer every five seconds.
        setLockCheckFailed(false);
        setLockState((prev) => applyLockState(prev, state));
      } catch {
        // An unreachable background is not a locked vault. Nothing is
        // disclosed by saying so: surfaces hide vault content while this is
        // set and offer a retry, rather than telling the user to unlock
        // something that may not be locked.
        if (!cancelled) setLockCheckFailed(true);
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
        // The broadcast says that it locked, not why; the background knows.
        void sync();
      }
    };

    browser.runtime.onMessage.addListener(onMessage);
    const interval = setInterval(sync, LOCK_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, [setLockState, setLockCheckFailed]);
}

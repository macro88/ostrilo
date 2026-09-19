import { useEffect, useMemo, useState } from "react";

/** One second: the countdown's smallest meaningful unit, and its tick rate. */
const TICK_MS = 1_000;

/** Below this the reading switches to seconds and takes the destructive role. */
export const SUB_MINUTE_MS = 60_000;

/**
 * What the countdown is currently saying.
 *
 * `unavailable` is a distinct state rather than a remaining time of zero: an
 * older background, or a locked vault, reports no deadline at all, and a ring
 * reading "Locked" in that case would be inventing a fact it was not told.
 */
export type CountdownState = "minutes" | "seconds" | "expired" | "unavailable";

export interface CountdownReading {
  /** Milliseconds until the deadline, floored at zero. */
  remainingMs: number;
  state: CountdownState;
  /** Fraction of the window still to run, `1` to `0`, for the arc. */
  fraction: number;
  /** The whole unit to render: minutes above 60s, seconds at or below. */
  value: number;
  /** The full phrase, for the accessible name. */
  label: string;
}

/**
 * The reading for a deadline at a given instant. Pure, so the display rules
 * are testable without a clock, a DOM or a rendered component.
 *
 * `windowMs` is the full inactivity window, used only to scale the arc. It is
 * not authoritative for anything: the remaining time comes from the deadline.
 */
export function readCountdown(
  lockAt: number | undefined,
  now: number,
  windowMs?: number
): CountdownReading {
  if (typeof lockAt !== "number" || !Number.isFinite(lockAt)) {
    return {
      remainingMs: 0,
      state: "unavailable",
      fraction: 0,
      value: 0,
      label: "",
    };
  }

  const remainingMs = Math.max(0, lockAt - now);

  if (remainingMs === 0) {
    return {
      remainingMs: 0,
      state: "expired",
      fraction: 0,
      value: 0,
      label: "Vault locked",
    };
  }

  const span = windowMs && windowMs > 0 ? windowMs : remainingMs;
  const fraction = Math.min(1, Math.max(0, remainingMs / span));

  if (remainingMs <= SUB_MINUTE_MS) {
    // Rounded up for the same reason minutes are: a reading of "0 seconds"
    // while a second is still left is wrong in the direction that surprises.
    const seconds = Math.ceil(remainingMs / 1_000);
    return {
      remainingMs,
      state: "seconds",
      fraction,
      value: seconds,
      label: `Vault locks in ${seconds} second${seconds === 1 ? "" : "s"}`,
    };
  }

  // Rounded UP: a ring that reads "0 min" for the last 59 seconds is lying in
  // the direction that costs the user work. The label reaches its final value
  // only when that value is true.
  const minutes = Math.ceil(remainingMs / 60_000);
  return {
    remainingMs,
    state: "minutes",
    fraction,
    value: minutes,
    label: `Vault locks in ${minutes} minute${minutes === 1 ? "" : "s"}`,
  };
}

/**
 * Ticks a reading of the inactivity deadline once a second, while visible.
 *
 * Interpolates locally against an absolute deadline rather than asking the
 * background for a remaining duration: a duration decays from the moment it is
 * serialized and is wrong by however long the surface was hidden, suspended or
 * timer-throttled. A timestamp is self-correcting, so a surface that wakes
 * after minutes in the background is right on its first frame.
 *
 * The interval is cleared while the document is hidden. A backgrounded surface
 * then costs nothing, and - the point of the whole design - nothing here
 * issues an RPC, so displaying the countdown can never be what keeps the MV3
 * worker that enforces the lock alive.
 */
export function useAutoLockCountdown(
  lockAt: number | undefined,
  windowMs?: number
): CountdownReading {
  const [now, setNow] = useState(() => Date.now());
  const [visible, setVisible] = useState(() => !document.hidden);

  useEffect(() => {
    const onVisibilityChange = () => {
      const nowVisible = !document.hidden;
      setVisible(nowVisible);
      // Resync from the event itself rather than from the tick effect. Coming
      // back from hidden, the held value is stale by the whole time away, and
      // waiting a second to correct it shows a number that is visibly wrong.
      if (nowVisible) setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    // No deadline, or nobody looking: nothing to tick, and no timer created.
    if (lockAt === undefined || !visible) return;

    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
  }, [lockAt, visible]);

  return useMemo(
    () => readCountdown(lockAt, now, windowMs),
    [lockAt, now, windowMs]
  );
}

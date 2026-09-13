import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How long a copied nsec is allowed to sit on the system clipboard.
 *
 * Every application on the machine can read the clipboard, and Universal
 * Clipboard and Windows cloud clipboard sync it to the user's other devices.
 * `handleCopyKey` used to call `navigator.clipboard.writeText(nsec)` and stop
 * there, so the key stayed readable until something else happened to overwrite
 * it - which, on a machine nobody is actively copying on, can be days.
 *
 * 45 seconds sits inside the 30-60 second window: long enough to paste into a
 * password manager, short enough that an intervening copy is unlikely.
 */
export const CLIPBOARD_CLEAR_MS = 45_000;

export type ClipboardStatus =
  | "idle"
  | "copied"
  | "cleared"
  | "copy-failed"
  | "clear-failed";

export interface ExpiringClipboard {
  status: ClipboardStatus;
  /** Whole seconds left before the automatic clear, 0 when nothing is pending. */
  secondsRemaining: number;
  /** `true` when the write succeeded and the timed clear is armed. */
  copy: (text: string) => Promise<boolean>;
  clearNow: () => Promise<void>;
  reset: () => void;
}

/**
 * Overwrites the clipboard without reading it first.
 *
 * Reading it would need the `clipboardRead` permission, which contradicts the
 * minimal manifest and produces an install-time warning far scarier than the
 * problem it solves. The cost of not reading is that this may replace something
 * the user copied during the interval, which is why the UI says so before the
 * copy rather than after.
 *
 * The second attempt covers engines that reject an empty write; a rejection of
 * both is almost always "the document does not have focus", which the caller
 * surfaces as the manual transcription fallback.
 */
async function overwriteClipboard(): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) return false;
  try {
    await clipboard.writeText("");
    return true;
  } catch {
    try {
      await clipboard.writeText(" ");
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * A clipboard write that expires.
 *
 * The pending clear is cancelled and run immediately on unmount and on
 * `pagehide`, so a timer never outlives the document that armed it - a popup
 * closing must not leave an nsec on the clipboard indefinitely just because the
 * realm that was going to clear it is gone.
 */
export function useExpiringClipboard(
  windowMs: number = CLIPBOARD_CLEAR_MS
): ExpiringClipboard {
  const [status, setStatus] = useState<ClipboardStatus>("idle");
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const deadlineRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Whether a copy we made is still believed to be on the clipboard. Guards
  // against clearing a clipboard we never wrote to.
  const armedRef = useRef(false);

  const stopTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const clearNow = useCallback(async () => {
    stopTimer();
    setSecondsRemaining(0);
    if (!armedRef.current) return;
    armedRef.current = false;
    const cleared = await overwriteClipboard();
    setStatus(cleared ? "cleared" : "clear-failed");
  }, [stopTimer]);

  const copy = useCallback(
    async (text: string) => {
      const clipboard = globalThis.navigator?.clipboard;
      try {
        if (!clipboard) throw new Error("Clipboard API unavailable");
        await clipboard.writeText(text);
      } catch {
        stopTimer();
        setSecondsRemaining(0);
        setStatus("copy-failed");
        return false;
      }

      armedRef.current = true;
      deadlineRef.current = Date.now() + windowMs;
      setStatus("copied");
      setSecondsRemaining(Math.ceil(windowMs / 1000));

      stopTimer();
      intervalRef.current = setInterval(() => {
        const left = Math.max(0, deadlineRef.current - Date.now());
        setSecondsRemaining(Math.ceil(left / 1000));
        if (left <= 0) void clearNow();
      }, 1000);
      return true;
    },
    [clearNow, stopTimer, windowMs]
  );

  const reset = useCallback(() => {
    stopTimer();
    armedRef.current = false;
    deadlineRef.current = 0;
    setSecondsRemaining(0);
    setStatus("idle");
  }, [stopTimer]);

  useEffect(() => {
    // No `setState` in here: it runs while the component is being torn down,
    // and the only thing that still matters at that point is the clipboard.
    const flush = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (!armedRef.current) return;
      armedRef.current = false;
      void overwriteClipboard();
    };

    globalThis.addEventListener?.("pagehide", flush);
    return () => {
      globalThis.removeEventListener?.("pagehide", flush);
      flush();
    };
  }, []);

  return { status, secondsRemaining, copy, clearNow, reset };
}

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  CLIPBOARD_CLEAR_MS,
  useExpiringClipboard,
  type ExpiringClipboard,
} from "@/ui/features/onboarding/backup/useExpiringClipboard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

let writeText: ReturnType<typeof vi.fn>;
let mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

/** Mounts the hook and hands back a live handle to its return value. */
function mountHook(): { current: ExpiringClipboard } {
  const handle = { current: null as unknown as ExpiringClipboard };

  function Probe() {
    handle.current = useExpiringClipboard();
    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
  mounted.push({ root, container });
  return handle;
}

function unmountAll() {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  unmountAll();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("clipboard copies of a private key expire", () => {
  it("clears the clipboard after the announced interval", async () => {
    const hook = mountHook();

    await act(async () => {
      await hook.current.copy(NSEC);
    });

    expect(writeText).toHaveBeenCalledWith(NSEC);
    expect(hook.current.status).toBe("copied");
    expect(hook.current.secondsRemaining).toBe(CLIPBOARD_CLEAR_MS / 1000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);
    });

    expect(writeText).toHaveBeenLastCalledWith("");
    expect(hook.current.status).toBe("cleared");
    expect(hook.current.secondsRemaining).toBe(0);
  });

  it("counts down in whole seconds while the window is open", async () => {
    const hook = mountHook();
    await act(async () => {
      await hook.current.copy(NSEC);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(hook.current.secondsRemaining).toBe(40);
    expect(hook.current.status).toBe("copied");
  });

  it("clears at once when the user asks, and cancels the pending timer", async () => {
    const hook = mountHook();
    await act(async () => {
      await hook.current.copy(NSEC);
    });

    await act(async () => {
      await hook.current.clearNow();
    });

    expect(writeText).toHaveBeenLastCalledWith("");
    expect(hook.current.status).toBe("cleared");

    const callsAfterClear = writeText.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS * 2);
    });
    // The armed timer must be gone: no second clear, ever.
    expect(writeText.mock.calls.length).toBe(callsAfterClear);
  });

  it("clears immediately on unmount rather than leaving a pending timer", async () => {
    const hook = mountHook();
    await act(async () => {
      await hook.current.copy(NSEC);
    });
    writeText.mockClear();

    unmountAll();

    expect(writeText).toHaveBeenCalledWith("");
  });

  it("clears on pagehide, so a closing popup does not strand the key", async () => {
    const hook = mountHook();
    await act(async () => {
      await hook.current.copy(NSEC);
    });
    writeText.mockClear();

    act(() => {
      globalThis.dispatchEvent(new Event("pagehide"));
    });

    expect(writeText).toHaveBeenCalledWith("");
  });

  it("does not touch the clipboard when nothing was copied", async () => {
    const hook = mountHook();

    await act(async () => {
      await hook.current.clearNow();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(hook.current.status).toBe("idle");
  });

  it("reports a rejected write instead of swallowing it", async () => {
    writeText.mockRejectedValue(new Error("Document is not focused"));
    const hook = mountHook();

    let result: boolean | undefined;
    await act(async () => {
      result = await hook.current.copy(NSEC);
    });

    expect(result).toBe(false);
    expect(hook.current.status).toBe("copy-failed");
    expect(hook.current.secondsRemaining).toBe(0);

    // And nothing is armed, so no phantom clear fires later.
    writeText.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS * 2);
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("reports a rejected clear rather than claiming the clipboard is empty", async () => {
    const hook = mountHook();
    await act(async () => {
      await hook.current.copy(NSEC);
    });

    writeText.mockRejectedValue(new Error("Document is not focused"));
    await act(async () => {
      await hook.current.clearNow();
    });

    expect(hook.current.status).toBe("clear-failed");
  });

  it("never requires reading the clipboard", async () => {
    const hook = mountHook();
    await act(async () => {
      await hook.current.copy(NSEC);
    });
    await act(async () => {
      await hook.current.clearNow();
    });

    // `readText` is not merely unused - it does not exist on the mock, so any
    // call would throw. The manifest asks for no `clipboardRead` permission.
    expect(
      (globalThis.navigator.clipboard as unknown as Record<string, unknown>)
        .readText
    ).toBeUndefined();
  });

  it("reports a failed copy when the Clipboard API is missing", async () => {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const hook = mountHook();

    let result: boolean | undefined;
    await act(async () => {
      result = await hook.current.copy(NSEC);
    });

    expect(result).toBe(false);
    expect(hook.current.status).toBe("copy-failed");
  });

  it("reports a failed clear when the Clipboard API has gone away", async () => {
    const hook = mountHook();
    await act(async () => {
      await hook.current.copy(NSEC);
    });
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    await act(async () => {
      await hook.current.clearNow();
    });

    expect(hook.current.status).toBe("clear-failed");
  });

  it("falls back to a single space when an empty write is rejected", async () => {
    const hook = mountHook();
    await act(async () => {
      await hook.current.copy(NSEC);
    });
    writeText.mockImplementation(async (text: string) => {
      if (text === "") throw new Error("empty writes unsupported");
    });

    await act(async () => {
      await hook.current.clearNow();
    });

    expect(writeText).toHaveBeenLastCalledWith(" ");
    expect(hook.current.status).toBe("cleared");
  });

  it("disarms on reset, so neither the timer nor unmount clears later", async () => {
    const hook = mountHook();
    await act(async () => {
      await hook.current.copy(NSEC);
    });

    act(() => {
      hook.current.reset();
    });
    expect(hook.current.status).toBe("idle");
    expect(hook.current.secondsRemaining).toBe(0);

    writeText.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS * 2);
    });
    unmountAll();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("bounds the window at no more than 60 seconds", () => {
    expect(CLIPBOARD_CLEAR_MS).toBeLessThanOrEqual(60_000);
    expect(CLIPBOARD_CLEAR_MS).toBeGreaterThanOrEqual(30_000);
  });
});

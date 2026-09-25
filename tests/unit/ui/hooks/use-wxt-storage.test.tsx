// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ChangeListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  areaName: string
) => void;

const storage = vi.hoisted(() => {
  const area = new Map<string, unknown>();
  const changeListeners = new Set<ChangeListener>();
  return {
    area,
    changeListeners,
    get: vi.fn(async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (area.has(k)) out[k] = area.get(k);
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) area.set(k, v);
    }),
  };
});

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      sync: { get: storage.get, set: storage.set },
      onChanged: {
        addListener: (listener: ChangeListener) => {
          storage.changeListeners.add(listener);
        },
      },
    },
  },
}));

const { useWxtStorage } = await import("@/ui/hooks/useWxtStorage");

type HookResult<T> = ReturnType<typeof useWxtStorage<T>>;

function mountAlone<T>(key: string, defaultValue: T) {
  const latest: { current: HookResult<T> | null } = { current: null };
  function Harness() {
    latest.current = useWxtStorage<T>(key, defaultValue);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
  mounted.push({ root, container });
  return {
    get value() {
      return latest.current![0];
    },
    get set() {
      return latest.current![1];
    },
    get isReady() {
      return latest.current![2];
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
      mounted.splice(
        mounted.findIndex((m) => m.root === root),
        1
      );
    },
  };
}

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function mountPair<T>(key: string, defaultValue: T) {
  const hook = mountAlone(key, defaultValue);
  const sibling = mountAlone(key, defaultValue);
  return {
    get value() {
      return hook.value;
    },
    get set() {
      return hook.set;
    },
    get isReady() {
      return hook.isReady;
    },
    get siblingValue() {
      return sibling.value;
    },
    unmount() {
      hook.unmount();
      sibling.unmount();
    },
  };
}

async function flushMicrotasks() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

function emitChange(
  changes: Record<string, { newValue?: unknown }>,
  areaName: string
) {
  act(() => {
    for (const listener of storage.changeListeners) listener(changes, areaName);
  });
}

let keyCounter = 0;
function freshKey() {
  keyCounter += 1;
  return `test-key-${keyCounter}`;
}

const mount = mountAlone;

describe("useWxtStorage", () => {
  beforeEach(() => {
    storage.area.clear();
    storage.get.mockClear();
    storage.set.mockClear();
  });

  afterEach(() => {
    for (const { root, container } of mounted.splice(0)) {
      act(() => root.unmount());
      container.remove();
    }
    vi.useRealTimers();
  });

  it("reports the default and not-ready before the stored value loads, then the stored value", async () => {
    const key = freshKey();
    storage.area.set(key, "stored");

    const hook = mount(key, "fallback");
    expect(hook.value).toBe("fallback");
    expect(hook.isReady).toBe(false);

    await flushMicrotasks();

    expect(hook.value).toBe("stored");
    expect(hook.isReady).toBe(true);
  });

  it("falls back to the default once storage reports the key absent", async () => {
    const key = freshKey();
    const hook = mount(key, 42);

    await flushMicrotasks();

    expect(hook.value).toBe(42);
    expect(hook.isReady).toBe(true);
  });

  it("becomes ready on the default when the initial read fails", async () => {
    const key = freshKey();
    storage.get.mockRejectedValueOnce(new Error("quota"));

    const hook = mount(key, "fallback");
    await flushMicrotasks();

    expect(hook.value).toBe("fallback");
    expect(hook.isReady).toBe(true);
  });

  it("returns the same default reference across renders so consumers do not loop", async () => {
    const key = freshKey();
    const defaults = { enabled: false };
    const hook = mount(key, defaults);
    const first = hook.value;

    await flushMicrotasks();

    expect(hook.value).toBe(first);
  });

  it("applies a write locally at once and persists it after the debounce window", async () => {
    vi.useFakeTimers();
    const key = freshKey();
    const hook = mount(key, "a");
    await flushMicrotasks();

    let settled = false;
    await act(async () => {
      void hook.set("b").then(() => {
        settled = true;
      });
    });

    expect(hook.value).toBe("b");
    expect(storage.area.has(key)).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(storage.area.get(key)).toBe("b");
    expect(settled).toBe(true);
  });

  it("coalesces rapid writes into one storage write carrying the last value", async () => {
    vi.useFakeTimers();
    const key = freshKey();
    const hook = mount(key, 0);
    await flushMicrotasks();

    const outcomes: string[] = [];
    await act(async () => {
      void hook.set(1).then(() => outcomes.push("first"));
      await vi.advanceTimersByTimeAsync(60);
      void hook.set((prev) => prev + 10).then(() => outcomes.push("second"));
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(hook.value).toBe(11);
    expect(storage.set).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.area.get(key)).toBe(11);
    expect(outcomes).toEqual(["first", "second"]);
  });

  it("derives a functional update from the default when nothing is stored", async () => {
    vi.useFakeTimers();
    const key = freshKey();
    const hook = mount<string[]>(key, ["x"]);
    await flushMicrotasks();

    await act(async () => {
      const pending = hook.set((prev) => [...prev, "y"]);
      await vi.advanceTimersByTimeAsync(100);
      await pending;
    });

    expect(hook.value).toEqual(["x", "y"]);
    expect(storage.area.get(key)).toEqual(["x", "y"]);
  });

  it("rolls back to the stored value and rejects when the write fails", async () => {
    vi.useFakeTimers();
    const key = freshKey();
    storage.area.set(key, "persisted");
    const hook = mount(key, "fallback");
    await flushMicrotasks();

    storage.set.mockRejectedValueOnce(new Error("QUOTA_BYTES_PER_ITEM"));
    let failure: unknown;
    await act(async () => {
      void hook.set("rejected").catch((e: unknown) => {
        failure = e;
      });
    });
    expect(hook.value).toBe("rejected");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(hook.value).toBe("persisted");
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("QUOTA_BYTES_PER_ITEM");
  });

  it("rolls back to the default when the write fails and nothing was ever stored", async () => {
    vi.useFakeTimers();
    const key = freshKey();
    const hook = mount(key, "fallback");
    await flushMicrotasks();

    storage.set.mockRejectedValueOnce(new Error("offline"));
    let rejected = false;
    await act(async () => {
      void hook.set("optimistic").catch(() => {
        rejected = true;
      });
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(hook.value).toBe("fallback");
    expect(rejected).toBe(true);
  });

  it("follows a change written to sync storage by another context", async () => {
    const key = freshKey();
    const hook = mount(key, "fallback");
    await flushMicrotasks();

    emitChange({ [key]: { newValue: "from-options-page" } }, "sync");
    expect(hook.value).toBe("from-options-page");

    emitChange({ [key]: {} }, "sync");
    expect(hook.value).toBe("fallback");
  });

  it("ignores changes to other storage areas and to keys nobody is watching", async () => {
    const key = freshKey();
    const other = freshKey();
    const hook = mount(key, "fallback");
    await flushMicrotasks();

    emitChange({ [key]: { newValue: "local-area" } }, "local");
    emitChange({ [other]: { newValue: "unwatched" } }, "sync");

    expect(hook.value).toBe("fallback");

    const late = mount(other, "late-default");
    await flushMicrotasks();
    expect(late.value).toBe("late-default");
  });

  it("shares one value between two consumers of the same key", async () => {
    vi.useFakeTimers();
    const key = freshKey();
    const hook = mountPair(key, "start");
    await flushMicrotasks();

    await act(async () => {
      void hook.set("shared");
    });

    expect(hook.siblingValue).toBe("shared");
  });

  it("still persists and settles a queued write after the last consumer unmounts", async () => {
    vi.useFakeTimers();
    const key = freshKey();
    const hook = mount(key, "start");
    await flushMicrotasks();

    let settled = false;
    await act(async () => {
      void hook.set("written-after-unmount").then(() => {
        settled = true;
      });
    });
    hook.unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(storage.area.get(key)).toBe("written-after-unmount");
    expect(settled).toBe(true);
  });

  it("keeps a lone consumer's stored value across re-renders instead of rereading storage", async () => {
    const key = freshKey();
    storage.area.set(key, "stored");
    const hook = mount(key, "fallback");
    await flushMicrotasks();

    expect(hook.value).toBe("stored");
    expect(hook.isReady).toBe(true);
    expect(storage.get).toHaveBeenCalledTimes(1);
  });

  it("forgets its cache after the last consumer unmounts and rereads storage on remount", async () => {
    const key = freshKey();
    storage.area.set(key, "v1");
    const first = mount(key, "fallback");
    await flushMicrotasks();
    expect(first.value).toBe("v1");
    first.unmount();

    storage.area.set(key, "v2");
    const second = mount(key, "fallback");
    expect(second.isReady).toBe(false);
    await flushMicrotasks();

    expect(second.value).toBe("v2");
  });
});

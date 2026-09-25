// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROADCAST_EVENTS } from "@/infrastructure/messaging/events";
import { createRpcError } from "@/infrastructure/messaging/error-codes";
import type { KeyListEntry } from "@/infrastructure/messaging/handlers/vault-rpc";
import type { LockStatePayload } from "@/infrastructure/messaging/rpc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => ({
  listeners: new Set<(message: unknown) => void>(),
}));

const rpc = vi.hoisted(() => ({
  unlockVault: vi.fn(),
  lockVault: vi.fn(),
  listKeys: vi.fn(),
  getLockState: vi.fn(),
  generateKey: vi.fn(),
  importKey: vi.fn(),
  selectKey: vi.fn(),
  reportActivity: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      onMessage: {
        addListener: (listener: (message: unknown) => void) => {
          runtime.listeners.add(listener);
        },
        removeListener: (listener: (message: unknown) => void) => {
          runtime.listeners.delete(listener);
        },
      },
    },
  },
}));

vi.mock("@/infrastructure/messaging/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/infrastructure/messaging/client")>();
  return { RpcClientError: actual.RpcClientError, ...rpc };
});

const { RpcClientError } = await import("@/infrastructure/messaging/client");
const { KeyManagerProvider, useKeyManagerContext, UNLOCK_FAILED } =
  await import("@/ui/state/KeyManagerContext");

type Context = ReturnType<typeof useKeyManagerContext>;

function entry(overrides: Partial<KeyListEntry> & { id: string }): KeyListEntry {
  return {
    label: `Key ${overrides.id}`,
    pubkey: `${overrides.id}-hex`,
    npub: `npub1${overrides.id}`,
    ct: [],
    iv: [],
    createdAt: 1_000,
    lastUsedAt: 2_000,
    isSelected: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;
const renders: Context[] = [];

function Consumer() {
  renders.push(useKeyManagerContext());
  return null;
}

function latest(): Context {
  return renders[renders.length - 1];
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function mountProvider() {
  act(() => {
    root.render(
      <KeyManagerProvider>
        <Consumer />
      </KeyManagerProvider>
    );
  });
  await settle();
}

function broadcast(message: unknown) {
  act(() => {
    for (const listener of runtime.listeners) listener(message);
  });
}

async function advancePoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
}

function unlockedState(overrides: Partial<LockStatePayload> = {}): LockStatePayload {
  return { isLocked: false, selectedKeyId: "a", lockAt: 90_000, ...overrides };
}

describe("KeyManagerProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const fn of Object.values(rpc)) fn.mockReset();
    rpc.getLockState.mockResolvedValue({ isLocked: true });
    rpc.listKeys.mockResolvedValue([]);
    runtime.listeners.clear();
    renders.length = 0;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refuses to be read outside a provider", () => {
    const isolated = createRoot(document.createElement("div"));

    expect(() => act(() => isolated.render(<Consumer />))).toThrow(
      "useKeyManagerContext must be used within KeyManagerProvider"
    );
    act(() => isolated.unmount());
  });

  it("starts locked and initialising, then projects the background's keys and lock state", async () => {
    const pending = deferred<LockStatePayload>();
    rpc.getLockState.mockReturnValueOnce(pending.promise);
    rpc.listKeys.mockResolvedValue([
      entry({ id: "a", isSelected: true }),
      entry({ id: "b", label: "", lastUsedAt: undefined, isSelected: undefined, npub: undefined }),
    ]);

    act(() => {
      root.render(
        <KeyManagerProvider>
          <Consumer />
        </KeyManagerProvider>
      );
    });

    expect(latest().isLocked).toBe(true);
    expect(latest().isInitialising).toBe(true);
    expect(latest().hasKeys).toBe(false);

    pending.resolve(unlockedState());
    await settle();

    const ctx = latest();
    expect(ctx.isInitialising).toBe(false);
    expect(ctx.isLoading).toBe(false);
    expect(ctx.isLocked).toBe(false);
    expect(ctx.lockAt).toBe(90_000);
    expect(ctx.hasKeys).toBe(true);
    expect(ctx.selectedKeyInfo?.id).toBe("a");
    expect(ctx.keys).toEqual([
      {
        id: "a",
        label: "Key a",
        publicKeyHex: "a-hex",
        publicKeyBech32: "npub1a",
        isUnreadable: false,
        createdAt: 1_000,
        lastUsedAt: 2_000,
        isSelected: true,
      },
      {
        id: "b",
        label: "Unnamed",
        publicKeyHex: "b-hex",
        publicKeyBech32: "",
        isUnreadable: true,
        createdAt: 1_000,
        lastUsedAt: 1_000,
        isSelected: false,
      },
    ]);
  });

  it("drops a deadline reported alongside a locked vault", async () => {
    rpc.getLockState.mockResolvedValue({ isLocked: true, lockAt: 90_000 });

    await mountProvider();

    expect(latest().isLocked).toBe(true);
    expect(latest().lockAt).toBeUndefined();
  });

  it("finishes initialising locked and empty when the first read fails", async () => {
    rpc.getLockState.mockRejectedValue(new Error("no_response"));

    await mountProvider();

    expect(latest().isInitialising).toBe(false);
    expect(latest().isLoading).toBe(false);
    expect(latest().isLocked).toBe(true);
    expect(latest().keys).toEqual([]);
  });

  it("notices on the next poll that the vault locked behind the page", async () => {
    rpc.getLockState.mockResolvedValue(unlockedState());
    await mountProvider();
    expect(latest().isLocked).toBe(false);

    rpc.getLockState.mockResolvedValue({ isLocked: true, lockAt: 90_000 });
    await advancePoll();

    expect(latest().isLocked).toBe(true);
    expect(latest().lockAt).toBeUndefined();
  });

  it("picks up a moved deadline from the poll", async () => {
    rpc.getLockState.mockResolvedValue(unlockedState());
    await mountProvider();

    rpc.getLockState.mockResolvedValue(unlockedState({ lockAt: 120_000 }));
    await advancePoll();

    expect(latest().isLocked).toBe(false);
    expect(latest().lockAt).toBe(120_000);
  });

  it("does not re-render consumers when a poll finds nothing changed", async () => {
    rpc.getLockState.mockResolvedValue(unlockedState());
    await mountProvider();
    const before = renders.length;

    await advancePoll();
    await advancePoll();

    expect(renders.length).toBe(before);
  });

  it("fails closed when the background stops answering the poll", async () => {
    rpc.getLockState.mockResolvedValue(unlockedState());
    await mountProvider();

    rpc.getLockState.mockRejectedValue(new Error("transport_error"));
    await advancePoll();

    expect(latest().isLocked).toBe(true);
    expect(latest().lockAt).toBeUndefined();

    const before = renders.length;
    await advancePoll();
    expect(renders.length).toBe(before);
  });

  it("locks at once on the vault-locked broadcast and ignores other events", async () => {
    rpc.getLockState.mockResolvedValue(unlockedState());
    await mountProvider();

    broadcast({ __event: BROADCAST_EVENTS.SETTINGS_CHANGED });
    broadcast("not-an-event");
    broadcast(null);
    expect(latest().isLocked).toBe(false);

    broadcast({ __event: BROADCAST_EVENTS.VAULT_LOCKED });
    expect(latest().isLocked).toBe(true);
    expect(latest().lockAt).toBeUndefined();
  });

  it("stops listening and polling once unmounted, and ignores a poll that lands after", async () => {
    rpc.getLockState.mockResolvedValue(unlockedState());
    await mountProvider();
    expect(runtime.listeners.size).toBe(1);

    const inFlight = deferred<LockStatePayload>();
    rpc.getLockState.mockReturnValueOnce(inFlight.promise);
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    const callsAtUnmount = rpc.getLockState.mock.calls.length;

    act(() => root.unmount());
    inFlight.resolve({ isLocked: true });
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(runtime.listeners.size).toBe(0);
    expect(rpc.getLockState.mock.calls.length).toBe(callsAtUnmount);
    root = createRoot(container);
  });

  it("ignores a failed poll that lands after unmount", async () => {
    rpc.getLockState.mockResolvedValue(unlockedState());
    await mountProvider();
    const rendersBefore = renders.length;

    const inFlight = deferred<LockStatePayload>();
    rpc.getLockState.mockReturnValueOnce(inFlight.promise);
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    act(() => root.unmount());
    inFlight.reject(new Error("gone"));
    await settle();

    expect(renders.length).toBe(rendersBefore);
    root = createRoot(container);
  });

  describe("unlock", () => {
    it("opens the vault, adopts the background's selection and reads the deadline", async () => {
      rpc.listKeys.mockResolvedValue([entry({ id: "a" }), entry({ id: "b" })]);
      await mountProvider();

      const pendingUnlock = deferred<{ selectedKeyId?: string }>();
      rpc.unlockVault.mockReturnValueOnce(pendingUnlock.promise);
      rpc.getLockState.mockResolvedValueOnce(unlockedState({ lockAt: 77_000 }));

      let result: unknown;
      await act(async () => {
        void latest()
          .unlock("hunter2")
          .then((r) => {
            result = r;
          });
      });
      expect(latest().isLoading).toBe(true);
      expect(rpc.unlockVault).toHaveBeenCalledWith("hunter2");

      pendingUnlock.resolve({ selectedKeyId: "b" });
      await settle();

      expect(result).toEqual({ ok: true });
      expect(latest().isLoading).toBe(false);
      expect(latest().isLocked).toBe(false);
      expect(latest().lockAt).toBe(77_000);
      expect(latest().selectedKeyInfo?.id).toBe("b");
      expect(rpc.reportActivity).toHaveBeenCalledTimes(1);
    });

    it("keeps the prior selection and leaves the deadline absent when the follow-up read fails", async () => {
      rpc.getLockState.mockResolvedValueOnce({ isLocked: true, selectedKeyId: "a" });
      rpc.listKeys.mockResolvedValue([entry({ id: "a" })]);
      await mountProvider();

      rpc.unlockVault.mockResolvedValueOnce({});
      rpc.getLockState.mockRejectedValueOnce(new Error("no_response"));

      let result: unknown;
      await act(async () => {
        result = await latest().unlock("pw");
      });

      expect(result).toEqual({ ok: true });
      expect(latest().isLocked).toBe(false);
      expect(latest().lockAt).toBeUndefined();
      expect(latest().selectedKeyInfo?.id).toBe("a");
    });

    it("reports the structured reason for a wrong password and stays locked", async () => {
      await mountProvider();
      rpc.unlockVault.mockRejectedValueOnce(
        new RpcClientError(
          "vault.unlock",
          createRpcError("invalid_password", { details: "2 attempts left" })
        )
      );

      let result: unknown;
      await act(async () => {
        result = await latest().unlock("wrong");
      });

      expect(result).toEqual({
        ok: false,
        code: "invalid_password",
        detail: "2 attempts left",
      });
      expect(latest().isLocked).toBe(true);
      expect(latest().isLoading).toBe(false);
      expect(rpc.reportActivity).not.toHaveBeenCalled();
    });

    it("collapses a transport failure to the generic unlock code without its machine message", async () => {
      await mountProvider();
      rpc.unlockVault.mockRejectedValueOnce(new Error("transport_error: port closed"));

      let result: unknown;
      await act(async () => {
        result = await latest().unlock("pw");
      });

      expect(result).toEqual({ ok: false, code: UNLOCK_FAILED });
      expect(latest().isLocked).toBe(true);
    });
  });

  describe("lock", () => {
    it("locks the vault and clears the deadline", async () => {
      rpc.getLockState.mockResolvedValue(unlockedState());
      await mountProvider();
      rpc.lockVault.mockResolvedValueOnce(null);

      await act(async () => {
        await latest().lock();
      });

      expect(latest().isLocked).toBe(true);
      expect(latest().lockAt).toBeUndefined();
      expect(latest().isLoading).toBe(false);
    });

    it("stays unlocked and stops loading when the lock request fails", async () => {
      rpc.getLockState.mockResolvedValue(unlockedState());
      await mountProvider();
      rpc.lockVault.mockRejectedValueOnce(new Error("no_response"));

      await act(async () => {
        await latest().lock();
      });

      expect(latest().isLocked).toBe(false);
      expect(latest().isLoading).toBe(false);
    });
  });

  describe("key creation", () => {
    it("returns the generated key's id and lists it", async () => {
      await mountProvider();
      rpc.generateKey.mockResolvedValueOnce(entry({ id: "new" }));
      rpc.listKeys.mockResolvedValueOnce([entry({ id: "new" })]);

      let id: string | undefined;
      await act(async () => {
        id = await latest().generateKey("pw", "Fresh");
      });

      expect(rpc.generateKey).toHaveBeenCalledWith("pw", "Fresh");
      expect(id).toBe("new");
      expect(latest().keys.map((k) => k.id)).toEqual(["new"]);
      expect(latest().isLoading).toBe(false);
    });

    it("rethrows a generation failure and stops loading", async () => {
      await mountProvider();
      rpc.generateKey.mockRejectedValueOnce(new Error("weak_password"));

      let failure: unknown;
      await act(async () => {
        failure = await latest()
          .generateKey("pw")
          .catch((e: unknown) => e);
      });

      expect((failure as Error).message).toBe("weak_password");
      expect(latest().isLoading).toBe(false);
      expect(latest().keys).toEqual([]);
    });

    it("returns the imported key's id and lists it", async () => {
      await mountProvider();
      rpc.importKey.mockResolvedValueOnce(entry({ id: "imp" }));
      rpc.listKeys.mockResolvedValueOnce([entry({ id: "imp" })]);

      let id: string | undefined;
      await act(async () => {
        id = await latest().importKey("nsec1abc", "pw", "Imported");
      });

      expect(rpc.importKey).toHaveBeenCalledWith("nsec1abc", "pw", "Imported");
      expect(id).toBe("imp");
      expect(latest().keys.map((k) => k.id)).toEqual(["imp"]);
    });

    it("rethrows an import failure and stops loading", async () => {
      await mountProvider();
      rpc.importKey.mockRejectedValueOnce(new Error("invalid_key"));

      let failure: unknown;
      await act(async () => {
        failure = await latest()
          .importKey("junk", "pw")
          .catch((e: unknown) => e);
      });

      expect((failure as Error).message).toBe("invalid_key");
      expect(latest().isLoading).toBe(false);
    });
  });

  describe("selection and refresh", () => {
    it("switches the selected key and refreshes the list", async () => {
      rpc.getLockState.mockResolvedValue(unlockedState({ selectedKeyId: "a" }));
      rpc.listKeys.mockResolvedValue([
        entry({ id: "a", isSelected: true }),
        entry({ id: "b" }),
      ]);
      await mountProvider();

      rpc.selectKey.mockResolvedValueOnce(null);
      rpc.listKeys.mockResolvedValueOnce([
        entry({ id: "a" }),
        entry({ id: "b", isSelected: true }),
      ]);
      await act(async () => {
        await latest().selectKey("b");
      });

      expect(rpc.selectKey).toHaveBeenCalledWith("b");
      expect(latest().selectedKeyInfo?.id).toBe("b");
      expect(latest().selectedKeyInfo?.isSelected).toBe(true);
      expect(rpc.reportActivity).toHaveBeenCalledTimes(1);
    });

    it("keeps the current selection and rethrows when selecting fails", async () => {
      rpc.getLockState.mockResolvedValue(unlockedState({ selectedKeyId: "a" }));
      rpc.listKeys.mockResolvedValue([entry({ id: "a" }), entry({ id: "b" })]);
      await mountProvider();
      rpc.selectKey.mockRejectedValueOnce(new Error("vault_locked"));

      let failure: unknown;
      await act(async () => {
        failure = await latest()
          .selectKey("b")
          .catch((e: unknown) => e);
      });

      expect((failure as Error).message).toBe("vault_locked");
      expect(latest().selectedKeyInfo?.id).toBe("a");
    });

    it("keeps the last good list when a refresh fails", async () => {
      rpc.listKeys.mockResolvedValue([entry({ id: "a" })]);
      await mountProvider();
      rpc.listKeys.mockRejectedValueOnce(new Error("no_response"));

      await act(async () => {
        await latest().refreshKeys();
      });

      expect(latest().keys.map((k) => k.id)).toEqual(["a"]);
    });
  });
});

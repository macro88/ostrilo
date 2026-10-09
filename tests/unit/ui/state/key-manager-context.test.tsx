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

/**
 * A background that redacts the way the real router does: while locked,
 * `keys.list` returns identifiers only and `state.getLock` carries no
 * deadline. The fixtures elsewhere in this file preload full keys regardless
 * of the lock state, which is exactly what hid the unlock-refresh defect.
 */
function fakeBackend(keys: KeyListEntry[], selectedKeyId: string) {
  const backend = {
    locked: true,
    selectedKeyId,
    keys,
    lockReason: undefined as LockStatePayload["lockReason"],
  };
  rpc.getLockState.mockImplementation(async () =>
    backend.locked
      ? { isLocked: true, selectedKeyId: backend.selectedKeyId, lockReason: backend.lockReason }
      : { isLocked: false, selectedKeyId: backend.selectedKeyId, lockAt: 90_000 }
  );
  rpc.listKeys.mockImplementation(async () =>
    backend.locked
      ? backend.keys.map((k) => ({ id: k.id }))
      : backend.keys.map((k) => ({ ...k, isSelected: k.id === backend.selectedKeyId }))
  );
  rpc.unlockVault.mockImplementation(async () => {
    backend.locked = false;
    return { selectedKeyId: backend.selectedKeyId };
  });
  rpc.lockVault.mockImplementation(async () => {
    backend.locked = true;
    backend.lockReason = "manual";
    return null;
  });
  rpc.selectKey.mockImplementation(async (id: string) => {
    backend.selectedKeyId = id;
    return null;
  });
  return backend;
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

  it("finishes initialising with a failed lock check, not a lock, when the first read fails", async () => {
    rpc.getLockState.mockRejectedValue(new Error("no_response"));

    await mountProvider();

    expect(latest().isInitialising).toBe(false);
    expect(latest().isLoading).toBe(false);
    expect(latest().lockCheckFailed).toBe(true);
    expect(latest().lockReason).toBeUndefined();
    expect(latest().keys).toEqual([]);
  });

  it("clears the failure when a retry gets an answer", async () => {
    rpc.getLockState.mockRejectedValueOnce(new Error("no_response"));
    await mountProvider();
    expect(latest().lockCheckFailed).toBe(true);

    rpc.getLockState.mockResolvedValue(unlockedState());
    rpc.listKeys.mockResolvedValue([entry({ id: "a", isSelected: true })]);
    act(() => latest().retryLockCheck());
    await settle();

    expect(latest().lockCheckFailed).toBe(false);
    expect(latest().isLocked).toBe(false);
    expect(latest().keys).toHaveLength(1);
  });

  it("keeps the failure when the retry fails too", async () => {
    rpc.getLockState.mockRejectedValue(new Error("no_response"));
    await mountProvider();

    act(() => latest().retryLockCheck());
    await settle();

    expect(latest().lockCheckFailed).toBe(true);
    expect(latest().isLoading).toBe(false);
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

  it("reports a failed lock check, not a lock, when the background stops answering the poll", async () => {
    rpc.getLockState.mockResolvedValue(unlockedState());
    await mountProvider();

    rpc.getLockState.mockRejectedValue(new Error("transport_error"));
    await advancePoll();

    expect(latest().lockCheckFailed).toBe(true);
    // The last answer the background gave is kept: a failed request is not a
    // lock, and is not a reason to claim one.
    expect(latest().isLocked).toBe(false);
    expect(latest().lockReason).toBeUndefined();

    const before = renders.length;
    await advancePoll();
    expect(renders.length).toBe(before);
  });

  it("recovers by itself when the background answers a later poll", async () => {
    rpc.getLockState.mockResolvedValue(unlockedState());
    await mountProvider();
    rpc.getLockState.mockRejectedValue(new Error("transport_error"));
    await advancePoll();
    expect(latest().lockCheckFailed).toBe(true);

    rpc.getLockState.mockResolvedValue(unlockedState());
    await advancePoll();

    expect(latest().lockCheckFailed).toBe(false);
    expect(latest().isLocked).toBe(false);
  });

  it("adopts the lock reason the background reports", async () => {
    rpc.getLockState.mockResolvedValue({
      isLocked: true,
      lockReason: "inactivity",
      inactivityMinutes: 35,
    });

    await mountProvider();

    expect(latest().isLocked).toBe(true);
    expect(latest().lockReason).toBe("inactivity");
    expect(latest().inactivityMinutes).toBe(35);
  });

  it("drops an inactivity duration that is not a whole number of permitted minutes", async () => {
    for (const bad of [1.5, Number.POSITIVE_INFINITY, 0, 9_999]) {
      rpc.getLockState.mockResolvedValue({
        isLocked: true,
        lockReason: "inactivity",
        inactivityMinutes: bad,
      });
      renders.length = 0;
      act(() => root.unmount());
      root = createRoot(container);
      await mountProvider();

      expect(latest().lockReason, String(bad)).toBe("inactivity");
      expect(latest().inactivityMinutes, String(bad)).toBeUndefined();
    }
  });

  it("ignores a lock reason it does not recognise", async () => {
    rpc.getLockState.mockResolvedValue({
      isLocked: true,
      lockReason: "<b>bad</b>" as never,
    });

    await mountProvider();

    expect(latest().isLocked).toBe(true);
    expect(latest().lockReason).toBeUndefined();
  });

  it("learns the reason from the poll after a lock it was only told about", async () => {
    rpc.getLockState.mockResolvedValue(unlockedState());
    await mountProvider();

    rpc.getLockState.mockResolvedValue({
      isLocked: true,
      lockReason: "background_restarted",
    });
    broadcast({ __event: BROADCAST_EVENTS.VAULT_LOCKED });
    await settle();

    expect(latest().isLocked).toBe(true);
    expect(latest().lockReason).toBe("background_restarted");
  });

  it("drops the reason once the vault is unlocked again", async () => {
    rpc.getLockState.mockResolvedValue({ isLocked: true, lockReason: "manual" });
    await mountProvider();
    expect(latest().lockReason).toBe("manual");

    rpc.getLockState.mockResolvedValue(unlockedState());
    await advancePoll();

    expect(latest().isLocked).toBe(false);
    expect(latest().lockReason).toBeUndefined();
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
      const backend = fakeBackend([entry({ id: "a" }), entry({ id: "b" })], "b");
      await mountProvider();

      const pendingUnlock = deferred<{ selectedKeyId?: string }>();
      rpc.unlockVault.mockReturnValueOnce(
        pendingUnlock.promise.then((value) => {
          backend.locked = false;
          return value;
        })
      );

      let result: unknown;
      await act(async () => {
        void latest()
          .unlock("hunter2")
          .then((r) => {
            result = r;
          });
      });
      expect(latest().isLoading).toBe(true);
      expect(latest().isLocked).toBe(true);
      expect(rpc.unlockVault).toHaveBeenCalledWith("hunter2");

      pendingUnlock.resolve({ selectedKeyId: "b" });
      await settle();

      expect(result).toEqual({ ok: true });
      expect(latest().isLoading).toBe(false);
      expect(latest().isLocked).toBe(false);
      expect(latest().lockAt).toBe(90_000);
      expect(latest().selectedKeyInfo?.id).toBe("b");
      expect(rpc.reportActivity).toHaveBeenCalledTimes(1);
    });

    it("does not claim a ready session when the read after a successful unlock fails, and recovers on retry", async () => {
      const backend = fakeBackend([entry({ id: "a" })], "a");
      await mountProvider();
      const answer = rpc.getLockState.getMockImplementation()!;
      rpc.getLockState.mockRejectedValueOnce(new Error("no_response"));

      let result: unknown;
      await act(async () => {
        result = await latest().unlock("pw");
      });

      expect(result).toEqual({ ok: true });
      expect(backend.locked).toBe(false);
      expect(latest().isLocked).toBe(true);
      expect(latest().lockCheckFailed).toBe(true);
      expect(latest().selectedKeyInfo).toBeUndefined();

      rpc.getLockState.mockImplementation(answer);
      act(() => latest().retryLockCheck());
      await settle();

      expect(latest().lockCheckFailed).toBe(false);
      expect(latest().isLocked).toBe(false);
      expect(latest().selectedKeyInfo?.id).toBe("a");
      expect(latest().selectedKeyInfo?.label).toBe("Key a");
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
      expect(latest().lockReason).toBe("manual");
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
      rpc.getLockState.mockResolvedValue(unlockedState({ selectedKeyId: "b" }));
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
  describe("restoring the identity after unlock", () => {
    const a = entry({ id: "a", label: "Alice" });
    const b = entry({ id: "b", label: "Bob" });

    it("shows the same name, public key and selection after a cold open while locked and an unlock", async () => {
      fakeBackend([a, b], "b");
      await mountProvider();

      expect(latest().isLocked).toBe(true);
      expect(latest().hasKeys).toBe(true);
      expect(latest().selectedKeyInfo).toBeUndefined();
      expect(latest().keys.map((k) => k.id)).toEqual(["a", "b"]);
      expect(latest().keys.every((k) => !k.isUnreadable && k.label === "")).toBe(true);

      await act(async () => {
        await latest().unlock("pw");
      });

      const selected = latest().selectedKeyInfo;
      expect(selected).toMatchObject({
        id: "b",
        label: "Bob",
        publicKeyHex: "b-hex",
        publicKeyBech32: "npub1b",
        isUnreadable: false,
        isSelected: true,
      });
      expect(latest().keys.map((k) => k.label)).toEqual(["Alice", "Bob"]);
      expect(latest().lockAt).toBe(90_000);
    });

    it.each([
      ["a generated key", [entry({ id: "g", label: "Generated" })], "g"],
      ["an imported key without a label", [entry({ id: "i", label: "" })], "i"],
      [
        "several keys, the last selected",
        [entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c", label: "Third" })],
        "c",
      ],
    ])("restores %s", async (_name, vault, selected) => {
      fakeBackend(vault, selected);
      await mountProvider();

      await act(async () => {
        await latest().unlock("pw");
      });

      expect(latest().keys.map((k) => k.id)).toEqual(vault.map((k) => k.id));
      expect(latest().selectedKeyInfo?.id).toBe(selected);
      expect(latest().selectedKeyInfo?.isUnreadable).toBe(false);
      expect(latest().selectedKeyInfo?.publicKeyBech32).toBe(`npub1${selected}`);
    });

    it("rehydrates when another surface unlocks, noticed on the next poll", async () => {
      const backend = fakeBackend([a, b], "a");
      await mountProvider();
      expect(latest().isLocked).toBe(true);

      backend.locked = false;
      await advancePoll();

      expect(latest().isLocked).toBe(false);
      expect(latest().selectedKeyInfo).toMatchObject({ id: "a", label: "Alice", isUnreadable: false });
      expect(latest().lockAt).toBe(90_000);
      expect(rpc.unlockVault).not.toHaveBeenCalled();
    });

    it("follows a key switch made on another surface", async () => {
      const backend = fakeBackend([a, b], "a");
      backend.locked = false;
      await mountProvider();
      expect(latest().selectedKeyInfo?.id).toBe("a");

      backend.selectedKeyId = "b";
      await advancePoll();

      expect(latest().selectedKeyInfo?.id).toBe("b");
      expect(latest().selectedKeyInfo?.isSelected).toBe(true);
    });

    it("drops names and public keys from memory when the vault locks, keeping only identifiers", async () => {
      fakeBackend([a, b], "b");
      await mountProvider();
      await act(async () => {
        await latest().unlock("pw");
      });
      expect(latest().keys[1].publicKeyBech32).toBe("npub1b");

      await act(async () => {
        await latest().lock();
      });

      expect(latest().isLocked).toBe(true);
      expect(latest().selectedKeyInfo).toBeUndefined();
      expect(latest().keys).toEqual([
        expect.objectContaining({ id: "a", label: "", publicKeyHex: "", publicKeyBech32: "" }),
        expect.objectContaining({ id: "b", label: "", publicKeyHex: "", publicKeyBech32: "" }),
      ]);
    });

    it("keeps the identity across repeated lock and unlock", async () => {
      fakeBackend([a, b], "b");
      await mountProvider();

      for (let round = 0; round < 3; round += 1) {
        await act(async () => {
          await latest().unlock("pw");
        });
        expect(latest().selectedKeyInfo).toMatchObject({ id: "b", label: "Bob" });
        await act(async () => {
          await latest().lock();
        });
        expect(latest().isLocked).toBe(true);
      }

      expect(latest().keys.map((k) => k.id)).toEqual(["a", "b"]);
      expect(rpc.generateKey).not.toHaveBeenCalled();
      expect(rpc.importKey).not.toHaveBeenCalled();
    });

    it("does not let an unlocked read that was overtaken by a lock repopulate the locked view", async () => {
      const backend = fakeBackend([a, b], "b");
      await mountProvider();
      const stale = deferred<LockStatePayload>();
      rpc.getLockState.mockReturnValueOnce(stale.promise);

      let result: unknown;
      await act(async () => {
        void latest().unlock("pw").then((r) => {
          result = r;
        });
      });
      expect(backend.locked).toBe(false);

      // The vault locks again while the unlock's read is still in flight.
      backend.locked = true;
      broadcast({ __event: BROADCAST_EVENTS.VAULT_LOCKED });
      await settle();
      stale.resolve({ isLocked: false, selectedKeyId: "b", lockAt: 90_000 });
      await settle();

      expect(result).toEqual({ ok: true });
      expect(latest().isLocked).toBe(true);
      expect(latest().lockAt).toBeUndefined();
      expect(latest().selectedKeyInfo).toBeUndefined();
      expect(latest().keys.every((k) => k.label === "")).toBe(true);
    });

    it("does not let a locked poll that was overtaken by an unlock overwrite the unlocked data", async () => {
      fakeBackend([a, b], "b");
      await mountProvider();
      const stale = deferred<LockStatePayload>();
      rpc.getLockState.mockReturnValueOnce(stale.promise);
      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });

      await act(async () => {
        await latest().unlock("pw");
      });
      expect(latest().isLocked).toBe(false);
      stale.resolve({ isLocked: true, selectedKeyId: "b", lockReason: "manual" });
      await settle();

      expect(latest().isLocked).toBe(false);
      expect(latest().lockReason).toBeUndefined();
      expect(latest().selectedKeyInfo).toMatchObject({ id: "b", label: "Bob" });
    });

    it("keeps a choice made while an earlier read was still loading", async () => {
      const backend = fakeBackend([a, b], "a");
      backend.locked = false;
      await mountProvider();
      const stale = deferred<LockStatePayload>();
      rpc.getLockState.mockReturnValueOnce(stale.promise);
      act(() => latest().retryLockCheck());

      await act(async () => {
        await latest().selectKey("b");
      });
      stale.resolve({ isLocked: false, selectedKeyId: "a", lockAt: 90_000 });
      await settle();

      expect(latest().selectedKeyInfo?.id).toBe("b");
      expect(latest().isLoading).toBe(false);
    });

    it("reads again when the list was fetched just before an unlock, and never shows an unlocked session over identifiers", async () => {
      const backend = fakeBackend([a], "a");
      backend.locked = false;
      const redacted = [{ id: "a" }];
      rpc.listKeys.mockResolvedValueOnce(redacted);

      await mountProvider();

      expect(rpc.listKeys).toHaveBeenCalledTimes(2);
      expect(latest().selectedKeyInfo).toMatchObject({ id: "a", label: "Alice", isUnreadable: false });
    });

    it("reports a failed check, not an identity, when the list stays redacted over an unlocked session", async () => {
      fakeBackend([a], "a").locked = false;
      rpc.listKeys.mockResolvedValue([{ id: "a" }]);

      await mountProvider();

      expect(latest().lockCheckFailed).toBe(true);
      expect(latest().isInitialising).toBe(false);
      expect(latest().selectedKeyInfo).toBeUndefined();
    });

    it("marks only the damaged record as unreadable, keeps its ID, and leaves the others usable", async () => {
      const backend = fakeBackend([a, entry({ id: "bad", npub: undefined })], "a");
      backend.locked = false;

      await mountProvider();

      expect(latest().keys.find((k) => k.id === "bad")).toMatchObject({ isUnreadable: true });
      expect(latest().selectedKeyInfo).toMatchObject({ id: "a", isUnreadable: false });
    });

    it("selects nothing when the background's selected key is not in the list, and creates nothing", async () => {
      fakeBackend([a, b], "gone").locked = false;

      await mountProvider();

      expect(latest().selectedKeyInfo).toBeUndefined();
      expect(latest().hasKeys).toBe(true);
      expect(rpc.generateKey).not.toHaveBeenCalled();
      expect(rpc.importKey).not.toHaveBeenCalled();
    });

    it("keeps the selection on a key that could not be opened, names it, and lets the user switch", async () => {
      const bad = entry({ id: "bad", label: "Damaged", unreadable: true });
      fakeBackend([bad, a], "bad");
      await mountProvider();

      await act(async () => {
        await latest().unlock("pw");
      });

      expect(latest().selectedKeyInfo).toMatchObject({ id: "bad", isUnreadable: true });
      expect(latest().keys.find((k) => k.id === "a")?.isUnreadable).toBe(false);

      await act(async () => {
        await latest().selectKey("a");
      });

      expect(latest().selectedKeyInfo).toMatchObject({ id: "a", isUnreadable: false });
    });
  });
});

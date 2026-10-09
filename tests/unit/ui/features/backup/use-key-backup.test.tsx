/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { BackupTarget } from "@/ui/features/backup/hooks/useKeyBackup";
import type { KeyBackupPayload } from "@/ui/features/backup/key-backup-envelope";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
const HEX = "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa";
const KEY: BackupTarget = { id: "11111111-1111-4111-8111-111111111111", label: "Trading" };

const manager = vi.hoisted(() => ({ isLocked: false }));
const revealKey = vi.hoisted(() => vi.fn());

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => manager,
}));
vi.mock("@/infrastructure/messaging/client", () => ({
  revealKey: (...args: unknown[]) => revealKey(...args),
}));

import { useKeyBackup } from "@/ui/features/backup/hooks/useKeyBackup";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

type Reauth = Parameters<typeof useKeyBackup>[0];

/** A re-auth that confirms with `password`, or is cancelled when null. */
function reauthWith(password: string | null): Reauth {
  return {
    request: async (_prompt: unknown, run: (password: string) => Promise<unknown>) => {
      if (password === null) throw new Error("cancelled");
      await run(password);
    },
    dialogProps: {} as Reauth["dialogProps"],
  } as Reauth;
}

let latest: ReturnType<typeof useKeyBackup>;
let rerender: () => void;
let unmount: () => void;

function mount(reauth: Reauth) {
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    latest = useKeyBackup(reauth);
    return null;
  }
  rerender = () => act(() => root.render(<Probe />));
  unmount = () => act(() => root.unmount());
  rerender();
}

beforeEach(() => {
  manager.isLocked = false;
  revealKey.mockReset().mockResolvedValue({ nsec: NSEC, hex: HEX });
});

afterEach(() => {
  unmount?.();
});

describe("useKeyBackup", () => {
  it("reveals the chosen key with the password, and names the backup after the key", async () => {
    mount(reauthWith("master"));

    await act(() => latest.start(KEY));

    expect(revealKey).toHaveBeenCalledExactlyOnceWith("master", KEY.id);
    expect(latest.target).toEqual(KEY);
    expect(latest.getPayload()).toEqual<KeyBackupPayload>({
      nsec: NSEC,
      hex: HEX,
      name: "Trading",
    });
  });

  it("opens nothing and reveals nothing when the password prompt is cancelled", async () => {
    mount(reauthWith(null));

    await act(() => latest.start(KEY));

    expect(revealKey).not.toHaveBeenCalled();
    expect(latest.target).toBeNull();
    expect(latest.getPayload()).toBeNull();
  });

  it("opens nothing and holds no key when the reveal is refused", async () => {
    revealKey.mockRejectedValue(new Error("rpc:vault.reveal:invalid_password"));
    const reauth = {
      request: async (_p: unknown, run: (p: string) => Promise<unknown>) => run("wrong"),
      dialogProps: {},
    } as unknown as Reauth;
    mount(reauth);

    await act(async () => {
      await latest.start(KEY).catch(() => undefined);
    });

    expect(latest.target).toBeNull();
    expect(latest.getPayload()).toBeNull();
  });

  it("drops the key on close", async () => {
    mount(reauthWith("master"));
    await act(() => latest.start(KEY));

    act(() => latest.close());

    expect(latest.target).toBeNull();
    expect(latest.getPayload()).toBeNull();
  });

  it("drops the key and reports why when the vault locks mid-backup", async () => {
    mount(reauthWith("master"));
    await act(() => latest.start(KEY));
    expect(latest.lockedMidBackup).toBe(false);

    manager.isLocked = true;
    rerender();

    expect(latest.getPayload()).toBeNull();
    expect(latest.lockedMidBackup).toBe(true);
    // Still open so the dialog can say why; it is not marked anything.
    expect(latest.target).toEqual(KEY);
  });

  it("keeps reporting the lock after an unlock, until a new backup starts", async () => {
    mount(reauthWith("master"));
    await act(() => latest.start(KEY));
    manager.isLocked = true;
    rerender();
    expect(latest.lockedMidBackup).toBe(true);

    manager.isLocked = false;
    rerender();

    expect(latest.lockedMidBackup).toBe(true);
    expect(latest.getPayload()).toBeNull();

    await act(() => latest.start(KEY));
    expect(latest.lockedMidBackup).toBe(false);
    expect(latest.getPayload()?.nsec).toBe(NSEC);
  });

  it("drops the key when the page goes away", async () => {
    mount(reauthWith("master"));
    await act(() => latest.start(KEY));
    const read = latest.getPayload;

    unmount();

    expect(read()).toBeNull();
  });

  it("drops an earlier key before revealing another", async () => {
    mount(reauthWith("master"));
    await act(() => latest.start(KEY));
    revealKey.mockRejectedValueOnce(new Error("rpc:vault.reveal:rate_limited"));

    await act(async () => {
      await latest.start({ ...KEY, id: "22222222-2222-4222-8222-222222222222" }).catch(() => undefined);
    });

    expect(latest.getPayload()).toBeNull();
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const manager = vi.hoisted(() => ({ isLocked: false, keys: [] as Array<{ id: string }> }));
const client = vi.hoisted(() => ({
  listBackupStatuses: vi.fn(),
  subscribeKeyBackupChanged: vi.fn(),
}));

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => manager,
}));
vi.mock("@/infrastructure/messaging/client", () => client);

import {
  useKeyBackupStatus,
  useKeyBackupStatuses,
} from "@/ui/features/backup/hooks/useKeyBackupStatus";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let notifyChanged: () => void;
let statuses: ReturnType<typeof useKeyBackupStatuses>;
let rerender: () => void;
let unmount: () => void;

async function mount() {
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    statuses = useKeyBackupStatuses();
    return null;
  }
  rerender = () => act(() => root.render(<Probe />));
  unmount = () => act(() => root.unmount());
  await act(async () => root.render(<Probe />));
}

beforeEach(() => {
  manager.isLocked = false;
  manager.keys = [{ id: A }, { id: B }];
  client.listBackupStatuses.mockReset().mockResolvedValue([
    { keyId: A, state: "pending", at: 1 },
  ]);
  client.subscribeKeyBackupChanged.mockReset().mockImplementation((cb: () => void) => {
    notifyChanged = cb;
    return () => {};
  });
});

afterEach(() => unmount?.());

describe("useKeyBackupStatuses", () => {
  it("reports a recorded key by its state and an unrecorded key as unknown", async () => {
    await mount();

    expect(statuses.statusOf(A)).toBe("pending");
    expect(statuses.statusOf(B)).toBe("unknown");
    expect(statuses.statusOf(undefined)).toBe("unknown");
  });

  it("answers for one key through useKeyBackupStatus", async () => {
    let seen = "";
    function One() {
      seen = useKeyBackupStatus(A);
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<One />));
    expect(seen).toBe("pending");
    act(() => root.unmount());
  });

  it("reads again when another page verifies a backup", async () => {
    await mount();
    client.listBackupStatuses.mockResolvedValue([{ keyId: A, state: "verified", at: 2 }]);

    await act(async () => notifyChanged());
    await act(async () => {});

    expect(statuses.statusOf(A)).toBe("verified");
  });

  it("reads again when a key is added, so it appears pending", async () => {
    await mount();
    const C = "33333333-3333-4333-8333-333333333333";
    client.listBackupStatuses.mockResolvedValue([
      { keyId: A, state: "pending", at: 1 },
      { keyId: C, state: "pending", at: 3 },
    ]);
    manager.keys = [{ id: A }, { id: B }, { id: C }];

    await act(async () => rerender());
    await act(async () => {});

    expect(statuses.statusOf(C)).toBe("pending");
  });

  it("makes no read while the vault is locked", async () => {
    manager.isLocked = true;
    await mount();

    expect(client.listBackupStatuses).not.toHaveBeenCalled();
    expect(statuses.statusOf(A)).toBe("unknown");
  });

  it("invents no status when the read fails", async () => {
    client.listBackupStatuses.mockRejectedValue(new Error("rpc:backup.list:locked"));
    await mount();

    expect(statuses.statusOf(A)).toBe("unknown");
  });
});

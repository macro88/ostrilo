// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvatarRow } from "@/domain/profile/avatar";
import { PNG_DATA_URL, SOURCE_URL } from "../../../helpers/avatar-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const client = vi.hoisted(() => ({
  getOwnAvatar: vi.fn<(pubkey: string) => Promise<AvatarRow | null>>(),
  subscribeAvatarChanged: vi.fn<(cb: () => void) => () => void>(),
}));

vi.mock("@/infrastructure/messaging/client", () => client);

const { useOwnAvatar } = await import("@/ui/hooks/useOwnAvatar");

const A = "a".repeat(64);
const B = "b".repeat(64);
const rowFor = (pubkey: string, dataUrl = PNG_DATA_URL): AvatarRow => ({
  pubkey,
  dataUrl,
  sourceUrl: SOURCE_URL,
  at: 1,
});

let container: HTMLDivElement;
let root: Root;
let seen: Array<AvatarRow | null>;
let notifyChanged: () => void;
const pending = new Map<string, PromiseWithResolvers<AvatarRow | null>>();

function Harness({ pubkey }: { pubkey: string | null }) {
  seen.push(useOwnAvatar(pubkey));
  return null;
}

const render = (pubkey: string | null) => act(() => root.render(<Harness pubkey={pubkey} />));
const latest = () => seen.at(-1) ?? null;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function answer(pubkey: string, row: AvatarRow | null) {
  pending.get(pubkey)!.resolve(row);
  await settle();
}

beforeEach(() => {
  seen = [];
  pending.clear();
  client.getOwnAvatar.mockReset().mockImplementation((pubkey) => {
    const d = Promise.withResolvers<AvatarRow | null>();
    pending.set(pubkey, d);
    return d.promise;
  });
  client.subscribeAvatarChanged.mockReset().mockImplementation((cb) => {
    notifyChanged = cb;
    return () => undefined;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useOwnAvatar", () => {
  it("returns the copy for the key asked about", async () => {
    render(A);
    expect(latest()).toBeNull();
    await answer(A, rowFor(A));
    expect(latest()?.pubkey).toBe(A);
  });

  it("asks for no copy without a key", async () => {
    render(null);
    await settle();
    expect(client.getOwnAvatar).not.toHaveBeenCalled();
    expect(latest()).toBeNull();
  });

  it("never returns the previous key's copy for the new key, not even for one render", async () => {
    render(A);
    await answer(A, rowFor(A));
    seen = [];

    render(B);
    expect(seen.every((row) => row?.pubkey !== A)).toBe(true);
    expect(latest()).toBeNull();

    await answer(B, rowFor(B));
    expect(seen.every((row) => row?.pubkey !== A)).toBe(true);
    expect(latest()?.pubkey).toBe(B);
  });

  it("ignores a late answer for a key that is no longer selected", async () => {
    render(A);
    render(B);
    await answer(B, null);
    await answer(A, rowFor(A));
    expect(latest()).toBeNull();
    expect(seen.every((row) => row?.pubkey !== A)).toBe(true);
  });

  it("refuses a row for a different key than the one asked about", async () => {
    render(A);
    await answer(A, rowFor(B));
    expect(latest()).toBeNull();
  });

  it("refuses a row whose image is not a stored data URL", async () => {
    render(A);
    await answer(A, rowFor(A, "https://relay.example/a.png"));
    expect(latest()).toBeNull();
  });

  it("falls back to no copy when the read fails", async () => {
    render(A);
    pending.get(A)!.reject(new Error("locked"));
    await settle();
    expect(latest()).toBeNull();
  });

  it("reads again when a copy is saved or removed elsewhere", async () => {
    render(A);
    await answer(A, null);
    expect(latest()).toBeNull();

    act(() => notifyChanged());
    expect(client.getOwnAvatar).toHaveBeenCalledTimes(2);
    await answer(A, rowFor(A));
    expect(latest()?.pubkey).toBe(A);

    act(() => notifyChanged());
    await answer(A, null);
    expect(latest()).toBeNull();
  });
});

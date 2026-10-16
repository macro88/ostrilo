/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

const PUBKEY = "a".repeat(64);
const URL_A = "https://images.example/a.png";
const URL_B = "https://images.example/b.png";
const COPY_A = "data:image/webp;base64,QQ==";
const COPY_B = "data:image/webp;base64,Qg==";

interface StoredCopy {
  sourceUrl: string;
  dataUrl: string;
}

const store = vi.hoisted(() => ({ copies: new Map<string, unknown>() }));
const captures = vi.hoisted(() => ({
  pending: new Map<string, { resolve: (dataUrl: string) => void; reject: (error: unknown) => void }>(),
}));
const saveOwnAvatar = vi.hoisted(() => vi.fn());
const removeOwnAvatar = vi.hoisted(() => vi.fn());

vi.mock("@/infrastructure/messaging/client", () => ({
  getOwnAvatar: async (pubkey: string) => store.copies.get(pubkey) ?? null,
  saveOwnAvatar: (input: { pubkey: string; sourceUrl: string; dataUrl: string }) =>
    saveOwnAvatar(input),
  removeOwnAvatar: (pubkey: string) => removeOwnAvatar(pubkey),
}));
vi.mock("@/ui/lib/avatar-capture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/lib/avatar-capture")>()),
  captureAvatar: (sourceUrl: string) =>
    new Promise<string>((resolve, reject) => {
      captures.pending.set(sourceUrl, { resolve, reject });
    }),
}));

import { useProfilePicture } from "@/ui/features/profile/hooks/useProfilePicture";
import { AvatarCaptureError } from "@/ui/lib/avatar-capture";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let latest: ReturnType<typeof useProfilePicture>;
let unmount: () => void;

function mount(pubkey: string | null) {
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    latest = useProfilePicture(pubkey);
    return null;
  }
  unmount = () => act(() => root.unmount());
  act(() => root.render(<Probe />));
}

/** Starts `cache` without waiting, so the capture stays in flight. */
function begin(sourceUrl: string): Promise<void> {
  let started!: Promise<void>;
  act(() => {
    started = latest.cache(sourceUrl);
  });
  return started;
}

async function settle(run: () => void, ...started: Array<Promise<void>>) {
  await act(async () => {
    run();
    await Promise.all(started);
  });
}

function stored(): StoredCopy | undefined {
  return store.copies.get(PUBKEY) as StoredCopy | undefined;
}

beforeEach(() => {
  store.copies.clear();
  captures.pending.clear();
  saveOwnAvatar.mockReset().mockImplementation(async (input: StoredCopy & { pubkey: string }) => {
    store.copies.set(input.pubkey, { sourceUrl: input.sourceUrl, dataUrl: input.dataUrl });
  });
  removeOwnAvatar.mockReset().mockImplementation(async (pubkey: string) => {
    store.copies.delete(pubkey);
  });
  mount(PUBKEY);
});

afterEach(() => {
  unmount?.();
});

describe("useProfilePicture", () => {
  it("stores the copy and reports it saved", async () => {
    const a = begin(URL_A);
    expect(latest.status).toEqual({ kind: "working" });

    await settle(() => captures.pending.get(URL_A)!.resolve(COPY_A), a);

    expect(stored()).toEqual({ sourceUrl: URL_A, dataUrl: COPY_A });
    expect(latest.status).toEqual({ kind: "saved" });
  });

  it("keeps the later picture when an earlier capture finishes after it", async () => {
    const a = begin(URL_A);
    const b = begin(URL_B);

    await settle(() => captures.pending.get(URL_B)!.resolve(COPY_B), b);
    await settle(() => captures.pending.get(URL_A)!.resolve(COPY_A), a);

    expect(stored()).toEqual({ sourceUrl: URL_B, dataUrl: COPY_B });
    expect(saveOwnAvatar).toHaveBeenCalledExactlyOnceWith({
      pubkey: PUBKEY,
      sourceUrl: URL_B,
      dataUrl: COPY_B,
    });
    expect(latest.status).toEqual({ kind: "saved" });
  });

  it("neither removes the newer copy nor reports a failure when the earlier capture fails late", async () => {
    const a = begin(URL_A);
    const b = begin(URL_B);

    await settle(() => captures.pending.get(URL_B)!.resolve(COPY_B), b);
    await settle(() => captures.pending.get(URL_A)!.reject(new AvatarCaptureError("timeout")), a);

    expect(stored()).toEqual({ sourceUrl: URL_B, dataUrl: COPY_B });
    expect(removeOwnAvatar).not.toHaveBeenCalled();
    expect(latest.status).toEqual({ kind: "saved" });
  });

  it("saves nothing when the profile was cleared during the capture", async () => {
    const a = begin(URL_A);

    await act(() => latest.clear());
    expect(latest.status).toEqual({ kind: "idle" });
    await settle(() => captures.pending.get(URL_A)!.resolve(COPY_A), a);

    expect(saveOwnAvatar).not.toHaveBeenCalled();
    expect(stored()).toBeUndefined();
    expect(latest.status).toEqual({ kind: "idle" });
  });

  it("does not touch the stored copy when a capture cleared away fails", async () => {
    store.copies.set(PUBKEY, { sourceUrl: URL_B, dataUrl: COPY_B });
    const a = begin(URL_A);

    await act(() => latest.clear());
    store.copies.set(PUBKEY, { sourceUrl: URL_B, dataUrl: COPY_B });
    await settle(() => captures.pending.get(URL_A)!.reject(new AvatarCaptureError("timeout")), a);

    expect(stored()).toEqual({ sourceUrl: URL_B, dataUrl: COPY_B });
    expect(latest.status).toEqual({ kind: "idle" });
  });

  it("drops a stale copy of another URL when the only capture fails", async () => {
    store.copies.set(PUBKEY, { sourceUrl: URL_B, dataUrl: COPY_B });
    const a = begin(URL_A);

    await settle(() => captures.pending.get(URL_A)!.reject(new AvatarCaptureError("timeout")), a);

    expect(stored()).toBeUndefined();
    expect(latest.status.kind).toBe("failed");
  });

  it("keeps the existing copy when a refresh of the same URL fails", async () => {
    store.copies.set(PUBKEY, { sourceUrl: URL_A, dataUrl: COPY_A });
    const a = begin(URL_A);

    await settle(() => captures.pending.get(URL_A)!.reject(new AvatarCaptureError("timeout")), a);

    expect(stored()).toEqual({ sourceUrl: URL_A, dataUrl: COPY_A });
    expect(latest.status.kind).toBe("failed");
  });
});

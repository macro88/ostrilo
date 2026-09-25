// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileMetadata } from "@/domain/profile/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const client = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/infrastructure/messaging/client", () => client);

const { useProfileMetadata } = await import("@/ui/hooks/useProfileMetadata");

type Result = ReturnType<typeof useProfileMetadata>;

interface ProfileGet {
  type: string;
  params: { pubkey: string; forceFetch: boolean };
}

let container: HTMLDivElement;
let root: Root;
let current: Result | null;
const pending = new Map<string, PromiseWithResolvers<ProfileMetadata | null>>();

function Harness({ pubkeys }: { pubkeys: string[] }) {
  current = useProfileMetadata(pubkeys);
  return null;
}

function result(): Result {
  if (!current) throw new Error("harness has not rendered");
  return current;
}

function render(pubkeys: string[]) {
  act(() => root.render(<Harness pubkeys={pubkeys} />));
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

function deferRequests() {
  client.rpc.mockImplementation((request: ProfileGet) => {
    const d = Promise.withResolvers<ProfileMetadata | null>();
    pending.set(request.params.pubkey, d);
    return d.promise;
  });
}

async function answer(pubkey: string, profile: ProfileMetadata | null) {
  const d = pending.get(pubkey);
  if (!d) throw new Error(`no request for ${pubkey}`);
  d.resolve(profile);
  await settle();
}

describe("useProfileMetadata", () => {
  beforeEach(() => {
    client.rpc.mockReset();
    pending.clear();
    current = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("is idle with an empty map and sends nothing for no keys", async () => {
    render([]);
    await settle();

    expect(result().isLoading).toBe(false);
    expect(result().profiles.size).toBe(0);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("requests each key from cache and maps only the ones that resolved to a profile", async () => {
    client.rpc.mockImplementation(async ({ params }: ProfileGet) => {
      if (params.pubkey === "a") return { name: "Alice" };
      if (params.pubkey === "b") return null;
      throw new Error("relay timeout");
    });

    render(["a", "b", "c"]);
    expect(result().isLoading).toBe(true);
    await settle();

    expect(client.rpc.mock.calls.map(([r]) => r)).toEqual([
      { type: "profile.get", params: { pubkey: "a", forceFetch: false } },
      { type: "profile.get", params: { pubkey: "b", forceFetch: false } },
      { type: "profile.get", params: { pubkey: "c", forceFetch: false } },
    ]);
    expect(result().isLoading).toBe(false);
    expect([...result().profiles]).toEqual([["a", { name: "Alice" }]]);
  });

  it("does not refetch when rerendered with an equal key list", async () => {
    client.rpc.mockResolvedValue({ name: "Alice" });
    render(["a"]);
    await settle();

    render(["a"]);
    await settle();

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(result().isLoading).toBe(false);
  });

  it("discards an abandoned fetch and settles on the fetch for the new key set", async () => {
    deferRequests();
    render(["a"]);
    render(["b"]);
    expect(result().isLoading).toBe(true);

    await answer("a", { name: "Alice" });
    expect(result().isLoading).toBe(true);
    expect(result().profiles.has("a")).toBe(false);

    await answer("b", { name: "Bob" });
    expect(result().isLoading).toBe(false);
    expect([...result().profiles]).toEqual([["b", { name: "Bob" }]]);
  });

  it("stops loading when the key set empties while a fetch is in flight", async () => {
    deferRequests();
    render(["a"]);
    expect(result().isLoading).toBe(true);

    render([]);
    expect(result().isLoading).toBe(false);
    expect(result().profiles.size).toBe(0);

    await answer("a", { name: "Alice" });
    expect(result().isLoading).toBe(false);
    expect(result().profiles.size).toBe(0);
  });

  it("loads again when keys return after emptying, even for a set fetched before", async () => {
    deferRequests();
    render(["a"]);
    await answer("a", { name: "Alice" });

    render([]);
    render(["a", "b"]);
    expect(result().isLoading).toBe(true);

    await answer("a", { name: "Alice" });
    await answer("b", null);
    expect(result().isLoading).toBe(false);
    expect([...result().profiles.keys()]).toEqual(["a"]);
  });

  it("ignores a fetch that completes after unmount", async () => {
    deferRequests();
    render(["a"]);

    act(() => root.unmount());
    await answer("a", { name: "Alice" });

    expect(result().isLoading).toBe(true);
    root = createRoot(container);
  });
});

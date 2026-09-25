// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileMetadata } from "@/domain/profile/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const client = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/infrastructure/messaging/client", () => client);

const { useProfile } = await import("@/ui/hooks/useProfile");

type Profile = ReturnType<typeof useProfile>;

interface RpcRequest {
  type: string;
  params: Record<string, unknown>;
}

const alice: ProfileMetadata = { name: "alice", about: "first" };
const aliceEdited: ProfileMetadata = { name: "alice", about: "edited" };

let container: HTMLDivElement;
let root: Root;
let current: Profile | null;

function Harness({ pubkey }: { pubkey: string | null }) {
  current = useProfile(pubkey);
  return null;
}

function profile(): Profile {
  if (!current) throw new Error("harness has not rendered");
  return current;
}

function render(pubkey: string | null) {
  act(() => root.render(<Harness pubkey={pubkey} />));
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

function requests(): RpcRequest[] {
  return client.rpc.mock.calls.map(([request]) => request as RpcRequest);
}

describe("useProfile", () => {
  beforeEach(() => {
    client.rpc.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    current = null;
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

  it("is loading from the first frame and then shows the fetched profile", async () => {
    client.rpc.mockResolvedValueOnce(alice);

    render("pk1");
    expect(profile().loading).toBe(true);
    expect(profile().profile).toBeNull();

    await settle();

    expect(requests()).toEqual([
      { type: "profile.get", params: { pubkey: "pk1", forceFetch: false } },
    ]);
    expect(profile()).toMatchObject({ profile: alice, loading: false, error: null });
  });

  it("sends nothing and is idle without a pubkey", async () => {
    render(null);
    await settle();

    expect(client.rpc).not.toHaveBeenCalled();
    expect(profile()).toMatchObject({ profile: null, loading: false, error: null });
  });

  it("clears the profile when the pubkey goes away", async () => {
    client.rpc.mockResolvedValueOnce(alice);
    render("pk1");
    await settle();

    render(null);
    await settle();

    expect(profile().profile).toBeNull();
    expect(profile().loading).toBe(false);
  });

  it("reports the failure message when the fetch fails", async () => {
    client.rpc.mockRejectedValueOnce(new Error("relay timeout"));

    render("pk1");
    await settle();

    expect(profile()).toMatchObject({ loading: false, error: "relay timeout" });
  });

  it("reports a generic message when the fetch fails without an Error", async () => {
    client.rpc.mockRejectedValueOnce("offline");

    render("pk1");
    await settle();

    expect(profile().error).toBe("Could not load the profile.");
  });

  it("stops showing placeholders after the settle deadline and still accepts a late answer", async () => {
    vi.useFakeTimers();
    const late = Promise.withResolvers<ProfileMetadata>();
    client.rpc.mockReturnValueOnce(late.promise);

    render("pk1");
    expect(profile().loading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(profile().loading).toBe(false);
    expect(profile().profile).toBeNull();

    late.resolve(alice);
    await settle();
    expect(profile().profile).toEqual(alice);
  });

  it("forces a relay fetch on refresh", async () => {
    client.rpc.mockResolvedValueOnce(alice).mockResolvedValueOnce(aliceEdited);
    render("pk1");
    await settle();

    await act(async () => {
      await profile().refresh();
    });

    expect(requests()[1]).toEqual({
      type: "profile.get",
      params: { pubkey: "pk1", forceFetch: true },
    });
    expect(profile().profile).toEqual(aliceEdited);
  });

  it("publishes an update, shows it at once and then refetches from relays", async () => {
    client.rpc.mockResolvedValueOnce(alice);
    render("pk1");
    await settle();

    const refetch = Promise.withResolvers<ProfileMetadata>();
    client.rpc.mockResolvedValueOnce(null).mockReturnValueOnce(refetch.promise);

    let updating!: Promise<void>;
    act(() => {
      updating = profile().updateProfile(aliceEdited);
    });
    await settle();

    expect(requests()[1]).toEqual({
      type: "profile.update",
      params: { metadata: aliceEdited },
    });
    expect(profile().profile).toEqual(aliceEdited);
    expect(profile().loading).toBe(true);

    await act(async () => {
      refetch.resolve(aliceEdited);
      await updating;
    });

    expect(requests()[2]).toEqual({
      type: "profile.get",
      params: { pubkey: "pk1", forceFetch: true },
    });
    expect(profile()).toMatchObject({ profile: aliceEdited, loading: false });
  });

  it("keeps the old profile, reports the error and rethrows when publishing fails", async () => {
    client.rpc.mockResolvedValueOnce(alice);
    render("pk1");
    await settle();

    client.rpc.mockRejectedValueOnce(new Error("no relay accepted the event"));
    let failure: unknown;
    await act(async () => {
      failure = await profile()
        .updateProfile(aliceEdited)
        .catch((e: unknown) => e);
    });

    expect((failure as Error).message).toBe("no relay accepted the event");
    expect(profile()).toMatchObject({
      profile: alice,
      loading: false,
      error: "no relay accepted the event",
    });
  });

  it("reports a generic message when publishing fails without an Error", async () => {
    client.rpc.mockResolvedValueOnce(alice);
    render("pk1");
    await settle();

    client.rpc.mockRejectedValueOnce("offline");
    await act(async () => {
      await profile()
        .updateProfile(aliceEdited)
        .catch(() => undefined);
    });

    expect(profile().error).toBe("Could not update the profile.");
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ActivityLogEntry } from "@/domain/types";

type Page = { entries: ActivityLogEntry[]; total: number };

const client = vi.hoisted(() => ({
  activityGetRecent: vi.fn<(options: { limit: number; offset: number }) => Promise<Page>>(),
  activityFilterBy: vi.fn<
    (filters: { origin?: string; kind?: number; limit: number; offset: number }) => Promise<Page>
  >(),
}));

vi.mock("@/infrastructure/messaging/client", () => client);

const { useActivityLog } = await import("@/ui/features/activity/hooks/useActivityLog");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type HookResult = ReturnType<typeof useActivityLog>;
type HookOptions = Parameters<typeof useActivityLog>[0];

let latest: HookResult;
let container: HTMLDivElement;
let root: Root;

function Probe({ options }: { options?: HookOptions }) {
  latest = useActivityLog(options);
  return null;
}

async function mount(options?: HookOptions) {
  await act(async () => {
    root.render(<Probe options={options} />);
  });
}

function entries(prefix: string, count: number): ActivityLogEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    timestamp: 1_735_689_600 - index,
    origin: "https://primal.net",
    kind: 1,
    decision: "allow",
  })) as ActivityLogEntry[];
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  client.activityGetRecent.mockReset().mockResolvedValue({ entries: [], total: 0 });
  client.activityFilterBy.mockReset().mockResolvedValue({ entries: [], total: 0 });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  consoleError.mockRestore();
});

describe("useActivityLog initial load", () => {
  it("is loading from the first render and reads the first unfiltered page", async () => {
    const page = deferred<Page>();
    client.activityGetRecent.mockReturnValue(page.promise);
    await mount();

    expect(latest.loading).toBe(true);
    expect(client.activityGetRecent).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    expect(client.activityFilterBy).not.toHaveBeenCalled();

    await act(async () => page.resolve({ entries: entries("a", 3), total: 3 }));
    expect(latest.loading).toBe(false);
    expect(latest.entries.map((item) => item.id)).toEqual(["a-0", "a-1", "a-2"]);
    expect(latest.total).toBe(3);
    expect(latest.hasMore).toBe(false);
  });

  it("uses the filter query when an origin or kind is set", async () => {
    await mount({ origin: "https://primal.net" });
    expect(client.activityFilterBy).toHaveBeenLastCalledWith({
      origin: "https://primal.net",
      kind: undefined,
      limit: 10,
      offset: 0,
    });

    await mount({ kind: 0 });
    expect(client.activityFilterBy).toHaveBeenLastCalledWith({
      origin: undefined,
      kind: 0,
      limit: 10,
      offset: 0,
    });
    expect(client.activityGetRecent).not.toHaveBeenCalled();
  });

  it("fetches nothing and is not loading when auto-load is off", async () => {
    await mount({ autoLoad: false });
    expect(latest.loading).toBe(false);
    expect(client.activityGetRecent).not.toHaveBeenCalled();
  });

  it("reports a failed load as an error, not as an empty log", async () => {
    client.activityGetRecent.mockRejectedValue(new Error("background asleep"));
    await mount();
    expect(latest.loading).toBe(false);
    expect(latest.error?.message).toBe("background asleep");
  });

  it("wraps a non-Error rejection in a readable error", async () => {
    client.activityGetRecent.mockRejectedValue("nope");
    await mount();
    expect(latest.error?.message).toBe("Failed to fetch activity log");
  });

  it("drops the answer for a filter that is no longer current", async () => {
    const stale = deferred<Page>();
    client.activityFilterBy
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ entries: entries("fresh", 1), total: 1 });

    await mount({ origin: "https://old.example" });
    await mount({ origin: "https://new.example" });
    await act(async () => stale.resolve({ entries: entries("stale", 5), total: 5 }));

    expect(latest.entries.map((item) => item.id)).toEqual(["fresh-0"]);
  });

  it("drops a failure for a filter that is no longer current", async () => {
    const stale = deferred<Page>();
    client.activityFilterBy
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ entries: entries("fresh", 1), total: 1 });

    await mount({ kind: 1 });
    await mount({ kind: 7 });
    await act(async () => stale.reject(new Error("late failure")));

    expect(latest.error).toBeNull();
    expect(latest.entries).toHaveLength(1);
  });
});

describe("useActivityLog pagination", () => {
  it("appends the next page at the next offset", async () => {
    client.activityGetRecent
      .mockResolvedValueOnce({ entries: entries("p1", 10), total: 15 })
      .mockResolvedValueOnce({ entries: entries("p2", 5), total: 15 });
    await mount();
    expect(latest.hasMore).toBe(true);

    await act(async () => latest.loadMore());

    expect(client.activityGetRecent).toHaveBeenLastCalledWith({ limit: 10, offset: 10 });
    expect(latest.entries).toHaveLength(15);
    expect(latest.entries[10].id).toBe("p2-0");
    expect(latest.hasMore).toBe(false);
  });

  it("pages through the filter query when filtered", async () => {
    client.activityFilterBy
      .mockResolvedValueOnce({ entries: entries("p1", 10), total: 11 })
      .mockResolvedValueOnce({ entries: entries("p2", 1), total: 11 });
    await mount({ kind: 1 });
    await act(async () => latest.loadMore());
    expect(client.activityFilterBy).toHaveBeenLastCalledWith({
      origin: undefined,
      kind: 1,
      limit: 10,
      offset: 10,
    });
  });

  it("keeps the rows it has when the next page fails", async () => {
    client.activityGetRecent
      .mockResolvedValueOnce({ entries: entries("p1", 10), total: 20 })
      .mockRejectedValueOnce(new Error("relay gone"));
    await mount();
    await act(async () => latest.loadMore());

    expect(latest.entries).toHaveLength(10);
    expect(latest.error?.message).toBe("relay gone");
    expect(latest.loading).toBe(false);
  });

  it("refresh replaces the list from the start", async () => {
    client.activityGetRecent
      .mockResolvedValueOnce({ entries: entries("p1", 10), total: 20 })
      .mockResolvedValueOnce({ entries: entries("p2", 10), total: 20 })
      .mockResolvedValueOnce({ entries: entries("r", 2), total: 2 });
    await mount();
    await act(async () => latest.loadMore());
    await act(async () => latest.refresh());

    expect(client.activityGetRecent).toHaveBeenLastCalledWith({ limit: 10, offset: 0 });
    expect(latest.entries.map((item) => item.id)).toEqual(["r-0", "r-1"]);
    expect(latest.total).toBe(2);
  });

  it("refresh surfaces a failure", async () => {
    client.activityGetRecent
      .mockResolvedValueOnce({ entries: [], total: 0 })
      .mockRejectedValueOnce("offline");
    await mount();
    await act(async () => latest.refresh());
    expect(latest.error?.message).toBe("Failed to fetch activity log");
  });
});

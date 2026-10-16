import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_TRACKED_ORIGINS,
  RollingWindowCounters,
} from "@/application/services/rolling-window-counters";
import type { StoragePort } from "@/application/ports/storage";

const KEY = "rateWindow:test";
const WINDOW = 60_000;
const LIMIT = 5;
const A = "https://a.example";

function memoryPort(initial?: unknown): StoragePort & {
  map: Map<string, unknown>;
  sets: number;
} {
  const map = new Map<string, unknown>();
  if (initial !== undefined) map.set(KEY, initial);
  const port = {
    map,
    sets: 0,
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      port.sets += 1;
      map.set(key, structuredClone(value));
    },
    async remove(key: string) {
      map.delete(key);
    },
  };
  return port;
}

describe("RollingWindowCounters", () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function counters(storage?: StoragePort) {
    return new RollingWindowCounters({
      storage,
      storageKey: KEY,
      windowMs: WINDOW,
      maxPerOrigin: LIMIT,
      now,
    });
  }

  describe("the window", () => {
    it("counts entries inside the window and drops them at its edge", async () => {
      const c = counters();
      c.record(A);
      clock += WINDOW - 1;
      expect(c.count(A)).toBe(1);
      clock += 1;
      expect(c.count(A)).toBe(0);
    });

    it("counts each origin separately", () => {
      const c = counters();
      c.record(A);
      c.record(A);
      expect(c.count("https://b.example")).toBe(0);
      expect(c.count(A)).toBe(2);
    });

    it("never holds more than the per-origin limit", () => {
      const c = counters();
      for (let i = 0; i < LIMIT + 3; i++) c.record(A);
      expect(c.count(A)).toBe(LIMIT);
    });
  });

  describe("persistence", () => {
    it("writes the window and reads it back after a restart", async () => {
      const storage = memoryPort();
      const first = counters(storage);
      first.record(A);
      first.record(A);
      await first.settled();

      const restarted = counters(storage);
      await restarted.ready();

      expect(restarted.count(A)).toBe(2);
    });

    it("keeps an entry's age across the restart", async () => {
      const storage = memoryPort();
      const first = counters(storage);
      first.record(A);
      await first.settled();

      clock += WINDOW - 1;
      const restarted = counters(storage);
      await restarted.ready();
      expect(restarted.count(A)).toBe(1);

      clock += 1;
      expect(restarted.count(A)).toBe(0);
    });

    it("drops entries that expired while the worker was away", async () => {
      const storage = memoryPort();
      const first = counters(storage);
      first.record(A);
      await first.settled();

      clock += WINDOW + 5_000;
      const restarted = counters(storage);
      await restarted.ready();

      expect(restarted.count(A)).toBe(0);
    });

    it("writes only after the stored window has been read, so a charge made during the read is not lost to it", async () => {
      const storage = memoryPort({
        v: 1,
        origins: { [A]: [clock - 1_000, clock - 500] },
      });
      const c = counters(storage);
      c.record(A);
      await c.settled();

      expect(c.count(A)).toBe(3);
      expect(
        (storage.map.get(KEY) as { origins: Record<string, number[]> }).origins[A]
      ).toHaveLength(3);
    });

    it("coalesces a burst into few writes, ending on the newest state", async () => {
      const storage = memoryPort();
      const c = counters(storage);
      for (let i = 0; i < LIMIT; i++) c.record(A);
      await c.settled();

      expect(storage.sets).toBeLessThanOrEqual(2);
      const stored = storage.map.get(KEY) as { origins: Record<string, number[]> };
      expect(stored.origins[A]).toHaveLength(LIMIT);
    });

    it("does not store an origin whose window has emptied", async () => {
      const storage = memoryPort();
      const c = counters(storage);
      c.record(A);
      await c.settled();
      clock += WINDOW;
      c.record("https://b.example");
      await c.settled();

      const stored = storage.map.get(KEY) as { origins: Record<string, number[]> };
      expect(Object.keys(stored.origins)).toEqual(["https://b.example"]);
    });

    it("keeps enforcing from memory when the write fails", async () => {
      const storage = memoryPort();
      vi.spyOn(storage, "set").mockRejectedValue(new Error("quota"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const c = counters(storage);

      for (let i = 0; i < LIMIT; i++) c.record(A);
      await c.settled();

      expect(c.count(A)).toBe(LIMIT);
      expect(warn).toHaveBeenCalled();
    });

    it("starts empty, not broken, when the read fails", async () => {
      const storage = memoryPort();
      vi.spyOn(storage, "get").mockRejectedValue(new Error("unavailable"));
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const c = counters(storage);
      await c.ready();

      expect(c.count(A)).toBe(0);
      c.record(A);
      expect(c.count(A)).toBe(1);
    });

    it("clear empties the stored window too", async () => {
      const storage = memoryPort();
      const c = counters(storage);
      c.record(A);
      await c.settled();
      c.clear();
      await c.settled();

      const restarted = counters(storage);
      await restarted.ready();
      expect(restarted.count(A)).toBe(0);
    });
  });

  describe("malformed stored records are an empty window", () => {
    const malformed: Array<[string, unknown]> = [
      ["a string", "nonsense"],
      ["a number", 42],
      ["null", null],
      ["an array", [1, 2, 3]],
      ["an unknown version", { v: 2, origins: { [A]: [1_000_000] } }],
      ["a missing version", { origins: { [A]: [1_000_000] } }],
      ["origins that is not an object", { v: 1, origins: [A] }],
      ["origins that is a string", { v: 1, origins: "x" }],
    ];

    it.each(malformed)("%s", async (_name, record) => {
      const c = counters(memoryPort(record));
      await c.ready();

      expect(c.count(A)).toBe(0);
      expect(() => c.record(A)).not.toThrow();
      expect(c.count(A)).toBe(1);
    });

    it("drops one bad origin and keeps the good one beside it", async () => {
      const c = counters(
        memoryPort({
          v: 1,
          origins: {
            [A]: "not a list",
            "https://b.example": [clock - 10],
            "": [clock - 10],
          },
        })
      );
      await c.ready();

      expect(c.count(A)).toBe(0);
      expect(c.count("https://b.example")).toBe(1);
      expect(c.count("")).toBe(0);
    });

    it("ignores timestamps that are not finite numbers", async () => {
      const c = counters(
        memoryPort({
          v: 1,
          origins: { [A]: [clock - 10, "x", null, NaN, Infinity] },
        })
      );
      await c.ready();

      expect(c.count(A)).toBe(1);
    });

    it("treats a list longer than anything it writes as unusable", async () => {
      const c = counters(
        memoryPort({
          v: 1,
          origins: { [A]: Array.from({ length: LIMIT + 1 }, () => clock - 1) },
        })
      );
      await c.ready();

      expect(c.count(A)).toBe(0);
    });

    it("clamps a timestamp from the future to now rather than trusting it", async () => {
      const c = counters(
        memoryPort({ v: 1, origins: { [A]: [clock + 10 * WINDOW] } })
      );
      await c.ready();

      expect(c.count(A)).toBe(1);
      clock += WINDOW;
      expect(c.count(A)).toBe(0);
    });

    it("treats an origin key longer than a URL can be as unusable", async () => {
      const long = `https://${"a".repeat(3000)}.example`;
      const c = counters(memoryPort({ v: 1, origins: { [long]: [clock - 1] } }));
      await c.ready();

      expect(c.count(long)).toBe(0);
    });
  });

  describe("bounds", () => {
    it("tracks no more origins than the cap, keeping the most recently active", async () => {
      const origins: Record<string, number[]> = {};
      const total = MAX_TRACKED_ORIGINS + 20;
      for (let i = 0; i < total; i++) {
        origins[`https://o${i}.example`] = [clock - (total - i)];
      }
      const c = counters(memoryPort({ v: 1, origins }));
      await c.ready();

      expect(c.count(`https://o${total - 1}.example`)).toBe(1);
      expect(c.count("https://o0.example")).toBe(0);
    });

    it("never writes more than the cap", async () => {
      const storage = memoryPort();
      const c = counters(storage);
      for (let i = 0; i < MAX_TRACKED_ORIGINS + 30; i++) {
        c.record(`https://o${i}.example`);
      }
      await c.settled();

      const stored = storage.map.get(KEY) as { origins: Record<string, number[]> };
      expect(Object.keys(stored.origins).length).toBeLessThanOrEqual(
        MAX_TRACKED_ORIGINS
      );
    });
  });
});

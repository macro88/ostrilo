import { describe, it, expect, beforeEach, vi } from "vitest";
import { ActivityLogService } from "@/application/services/activity-log.service";
import type { StoragePort } from "@/application/ports/storage";
import type { ActivityLogEntry, ActivityLogStorage } from "@/domain/types";

class MemoryStorage implements StoragePort {
  readonly store = new Map<string, unknown>();
  failGet = false;
  failSet = false;

  async get<T>(key: string): Promise<T | undefined> {
    if (this.failGet) throw new Error("storage read failed");
    return structuredClone(this.store.get(key)) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (this.failSet) throw new Error("storage write failed");
    this.store.set(key, structuredClone(value));
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }

  stored(): ActivityLogStorage | undefined {
    return this.store.get("activityLog") as ActivityLogStorage | undefined;
  }
}

function entry(
  n: number,
  overrides: Partial<ActivityLogEntry> = {}
): ActivityLogEntry {
  return {
    id: `id-${n}`,
    timestamp: 1_700_000_000 + n,
    origin: "https://a.example",
    kind: 1,
    decision: "allow",
    ...overrides,
  };
}

function seed(
  storage: MemoryStorage,
  value: Record<string, unknown>
): void {
  storage.store.set("activityLog", value);
}

describe("ActivityLogService storage and counting", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("count", () => {
    beforeEach(() => {
      seed(storage, {
        __version: "activityLog.v1",
        maxEntries: 50,
        entries: [
          entry(1, { origin: "https://a.example", kind: 1 }),
          entry(2, { origin: "https://b.example", kind: 1 }),
          entry(3, { origin: "https://a.example", kind: 7 }),
          entry(4, {
            origin: "https://a.example",
            kind: undefined,
            operation: "identity_disclosure",
          }),
        ],
      });
    });

    it("counts every entry when no filter is given", async () => {
      const service = new ActivityLogService(storage);
      expect(await service.count()).toBe(4);
    });

    it("counts every entry for an empty filter object", async () => {
      const service = new ActivityLogService(storage);
      expect(await service.count({})).toBe(4);
    });

    it("counts only entries from the requested origin", async () => {
      const service = new ActivityLogService(storage);
      expect(await service.count({ origin: "https://a.example" })).toBe(3);
    });

    it("counts only entries of the requested kind, excluding kindless disclosures", async () => {
      const service = new ActivityLogService(storage);
      expect(await service.count({ kind: 1 })).toBe(2);
    });

    it("applies origin and kind together", async () => {
      const service = new ActivityLogService(storage);
      expect(await service.count({ origin: "https://a.example", kind: 7 })).toBe(
        1
      );
      expect(await service.count({ origin: "https://b.example", kind: 7 })).toBe(
        0
      );
    });
  });

  it("lists each origin once, sorted", async () => {
    seed(storage, {
      __version: "activityLog.v1",
      maxEntries: 50,
      entries: [
        entry(1, { origin: "https://z.example" }),
        entry(2, { origin: "https://a.example" }),
        entry(3, { origin: "https://z.example" }),
        entry(4, { origin: "https://m.example" }),
      ],
    });
    const service = new ActivityLogService(storage);

    expect(await service.getUniqueOrigins()).toEqual([
      "https://a.example",
      "https://m.example",
      "https://z.example",
    ]);
  });

  describe("setMaxEntries", () => {
    it("truncates to the newest entries and persists the new bound", async () => {
      const service = new ActivityLogService(storage, 50);
      for (let i = 1; i <= 5; i++) {
        await service.addEntry({ origin: `https://o${i}.example`, kind: 1, decision: "allow" });
      }

      await service.setMaxEntries(2);

      const origins = (await service.getRecent(10)).map((e) => e.origin);
      expect(origins).toEqual(["https://o5.example", "https://o4.example"]);
      expect(storage.stored()?.maxEntries).toBe(2);
      expect(storage.stored()?.entries.map((e) => e.origin)).toEqual(origins);
    });

    it("persists the bound even when nothing is truncated", async () => {
      const service = new ActivityLogService(storage, 50);
      await service.addEntry({ origin: "https://a.example", kind: 1, decision: "allow" });

      await service.setMaxEntries(200);

      expect(await service.count()).toBe(1);
      expect(storage.stored()?.maxEntries).toBe(200);
    });

    it.each([
      [0, 1],
      [-5, 1],
      [10_000, 500],
    ])("clamps a requested bound of %i to %i", async (requested, expected) => {
      const service = new ActivityLogService(storage);

      await service.setMaxEntries(requested);

      expect(storage.stored()?.maxEntries).toBe(expected);
    });
  });

  describe("loading from storage", () => {
    it("ignores a record with an unknown version", async () => {
      seed(storage, {
        __version: "activityLog.v0",
        maxEntries: 50,
        entries: [entry(1)],
      });
      const service = new ActivityLogService(storage);

      expect(await service.count()).toBe(0);
    });

    it("treats a record without an entries array as empty", async () => {
      seed(storage, { __version: "activityLog.v1", maxEntries: 50 });
      const service = new ActivityLogService(storage);

      expect(await service.getRecent()).toEqual([]);
    });

    it("falls back to the default bound of 50 when none is stored", async () => {
      seed(storage, {
        __version: "activityLog.v1",
        entries: Array.from({ length: 60 }, (_, i) => entry(i)),
      });
      const service = new ActivityLogService(storage);

      expect(await service.count()).toBe(50);
    });

    it("raises a stored bound below 10 to 10 and truncates to it", async () => {
      seed(storage, {
        __version: "activityLog.v1",
        maxEntries: 3,
        entries: Array.from({ length: 15 }, (_, i) => entry(i)),
      });
      const service = new ActivityLogService(storage);

      const recent = await service.getRecent(100);
      expect(recent).toHaveLength(10);
      expect(recent[0].id).toBe("id-0");
      expect(recent[9].id).toBe("id-9");
    });

    it("lowers a stored bound above 500 to 500", async () => {
      seed(storage, {
        __version: "activityLog.v1",
        maxEntries: 10_000,
        entries: Array.from({ length: 510 }, (_, i) => entry(i)),
      });
      const service = new ActivityLogService(storage);

      expect(await service.count()).toBe(500);
    });

    it("starts empty and stays usable when storage cannot be read", async () => {
      storage.failGet = true;
      const service = new ActivityLogService(storage);

      expect(await service.getRecent()).toEqual([]);

      await service.addEntry({ origin: "https://a.example", kind: 1, decision: "deny" });
      expect(await service.count()).toBe(1);
      expect(storage.stored()?.entries).toHaveLength(1);
    });
  });

  it("keeps the entry in memory when persisting it fails", async () => {
    const service = new ActivityLogService(storage);
    storage.failSet = true;

    await expect(
      service.addEntry({ origin: "https://a.example", kind: 1, decision: "allow" })
    ).resolves.toBeUndefined();

    expect(await service.count()).toBe(1);
    expect(storage.stored()).toBeUndefined();
  });

  it("clamps the constructor bound to at least one entry", async () => {
    const service = new ActivityLogService(storage, 0);

    await service.addEntry({ origin: "https://a.example", kind: 1, decision: "allow" });
    await service.addEntry({ origin: "https://b.example", kind: 1, decision: "allow" });

    const recent = await service.getRecent();
    expect(recent.map((e) => e.origin)).toEqual(["https://b.example"]);
  });

  it("clamps getRecent paging to at least one row and a non-negative offset", async () => {
    const service = new ActivityLogService(storage);
    await service.addEntry({ origin: "https://a.example", kind: 1, decision: "allow" });
    await service.addEntry({ origin: "https://b.example", kind: 1, decision: "allow" });

    const recent = await service.getRecent(0, -3);
    expect(recent.map((e) => e.origin)).toEqual(["https://b.example"]);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

type AreaName = "local" | "sync" | "session";

class FakeStorageArea {
  readonly data = new Map<string, unknown>();

  async get(keys: string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (this.data.has(key)) {
        result[key] = structuredClone(this.data.get(key));
      }
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.data.set(key, structuredClone(value));
    }
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.data.delete(key);
    }
  }
}

const areas = vi.hoisted(() => ({}) as Record<AreaName, FakeStorageArea>);

vi.mock("webextension-polyfill", () => ({
  default: { storage: areas },
}));

const { createStorageSuite } = await import(
  "@/infrastructure/storage/adapters"
);

describe("createStorageSuite", () => {
  beforeEach(() => {
    areas.local = new FakeStorageArea();
    areas.sync = new FakeStorageArea();
    areas.session = new FakeStorageArea();
  });

  it("writes a value under its key and reads the same value back", async () => {
    const suite = createStorageSuite();
    const record = { id: "k1", tags: ["a", "b"], nested: { n: 3 } };

    await suite.local.set("record", record);

    expect(areas.local.data.get("record")).toEqual(record);
    expect(await suite.local.get("record")).toEqual(record);
  });

  it("returns undefined for a key that was never stored", async () => {
    const suite = createStorageSuite();

    expect(await suite.sync.get("missing")).toBeUndefined();
  });

  it("removes only the named key", async () => {
    const suite = createStorageSuite();
    await suite.session.set("keep", 1);
    await suite.session.set("drop", 2);

    await suite.session.remove("drop");

    expect(await suite.session.get("drop")).toBeUndefined();
    expect(await suite.session.get("keep")).toBe(1);
    expect([...areas.session.data.keys()]).toEqual(["keep"]);
  });

  it("binds each port to its own browser storage area", async () => {
    const suite = createStorageSuite();

    await suite.local.set("key", "local-value");
    await suite.sync.set("key", "sync-value");
    await suite.session.set("key", "session-value");

    expect(areas.local.data.get("key")).toBe("local-value");
    expect(areas.sync.data.get("key")).toBe("sync-value");
    expect(areas.session.data.get("key")).toBe("session-value");
    expect(await suite.sync.get("key")).toBe("sync-value");
  });

  it("propagates a storage failure instead of reporting success", async () => {
    const suite = createStorageSuite();
    areas.local.set = async () => {
      throw new Error("QUOTA_BYTES quota exceeded");
    };

    await expect(suite.local.set("big", "x")).rejects.toThrow(
      "QUOTA_BYTES quota exceeded"
    );
  });
});

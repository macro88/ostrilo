import { describe, expect, it } from "vitest";
import type { StoragePort, StorageSuite } from "@/application/ports/storage";
import {
  SETTINGS_STORAGE_KEY,
  SettingsStore,
  localSettingsChange,
} from "@/application/services/settings-store";

/** An in-memory area that records every write and removal it receives. */
function recordingArea() {
  const data = new Map<string, unknown>();
  const writes: string[] = [];
  const port: StoragePort = {
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      writes.push(`set:${key}`);
      data.set(key, value);
    },
    async remove(key: string) {
      writes.push(`remove:${key}`);
      data.delete(key);
    },
  };
  return { port, data, writes };
}

function suite() {
  const local = recordingArea();
  const sync = recordingArea();
  const session = recordingArea();
  const storage: StorageSuite = { local: local.port, sync: sync.port, session: session.port };
  return { storage, local, sync, store: new SettingsStore(storage) };
}

const SYNCED = { __version: "settings.v1", origins: [{ origin: "https://a.example", trustLevel: "high" }] };
const LOCAL = { __version: "settings.v1", origins: [] };

describe("SettingsStore.read", () => {
  it("returns local settings and ignores the synced item", async () => {
    const { store, local, sync } = suite();
    local.data.set(SETTINGS_STORAGE_KEY, LOCAL);
    sync.data.set(SETTINGS_STORAGE_KEY, SYNCED);

    expect(await store.read()).toEqual(LOCAL);
    expect(local.writes).toEqual([]);
  });

  it("copies a pre-upgrade synced item into local as-is, and leaves sync in place", async () => {
    const { store, local, sync } = suite();
    sync.data.set(SETTINGS_STORAGE_KEY, SYNCED);

    expect(await store.read()).toEqual(SYNCED);
    expect(local.data.get(SETTINGS_STORAGE_KEY)).toEqual(SYNCED);
    expect(sync.data.get(SETTINGS_STORAGE_KEY)).toEqual(SYNCED);
    expect(sync.writes, "a read must never delete the synced copy").toEqual([]);
  });

  it("returns undefined on a fresh install and writes nothing", async () => {
    const { store, local, sync } = suite();
    expect(await store.read()).toBeUndefined();
    expect([...local.writes, ...sync.writes]).toEqual([]);
  });

  it("converges when two first reads race", async () => {
    const { storage, store, local, sync } = suite();
    sync.data.set(SETTINGS_STORAGE_KEY, SYNCED);

    const [a, b] = await Promise.all([store.read(), new SettingsStore(storage).read()]);

    expect(a).toEqual(SYNCED);
    expect(b).toEqual(SYNCED);
    expect(local.data.get(SETTINGS_STORAGE_KEY)).toEqual(SYNCED);
  });
});

describe("SettingsStore.write", () => {
  it("writes local storage and never synced storage", async () => {
    const { store, local, sync } = suite();
    await store.write(LOCAL);
    expect(local.data.get(SETTINGS_STORAGE_KEY)).toEqual(LOCAL);
    expect(sync.writes).toEqual([]);
  });
});

describe("SettingsStore.migrate", () => {
  it("moves a synced item to local, then removes the synced copy", async () => {
    const { store, local, sync } = suite();
    sync.data.set(SETTINGS_STORAGE_KEY, SYNCED);

    await store.migrate();

    expect(local.data.get(SETTINGS_STORAGE_KEY)).toEqual(SYNCED);
    expect(sync.data.has(SETTINGS_STORAGE_KEY)).toBe(false);
    expect(local.writes.indexOf(`set:${SETTINGS_STORAGE_KEY}`)).toBe(0);
  });

  it("does not delete the synced copy when the local copy did not persist", async () => {
    const { storage, sync } = suite();
    sync.data.set(SETTINGS_STORAGE_KEY, SYNCED);
    // A local area that accepts the write and keeps nothing.
    storage.local.set = async () => undefined;

    await new SettingsStore(storage).migrate();

    expect(
      sync.data.get(SETTINGS_STORAGE_KEY),
      "deleting before the copy reads back could lose every grant"
    ).toEqual(SYNCED);
  });

  it("sweeps a copy an older version wrote after migration, leaving local alone", async () => {
    const { store, local, sync } = suite();
    local.data.set(SETTINGS_STORAGE_KEY, LOCAL);
    sync.data.set(SETTINGS_STORAGE_KEY, SYNCED);

    await store.migrate();

    expect(sync.data.has(SETTINGS_STORAGE_KEY)).toBe(false);
    expect(local.data.get(SETTINGS_STORAGE_KEY)).toEqual(LOCAL);
    expect(local.writes).toEqual([]);
  });

  it("is a no-op on a fresh install and once already migrated", async () => {
    const fresh = suite();
    await fresh.store.migrate();
    expect([...fresh.local.writes, ...fresh.sync.writes]).toEqual([]);

    const done = suite();
    done.local.data.set(SETTINGS_STORAGE_KEY, LOCAL);
    await done.store.migrate();
    expect([...done.local.writes, ...done.sync.writes]).toEqual([]);
  });
});

describe("localSettingsChange", () => {
  it("returns the new value for a local-area settings change", () => {
    expect(
      localSettingsChange({ [SETTINGS_STORAGE_KEY]: { newValue: LOCAL } }, "local")
    ).toEqual(LOCAL);
  });

  it("ignores a synced-area settings change, which another device may have written", () => {
    expect(
      localSettingsChange({ [SETTINGS_STORAGE_KEY]: { newValue: SYNCED } }, "sync")
    ).toBeUndefined();
  });

  it("ignores changes to other keys and removals", () => {
    expect(localSettingsChange({ isDocked: { newValue: true } }, "local")).toBeUndefined();
    expect(localSettingsChange({ [SETTINGS_STORAGE_KEY]: {} }, "local")).toBeUndefined();
  });
});

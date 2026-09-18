import browser from "webextension-polyfill";
import { StoragePort, StorageSuite } from "@/application/ports/storage";

/** The three areas this extension uses, indexed by name. */
type StorageAreaName = "local" | "sync" | "session";

function createArea(area: StorageAreaName): StoragePort {
  const api = browser.storage[area];
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const res: Record<string, unknown> = await api.get([key]);
      return res[key] as T | undefined;
    },
    async set<T = unknown>(key: string, value: T): Promise<void> {
      const payload: Record<string, unknown> = { [key]: value };
      await api.set(payload);
    },
    async remove(key: string): Promise<void> {
      await api.remove([key]);
    },
  };
}

export function createStorageSuite(): StorageSuite {
  return {
    local: createArea("local"),
    sync: createArea("sync"),
    session: createArea("session"),
  };
}

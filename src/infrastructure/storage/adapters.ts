import browser from "webextension-polyfill";
import { StoragePort, StorageSuite } from "@/application/ports/storage";

function createArea(area: "local" | "sync" | "session"): StoragePort {
  const api = (browser.storage as any)[area] as browser.Storage.StorageArea;
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const res = await api.get([key]);
      return (res as any)[key] as T | undefined;
    },
    async set<T = unknown>(key: string, value: T): Promise<void> {
      await api.set({ [key]: value } as any);
    },
    async remove(key: string): Promise<void> {
      await api.remove([key] as any);
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

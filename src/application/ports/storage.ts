export interface StoragePort {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface StorageSuite {
  local: StoragePort;
  sync: StoragePort;
  session: StoragePort;
}


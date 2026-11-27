import type { StoragePort } from "@/application/ports/storage";
import { RELAY_BOUNDS, type RelayListEntry } from "@/domain/relay";
import { SerialLock } from "@/domain/utils/serial-lock";

export interface RelayListRecord {
  eventId: string;
  createdAt: number;
  entries: RelayListEntry[];
  droppedCount: number;
}
interface CacheEntry extends RelayListRecord {
  fetchedAt: number;
}
const CACHE_KEY = "relayListCache";

export class RelayListCache {
  private lock = new SerialLock();
  constructor(private session: StoragePort) {}

  async get(pubkey: string) {
    const records =
      await this.session.get<Record<string, CacheEntry>>(CACHE_KEY);
    const record = records?.[pubkey];
    if (
      record &&
      Date.now() - record.fetchedAt <
        RELAY_BOUNDS.RELAY_LIST_CACHE_TTL_SECONDS * 1000
    )
      return record;
  }

  async update(pubkey: string, record?: RelayListRecord) {
    try {
      await this.lock.run(async () => {
        const items =
          (await this.session.get<Record<string, CacheEntry>>(CACHE_KEY)) ?? {};
        delete items[pubkey];
        if (record) items[pubkey] = { ...record, fetchedAt: Date.now() };
        const oldest = Object.keys(items).sort(
          (a, b) => items[a].fetchedAt - items[b].fetchedAt,
        );
        while (
          oldest.length > RELAY_BOUNDS.MAX_CACHE_ENTRIES ||
          new TextEncoder().encode(JSON.stringify(items)).length >
            RELAY_BOUNDS.MAX_CACHE_BYTES
        ) {
          delete items[oldest.shift()!];
        }
        await this.session.set(CACHE_KEY, items);
      });
    } catch (error) {
      console.warn(
        "Could not update the session relay list cache",
        error instanceof Error ? error.name : "unknown error",
      );
    }
  }
}

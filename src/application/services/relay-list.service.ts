import type {
  IRelayRouter,
  NostrEvent,
  RelayPublishResult,
} from "@/application/ports/relay";
import type { StoragePort } from "@/application/ports/storage";
import {
  RELAY_LIST_KIND,
  RELAY_BOUNDS,
  normalizedRelayUrl,
  isRoutableRelayHost,
  parseRelayList,
  relayListTags,
  selectPublishRelays,
  type RelayPermissions,
} from "@/domain/relay";
import { SerialLock } from "@/domain/utils/serial-lock";
import type { ActivityLogService } from "./activity-log.service";
import type { KeyVaultService } from "./key-vault.service";
import { RelayListCache, type RelayListRecord } from "./relay-list-cache";
import { lookupOn, newest, type RelayLookup } from "./relay-list-lookup";

export type RelayPublish =
  | { status: "changed"; current: RelayLookup }
  | { status: "blocked"; reason: "unreachable" | "unreadable" }
  | { status: "published" | "failed"; results: RelayPublishResult[] };

export class RelayListService {
  private cache: RelayListCache;
  private writes = new SerialLock();
  private lookups = new Map<string, Promise<RelayLookup>>();
  constructor(
    private router: IRelayRouter,
    session: StoragePort,
    private vault: KeyVaultService,
    private activity: ActivityLogService,
  ) {
    this.cache = new RelayListCache(session);
  }

  invalidate(pubkey: string) {
    this.lookups.delete(pubkey);
    return this.cache.update(pubkey);
  }

  async lookupUrls(pubkey: string) {
    const cached = await this.cache.get(pubkey);
    const urls = new Set(this.router.getRelayUrls().map(normalizedRelayUrl));
    for (const entry of cached?.entries ?? []) {
      if (entry.write && isRoutableRelayHost(entry.url)) urls.add(entry.url);
    }
    return [...urls];
  }

  async lookup(pubkey: string, fresh = false): Promise<RelayLookup> {
    const pending = this.lookups.get(pubkey);
    if (pending && !fresh) return pending;
    const query = this.fetchList(pubkey);
    this.lookups.set(pubkey, query);
    try {
      const result = await query;
      if (result.status === "found" && this.lookups.get(pubkey) === query) {
        await this.cache.update(pubkey, result.list);
      }
      return result;
    } finally {
      if (this.lookups.get(pubkey) === query) this.lookups.delete(pubkey);
    }
  }

  private async fetchList(pubkey: string): Promise<RelayLookup> {
    const urls = await this.lookupUrls(pubkey);
    const responses: RelayLookup[] = [];
    for (
      let offset = 0;
      offset < urls.length;
      offset += RELAY_BOUNDS.MAX_TRANSIENT_RELAYS
    ) {
      const group = urls.slice(
        offset,
        offset + RELAY_BOUNDS.MAX_TRANSIENT_RELAYS,
      );
      responses.push(
        ...(await Promise.all(
          group.map((url) => lookupOn(this.router, url, pubkey)),
        )),
      );
    }
    if (responses.some((r) => r.status === "unreadable"))
      return { status: "unreadable" };
    const lists = responses.flatMap((r) =>
      r.status === "found" ? [r.list] : [],
    );
    if (lists.length) {
      const list = lists.reduce(newest);
      return { status: "found", list };
    }
    return {
      status:
        urls.length && responses.every((r) => r.status === "none")
          ? "none"
          : "unreachable",
    };
  }

  async profileTargets(pubkey: string) {
    const lookup = await this.lookup(pubkey);
    return selectPublishRelays(
      lookup.status === "found" ? lookup.list.entries : [],
      [],
      this.router.getRelayUrls(),
    );
  }

  starterEntries() {
    return this.router
      .getRelayUrls()
      .map((url) => ({ url, read: true, write: true }));
  }

  async publish(
    keyId: string,
    pubkey: string,
    entries: readonly RelayPermissions[],
    baseId: string | null,
  ): Promise<RelayPublish> {
    return this.writes.run(async () => {
      const current = await this.lookup(pubkey, true);
      if (current.status === "unreadable" || current.status === "unreachable")
        return { status: "blocked", reason: current.status };
      const base = current.status === "found" ? current.list : undefined;
      if ((base?.eventId ?? null) !== baseId)
        return { status: "changed", current };
      const tags = relayListTags(entries);
      const parsed = parseRelayList({ tags });
      if (
        !parsed ||
        parsed.droppedCount ||
        !parsed.entries.some((e) => e.write)
      )
        throw new Error("Invalid relay list");
      const event = await this.vault.signEvent(
        {
          pubkey,
          tags: relayListTags(parsed.entries),
          kind: RELAY_LIST_KIND,
          content: "",
          created_at: Math.max(
            Math.floor(Date.now() / 1000),
            (base?.createdAt ?? 0) + 1,
          ),
        },
        keyId,
      );
      return this.broadcast(keyId, event, base);
    });
  }

  async publishGenerated(keyId: string, event: NostrEvent) {
    try {
      const result = await this.broadcast(
        keyId,
        event,
        undefined,
        event.tags.map((tag) => tag[1]),
      );
      if (result.status === "failed")
        console.warn("No relay accepted the starter list");
    } catch (error) {
      console.warn(
        "Could not publish the starter relay list",
        error instanceof Error ? error.name : "unknown error",
      );
    }
  }

  private async broadcast(
    keyId: string,
    event: NostrEvent,
    base?: RelayListRecord,
    destinations?: string[],
  ): Promise<RelayPublish> {
    const parsed = parseRelayList(event);
    if (!parsed) throw new Error("Invalid relay list");
    const urls =
      destinations ??
      selectPublishRelays(
        parsed.entries,
        base?.entries ?? [],
        this.router.getRelayUrls(),
      );
    const results = await this.router.publishTo(urls, event);
    if (!results.some((r) => r.accepted)) return { status: "failed", results };
    this.lookups.delete(event.pubkey);
    await this.cache.update(event.pubkey, {
      ...parsed,
      eventId: event.id,
      createdAt: event.created_at,
    });
    await this.activity.addEntry({
      origin: "extension://relays",
      kind: RELAY_LIST_KIND,
      decision: "allow",
      keyId,
      contentPreview: "",
    });
    return { status: "published", results };
  }
}

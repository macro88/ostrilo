import type { IRelayRouter, NostrEvent } from "@/application/ports/relay";
import { RELAY_BOUNDS, RELAY_LIST_KIND, parseRelayList } from "@/domain/relay";
import type { RelayListRecord } from "./relay-list-cache";

export type RelayLookup =
  | { status: "found"; list: RelayListRecord }
  | { status: "none" | "unreachable" | "unreadable" };

export function newest(a: RelayListRecord, b: RelayListRecord) {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? a : b;
  return a.eventId < b.eventId ? a : b;
}

export function lookupOn(
  router: IRelayRouter,
  url: string,
  pubkey: string,
): Promise<RelayLookup> {
  return new Promise((resolve) => {
    let settled = false;
    let id: string | undefined;
    let latest: RelayListRecord | undefined;
    let unreadable = false;
    const finish = (complete: boolean, discarded = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (id) void router.close(id);
      if (unreadable || discarded) resolve({ status: "unreadable" });
      else if (latest) resolve({ status: "found", list: latest });
      else resolve({ status: complete ? "none" : "unreachable" });
    };
    const timer = setTimeout(
      () => finish(false),
      RELAY_BOUNDS.FETCH_DEADLINE_MS,
    );
    const accept = (event: NostrEvent) => {
      if (settled) return;
      const parsed =
        event.pubkey === pubkey &&
        event.kind === RELAY_LIST_KIND &&
        parseRelayList(event);
      if (!parsed) {
        unreadable = true;
        return;
      }
      const list = {
        ...parsed,
        eventId: event.id,
        createdAt: event.created_at,
      };
      latest = latest ? newest(latest, list) : list;
    };
    router
      .subscribeOn(
        url,
        { kinds: [RELAY_LIST_KIND], authors: [pubkey] },
        accept,
        (summary) => finish(summary?.complete ?? true, summary?.discarded),
        () => finish(false, 1),
      )
      .then(
        (token) => {
          if (settled) void router.close(token);
          else id = token;
        },
        () => finish(false),
      );
  });
}

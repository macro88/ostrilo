import { useEffect, useState } from "react";
import { activityGetOrigins } from "@/infrastructure/messaging/client";

/**
 * Every origin in the stored activity log, for the site filter.
 *
 * Read from the background rather than derived from the entries on screen: the
 * list loads a page at a time, so a site whose entries are further down would
 * not be offered. `listSettled` is true while the list is not loading, so the
 * read repeats after each load: a request answered meanwhile can introduce a
 * new origin.
 */
export function useActivityOrigins(listSettled: boolean): string[] {
  const [origins, setOrigins] = useState<string[]>([]);

  useEffect(() => {
    if (!listSettled) return;
    let cancelled = false;
    activityGetOrigins()
      .then((list) => {
        if (!cancelled) setOrigins(list);
      })
      .catch((err: unknown) => {
        console.error("[useActivityOrigins] Fetch error:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [listSettled]);

  return origins;
}

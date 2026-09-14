import { useCallback, useEffect, useState } from "react";
import { Eye } from "lucide-react";
import type { ActivityLogEntry } from "@/domain/types";
import { activityGetRecent } from "@/infrastructure/messaging/client";
import { formatOrigin } from "@/domain/display/origin";

/**
 * Which origins have read the user's public key, and how often.
 *
 * This is deliberately NOT a column on `OriginPolicyTable`. That table is
 * driven by `settings.origins`, which only holds origins that have a stored
 * policy record - and a policy record is only written when a signing decision
 * is made. An analytics or session-replay script that never calls `signEvent`
 * therefore never appears there, and it is exactly the category this surface
 * exists to reveal. It has to be its own list, sourced from the activity log.
 *
 * The counts are bounded by the activity log's own capacity (500 entries), so
 * an origin that read the key long enough ago to have rotated out of the log
 * will show a lower count than it earned. The list says so rather than
 * implying the numbers are lifetime totals.
 */

interface OriginReads {
  origin: string;
  allowed: number;
  refused: number;
  lastAt: number;
}

function summarise(entries: ActivityLogEntry[]): OriginReads[] {
  const byOrigin = new Map<string, OriginReads>();

  for (const entry of entries) {
    if (entry.operation !== "identity_disclosure") continue;

    const existing = byOrigin.get(entry.origin) ?? {
      origin: entry.origin,
      allowed: 0,
      refused: 0,
      lastAt: 0,
    };
    if (entry.decision === "allow") existing.allowed += 1;
    else existing.refused += 1;
    existing.lastAt = Math.max(existing.lastAt, entry.timestamp);
    byOrigin.set(entry.origin, existing);
  }

  return [...byOrigin.values()].sort((a, b) => b.lastAt - a.lastAt);
}

export function DisclosureHistory() {
  const [reads, setReads] = useState<OriginReads[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      // The whole log. It is capped at 500 entries by the service, and the
      // aggregation is over a handful of fields.
      const { entries } = await activityGetRecent({ limit: 500 });
      setReads(summarise(entries));
    } catch {
      // A locked or unreachable background has no history to show. An empty
      // list is the honest render; it must not claim nobody has read the key.
      setReads(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground h-8 w-8">
          <Eye className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-medium">Sites that read your public key</h3>
          <p className="text-xs text-muted-foreground">
            Your public key is not a secret — it is published on relays. This
            list is about linkage: which sites have tied your browsing to that
            identity.
          </p>
        </div>
      </div>

      {reads === null && (
        <p className="text-sm text-muted-foreground">
          History is unavailable while the vault is locked.
        </p>
      )}

      {reads !== null && reads.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No site has read your public key yet.
        </p>
      )}

      {reads !== null && reads.length > 0 && (
        <>
          <div className="space-y-2">
            {reads.map((row) => (
              <div
                key={row.origin}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border bg-muted/35 p-3"
                data-testid={`disclosure-origin-${row.origin}`}
              >
                <span className="font-mono text-xs">
                  {formatOrigin(row.origin).display}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.allowed} read{row.allowed === 1 ? "" : "s"}
                  {row.refused > 0 && `, ${row.refused} refused`}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Counts come from the activity log, which keeps the most recent 500
            entries. Older reads are not included.
          </p>
        </>
      )}
    </div>
  );
}

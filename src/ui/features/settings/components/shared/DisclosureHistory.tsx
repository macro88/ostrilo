import { useCallback, useEffect, useState } from "react";
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

/** `ActivityGetRecentRequestSchema` caps `limit` at 100 per call. */
const PAGE_SIZE = 100;
/** The service keeps at most this many entries; it bounds the paging below. */
const LOG_CAPACITY = 500;

/**
 * Reads the whole log a page at a time.
 *
 * This used to ask for all 500 entries in one call. The request schema
 * rejects any limit above 100, so the read failed as INVALID_PARAMS every
 * time; the failure fell into the same branch as a locked vault, and an
 * unlocked user was told history was "unavailable while the vault is locked".
 */
async function readWholeLog(): Promise<ActivityLogEntry[]> {
  const all: ActivityLogEntry[] = [];
  let offset = 0;
  while (offset < LOG_CAPACITY) {
    const { entries, total } = await activityGetRecent({
      limit: PAGE_SIZE,
      offset,
    });
    all.push(...entries);
    offset += entries.length;
    if (entries.length < PAGE_SIZE || offset >= total) break;
  }
  return all;
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

/**
 * A locked vault is the one failure this surface can name. Anything else is
 * reported as a failure to load, never as "nobody has read your key".
 */
function isLockedError(error: unknown): boolean {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  if (code === "locked") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /locked/i.test(message);
}

type HistoryState =
  | { status: "loading" }
  | { status: "ready"; reads: OriginReads[] }
  | { status: "locked" }
  | { status: "failed" };

export function DisclosureHistory() {
  const [state, setState] = useState<HistoryState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const entries = await readWholeLog();
      setState({ status: "ready", reads: summarise(entries) });
    } catch (error) {
      setState({ status: isLockedError(error) ? "locked" : "failed" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const quiet = "ink-row text-[13px] text-muted-foreground";

  return (
    <div className="space-y-2">
      <div className="ink-card">
        {state.status === "loading" && (
          <p className={quiet}>Reading the activity log...</p>
        )}
        {state.status === "locked" && (
          <p className={quiet}>
            History is unavailable while the vault is locked.
          </p>
        )}
        {state.status === "failed" && (
          <p className={quiet}>
            History could not be loaded. Reopen this page to try again.
          </p>
        )}
        {state.status === "ready" && state.reads.length === 0 && (
          <p className={quiet}>No site has read your public key yet.</p>
        )}
        {state.status === "ready" &&
          state.reads.map((row) => (
            <div
              key={row.origin}
              className="ink-row"
              data-testid={`disclosure-origin-${row.origin}`}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                {formatOrigin(row.origin).display}
              </span>
              <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
                {row.allowed} read{row.allowed === 1 ? "" : "s"}
                {row.refused > 0 && `, ${row.refused} refused`}
              </span>
            </div>
          ))}
      </div>
      {state.status === "ready" && state.reads.length > 0 && (
        <p className="px-0.5 text-[13px] leading-snug text-muted-foreground">
          Counts come from the activity log, which keeps the most recent 500
          entries. Older reads are not included.
        </p>
      )}
    </div>
  );
}

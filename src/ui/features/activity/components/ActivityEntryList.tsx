import { Button } from "@/components/ui/button";
import { SealMark } from "@/components/common/SealMark";
import { formatOrigin } from "@/domain/display/origin";
import { describeActivityEntry, describeDenialReason } from "@/domain/types";
import { escapeInvisible } from "@/domain/display/safe-text";
import type { ActivityLogEntry } from "@/domain/types";
import { Activity, Check, Loader2, X } from "lucide-react";

interface ActivityEntryListProps {
  entries: ActivityLogEntry[];
  loading: boolean;
  failed: boolean;
  hasMore: boolean;
  hasFilters: boolean;
  onLoadMore: () => void;
  onClearFilters: () => void;
  onRetry: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

const SKELETON_ROWS = ["first", "second", "third"];

/** What the list says instead of rows: the log failed to load, or holds nothing to show. */
function ActivityListNotice({
  failed,
  hasFilters,
  onRetry,
  onClearFilters,
}: {
  failed: boolean;
  hasFilters: boolean;
  onRetry: () => void;
  onClearFilters: () => void;
}) {
  if (failed) {
    return (
      <div
        role="alert"
        className="flex shrink-0 flex-col items-center px-6 pb-6 pt-6 text-center"
      >
        <p className="text-base font-bold">Could not load activity</p>
        <p className="mt-1 max-w-[28ch] text-[13px] text-muted-foreground">
          The activity log could not be read.
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10 pt-6 text-center">
      <SealMark icon={Activity} tone="muted" size="lg" />
      <p className="mt-3 text-base font-bold">
        {hasFilters ? "No matching activity" : "No activity yet"}
      </p>
      <p className="mt-1 max-w-[28ch] text-[13px] text-muted-foreground">
        {hasFilters
          ? "Nothing in the log matches these filters."
          : "Sign events to see your activity history here"}
      </p>
      {hasFilters && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onClearFilters}>
          Show all activity
        </Button>
      )}
    </div>
  );
}

export function ActivityEntryList({
  entries,
  loading,
  failed,
  hasMore,
  hasFilters,
  onLoadMore,
  onClearFilters,
  onRetry,
}: ActivityEntryListProps) {
  const isEmpty = entries.length === 0;

  return (
    <>
      {loading && isEmpty && (
        <div
          className="ink-card shrink-0 overflow-hidden"
          aria-busy="true"
          aria-label="Loading activity"
        >
          {SKELETON_ROWS.map((placeholder) => (
            <div key={placeholder} className="ink-row" aria-hidden="true">
              <span className="seal h-7 w-7 shrink-0 bg-muted motion-safe:animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-2.5 w-1/3 rounded-sm bg-muted motion-safe:animate-pulse" />
                <div className="h-2 w-1/2 rounded-sm bg-muted motion-safe:animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (failed || isEmpty) && (
        <ActivityListNotice
          failed={failed}
          hasFilters={hasFilters}
          onRetry={onRetry}
          onClearFilters={onClearFilters}
        />
      )}

      {!isEmpty && (
        <div className="ink-card shrink-0 overflow-hidden">
          {entries.map((entry) => {
            const approved = entry.decision === "allow";
            const when = new Date(entry.timestamp * 1000);
            const reason = describeDenialReason(entry);

            // `relative` on the row: the visually hidden "Approved" below is
            // absolutely positioned, and with no positioned ancestor a row
            // past the fold would be laid out against the document and grow
            // the popup beyond its 600px viewport.
            return (
              <div key={entry.id} className="ink-row relative items-start">
                <SealMark
                  icon={approved ? Check : X}
                  tone={approved ? "success" : "danger"}
                  className="mt-px"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="min-w-0 truncate text-[13px] font-bold leading-tight">
                      {describeActivityEntry(entry)}
                    </h3>
                    {/*
                      A refusal is the row worth finding in an audit trail, so
                      it carries a visible chip. A signature reads as the mint
                      check; the word is there for screen readers.
                    */}
                    {approved ? (
                      <span className="sr-only">Approved</span>
                    ) : (
                      <span className="seal-chip seal-chip-danger shrink-0">
                        Denied
                      </span>
                    )}
                  </div>
                  {/*
                    Full origin, scheme included. The activity log is where a
                    user checks what happened, and "example.com" does not say
                    whether it was the real one.
                  */}
                  <p className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground">
                    {formatOrigin(entry.origin).display}
                  </p>
                  {reason && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {reason}
                    </p>
                  )}
                  {entry.contentPreview && (
                    // Content is whatever the site sent. Hidden and
                    // direction-control characters are shown as escapes, as in
                    // the approval prompt, so a row cannot read as something
                    // other than what was signed.
                    <p className="mt-1.5 line-clamp-2 break-words text-xs text-muted-foreground">
                      {escapeInvisible(entry.contentPreview).text}
                    </p>
                  )}
                </div>
                <time
                  className="shrink-0 pt-px font-mono text-[11px] text-muted-foreground"
                  dateTime={when.toISOString()}
                  title={when.toLocaleString()}
                >
                  {formatRelativeTime(entry.timestamp)}
                </time>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && !loading && (
        <Button
          onClick={onLoadMore}
          variant="outline"
          className="w-full shrink-0"
        >
          Load more
        </Button>
      )}

      {loading && !isEmpty && (
        <div className="flex shrink-0 items-center justify-center gap-2 py-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
          Loading more
        </div>
      )}
    </>
  );
}

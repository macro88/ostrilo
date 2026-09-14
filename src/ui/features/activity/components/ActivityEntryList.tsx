import { Button } from "@/components/ui/button";
import { formatOrigin } from "@/domain/display/origin";
import { describeActivityEntry } from "@/domain/types";
import type { ActivityLogEntry } from "@/domain/types";
import { Activity, CheckCircle, Loader2, XCircle } from "lucide-react";

interface ActivityEntryListProps {
  entries: ActivityLogEntry[];
  loading: boolean;
  hasMore: boolean;
  hasFilters: boolean;
  onLoadMore: () => void;
  onClearFilters: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

export function ActivityEntryList({
  entries,
  loading,
  hasMore,
  hasFilters,
  onLoadMore,
  onClearFilters,
}: ActivityEntryListProps) {
  return (
    <>
      {loading && entries.length === 0 && (
        <div className="space-y-3">
          {["first", "second", "third"].map((placeholder) => (
            <div key={placeholder} className="ink-card p-4 animate-pulse">
              <div className="h-4 bg-muted rounded w-1/3 mb-2" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div className="ink-card p-4 py-12 text-center">
          <div className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground mx-auto mb-4 h-12 w-12 opacity-80">
            <Activity className="h-5 w-5" />
          </div>
          <p className="text-muted-foreground font-medium mb-2">
            No activity yet
          </p>
          <p className="text-sm text-muted-foreground">
            Sign events to see your activity history here
          </p>
          {hasFilters && (
            <Button variant="link" onClick={onClearFilters} className="mt-2">
              Clear filters to see all activity
            </Button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="ink-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm mb-1 truncate">
                  {describeActivityEntry(entry)}
                </h3>

                <p className="text-xs text-muted-foreground truncate mb-1">
                  {formatOrigin(entry.origin).display}
                </p>

                {entry.contentPreview && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-2">
                    {entry.contentPreview}
                  </p>
                )}

                <p className="text-xs text-muted-foreground mt-2">
                  {formatRelativeTime(entry.timestamp)}
                </p>
              </div>

              <div className="flex-shrink-0">
                {entry.decision === "allow" ? (
                  <div className="seal-chip seal-chip-accent bg-[var(--ink-mint-soft)] text-[var(--ink-mint)]">
                    <CheckCircle className="h-3 w-3" />
                    Approved
                  </div>
                ) : (
                  <div className="seal-chip seal-chip-accent bg-[var(--ink-red-soft)] text-[var(--ink-red)]">
                    <XCircle className="h-3 w-3" />
                    Denied
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {hasMore && !loading && (
        <div className="text-center pt-4">
          <Button onClick={onLoadMore} variant="outline" className="w-full">
            Load More
          </Button>
        </div>
      )}

      {loading && entries.length > 0 && (
        <div className="text-center pt-4">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        </div>
      )}
    </>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActivityLog } from "../hooks/useActivityLog";
import { getKindName, COMMON_EVENT_KINDS } from "@/domain/types";
import { Loader2, CheckCircle, XCircle, Activity } from "lucide-react";

/**
 * Format Unix timestamp to relative time
 */
function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

export function ActivityView() {
  const [originFilter, setOriginFilter] = useState<string | undefined>(
    undefined
  );
  const [kindFilter, setKindFilter] = useState<number | undefined>(undefined);

  const { entries, loading, hasMore, loadMore, refresh } = useActivityLog({
    origin: originFilter,
    kind: kindFilter,
  });

  // Get unique origins for filter dropdown
  const uniqueOrigins = Array.from(
    new Set(entries.map((e) => e.origin))
  ).sort();

  const handleOriginChange = (value: string) => {
    if (value === "all") {
      setOriginFilter(undefined);
    } else {
      setOriginFilter(value);
    }
  };

  const handleKindChange = (value: string) => {
    if (value === "all") {
      setKindFilter(undefined);
    } else {
      setKindFilter(Number(value));
    }
  };

  const handleClearFilters = () => {
    setOriginFilter(undefined);
    setKindFilter(undefined);
  };

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      {/* Header */}
      <div className="text-center mb-4">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Recent Activity</h2>
        </div>
        <p className="text-muted-foreground text-xs">
          Your signing history and interactions
        </p>
      </div>

      {/* Filters */}
      {(entries.length > 0 || originFilter || kindFilter) && (
        <div className="flex gap-2 flex-col sm:flex-row">
          {/* Origin Filter */}
          <Select
            value={originFilter || "all"}
            onValueChange={handleOriginChange}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue placeholder="All Origins" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Origins</SelectItem>
              {uniqueOrigins.map((origin) => (
                <SelectItem key={origin} value={origin}>
                  {new URL(origin).hostname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Kind Filter */}
          <Select
            value={kindFilter?.toString() || "all"}
            onValueChange={handleKindChange}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue placeholder="All Kinds" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Kinds</SelectItem>
              {Object.entries(COMMON_EVENT_KINDS).map(([kind, name]) => (
                <SelectItem key={kind} value={kind}>
                  {name} ({kind})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Clear Filters */}
          {(originFilter || kindFilter) && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
              className="w-full h-8 text-xs"
            >
              Clear Filters
            </Button>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && entries.length === 0 && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="bg-card border border-border rounded-lg p-4 animate-pulse"
            >
              <div className="h-4 bg-muted rounded w-1/3 mb-2" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && entries.length === 0 && (
        <div className="text-center py-12">
          <Activity className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <p className="text-muted-foreground font-medium mb-2">
            No activity yet
          </p>
          <p className="text-sm text-muted-foreground">
            Sign events to see your activity history here
          </p>
          {(originFilter || kindFilter) && (
            <Button
              variant="link"
              onClick={handleClearFilters}
              className="mt-2"
            >
              Clear filters to see all activity
            </Button>
          )}
        </div>
      )}

      {/* Activity Entries */}
      <div className="space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="bg-card border border-border rounded-lg p-4 hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Event Kind Name */}
                <h3 className="font-medium text-sm mb-1 truncate">
                  {getKindName(entry.kind)}
                </h3>

                {/* Origin */}
                <p className="text-xs text-muted-foreground truncate mb-1">
                  {new URL(entry.origin).hostname}
                </p>

                {/* Content Preview */}
                {entry.contentPreview && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-2">
                    {entry.contentPreview}
                  </p>
                )}

                {/* Timestamp */}
                <p className="text-xs text-muted-foreground mt-2">
                  {formatRelativeTime(entry.timestamp)}
                </p>
              </div>

              {/* Decision Badge */}
              <div className="flex-shrink-0">
                {entry.decision === "allow" ? (
                  <div className="flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400 rounded-md text-xs font-medium">
                    <CheckCircle className="h-3 w-3" />
                    Approved
                  </div>
                ) : (
                  <div className="flex items-center gap-1 px-2 py-1 bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400 rounded-md text-xs font-medium">
                    <XCircle className="h-3 w-3" />
                    Denied
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Load More */}
      {hasMore && !loading && (
        <div className="text-center pt-4">
          <Button onClick={loadMore} variant="outline" className="w-full">
            Load More
          </Button>
        </div>
      )}

      {/* Loading More State */}
      {loading && entries.length > 0 && (
        <div className="text-center pt-4">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import type { ActivityLogEntry, ActivityFilters } from "@/domain/types";
import {
  activityGetRecent,
  activityFilterBy,
} from "@/infrastructure/messaging/client";

interface UseActivityLogOptions {
  origin?: string;
  kind?: number;
  autoLoad?: boolean;
}

interface UseActivityLogReturn {
  entries: ActivityLogEntry[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  total: number;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

const PAGE_SIZE = 10;

/**
 * Hook for fetching and managing activity log entries with filtering and pagination
 *
 * @param options - Filter options (origin, kind) and config
 * @returns Activity entries, loading state, pagination controls
 */
export function useActivityLog(
  options: UseActivityLogOptions = {}
): UseActivityLogReturn {
  const { origin, kind, autoLoad = true } = options;

  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<Error | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  /**
   * Fetch entries from RPC (initial load or filter change)
   */
  const fetchEntries = useCallback(
    async (currentOffset: number = 0, append: boolean = false) => {
      setLoading(true);
      setError(null);

      try {
        let result;

        // Use filterBy if origin or kind specified, otherwise getRecent
        if (origin !== undefined || kind !== undefined) {
          console.log("[useActivityLog] Fetching with filters:", {
            origin,
            kind,
            limit: PAGE_SIZE,
            offset: currentOffset,
          });
          result = await activityFilterBy({
            origin,
            kind,
            limit: PAGE_SIZE,
            offset: currentOffset,
          });
        } else {
          console.log("[useActivityLog] Fetching recent:", {
            limit: PAGE_SIZE,
            offset: currentOffset,
          });
          result = await activityGetRecent({
            limit: PAGE_SIZE,
            offset: currentOffset,
          });
        }

        console.log("[useActivityLog] Received result:", result);

        if (append) {
          setEntries((prev) => [...prev, ...result.entries]);
        } else {
          setEntries(result.entries);
        }

        setTotal(result.total);
        setOffset(currentOffset);
      } catch (err) {
        console.error("[useActivityLog] Fetch error:", err);
        setError(
          err instanceof Error ? err : new Error("Failed to fetch activity log")
        );
      } finally {
        setLoading(false);
      }
    },
    [origin, kind]
  );

  /**
   * Load more entries (pagination)
   */
  const loadMore = useCallback(async () => {
    const nextOffset = offset + PAGE_SIZE;
    await fetchEntries(nextOffset, true);
  }, [offset, fetchEntries]);

  /**
   * Refresh from beginning (clear and reload)
   */
  const refresh = useCallback(async () => {
    setOffset(0);
    await fetchEntries(0, false);
  }, [fetchEntries]);

  /**
   * Calculate if more entries are available
   */
  const hasMore = entries.length < total;

  /**
   * Auto-load on mount and when filters change
   */
  useEffect(() => {
    if (autoLoad) {
      setOffset(0);
      fetchEntries(0, false);
    }
  }, [origin, kind, autoLoad, fetchEntries]);

  return {
    entries,
    loading,
    error,
    hasMore,
    total,
    loadMore,
    refresh,
  };
}

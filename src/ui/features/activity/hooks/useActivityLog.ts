import { useReducer, useEffect, useCallback } from "react";
import type { ActivityLogEntry } from "@/domain/types";
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

interface ActivityLogPageParams {
  origin?: string;
  kind?: number;
  offset: number;
}

interface ActivityLogState {
  entries: ActivityLogEntry[];
  loading: boolean;
  error: Error | null;
  offset: number;
  total: number;
}

type ActivityLogAction =
  | { type: "request" }
  | {
      type: "success";
      entries: ActivityLogEntry[];
      total: number;
      offset: number;
      append: boolean;
    }
  | { type: "failure"; error: Error };

function createInitialState(autoLoad: boolean): ActivityLogState {
  return {
    entries: [],
    loading: autoLoad,
    error: null,
    offset: 0,
    total: 0,
  };
}

function activityLogReducer(
  state: ActivityLogState,
  action: ActivityLogAction
): ActivityLogState {
  switch (action.type) {
    case "request":
      return { ...state, loading: true, error: null };
    case "success":
      return {
        entries: action.append
          ? [...state.entries, ...action.entries]
          : action.entries,
        loading: false,
        error: null,
        offset: action.offset,
        total: action.total,
      };
    case "failure":
      return { ...state, loading: false, error: action.error };
  }
}

function toActivityLogError(err: unknown): Error {
  return err instanceof Error ? err : new Error("Failed to fetch activity log");
}

async function loadActivityLogPage({
  origin,
  kind,
  offset,
}: ActivityLogPageParams) {
  if (origin !== undefined || kind !== undefined) {
    return activityFilterBy({
      origin,
      kind,
      limit: PAGE_SIZE,
      offset,
    });
  }

  return activityGetRecent({
    limit: PAGE_SIZE,
    offset,
  });
}

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

  const [state, dispatch] = useReducer(
    activityLogReducer,
    autoLoad,
    createInitialState
  );

  /**
   * Load more entries (pagination)
   */
  const loadMore = useCallback(async () => {
    const nextOffset = state.offset + PAGE_SIZE;
    dispatch({ type: "request" });

    try {
      const result = await loadActivityLogPage({
        origin,
        kind,
        offset: nextOffset,
      });

      dispatch({
        type: "success",
        entries: result.entries,
        total: result.total,
        offset: nextOffset,
        append: true,
      });
    } catch (err) {
      console.error("[useActivityLog] Fetch error:", err);
      dispatch({ type: "failure", error: toActivityLogError(err) });
    }
  }, [state.offset, origin, kind]);
	
  /**
   * Refresh from beginning (clear and reload)
   */
  const refresh = useCallback(async () => {
    dispatch({ type: "request" });

    try {
      const result = await loadActivityLogPage({
        origin,
        kind,
        offset: 0,
      });

      dispatch({
        type: "success",
        entries: result.entries,
        total: result.total,
        offset: 0,
        append: false,
      });
    } catch (err) {
      console.error("[useActivityLog] Fetch error:", err);
      dispatch({ type: "failure", error: toActivityLogError(err) });
    }
  }, [origin, kind]);

  /**
   * Calculate if more entries are available
   */
  const hasMore = state.entries.length < state.total;

  /**
   * Auto-load on mount and when filters change
   */
  useEffect(() => {
    if (!autoLoad) {
      return;
    }

    let cancelled = false;
    dispatch({ type: "request" });

    loadActivityLogPage({ origin, kind, offset: 0 })
      .then((result) => {
        if (cancelled) {
          return;
        }

        dispatch({
          type: "success",
          entries: result.entries,
          total: result.total,
          offset: 0,
          append: false,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }

        console.error("[useActivityLog] Fetch error:", err);
        dispatch({ type: "failure", error: toActivityLogError(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [origin, kind, autoLoad]);

  return {
    entries: state.entries,
    loading: state.loading,
    error: state.error,
    hasMore,
    total: state.total,
    loadMore,
    refresh,
  };
}

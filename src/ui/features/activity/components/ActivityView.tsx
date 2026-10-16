import { useCallback, useEffect, useReducer } from "react";
import { useActivityLog } from "../hooks/useActivityLog";
import { useActivityOrigins } from "../hooks/useActivityOrigins";
import type { PendingRequest } from "@/domain/types";
import {
  getAllApprovalRequests,
  getApprovalCount,
} from "@/infrastructure/messaging/client";
import { browser } from "wxt/browser";
import { useAppSettings } from "@/ui/hooks/useAppSettings";
import { ActivityEntryList } from "./ActivityEntryList";
import { ActivityFilters } from "./ActivityFilters";
import { ActivityPendingApprovals } from "./ActivityPendingApprovals";
import {
  BROADCAST_EVENTS,
  OPEN_APPROVAL_WINDOW_COMMAND,
} from "@/infrastructure/messaging/events";

interface ActivityViewState {
  originFilter?: string;
  kindFilter?: number;
  pendingRequests: PendingRequest[];
  pendingCount: number;
  showPendingSection: boolean;
  showApprovalDialog: boolean;
}

type ActivityViewAction =
  | { type: "setOriginFilter"; origin?: string }
  | { type: "setKindFilter"; kind?: number }
  | { type: "clearFilters" }
  | { type: "setPending"; requests: PendingRequest[]; count: number }
  | { type: "togglePendingSection" }
  | { type: "showApprovalDialog" }
  | { type: "hideApprovalDialog" };

const initialActivityViewState: ActivityViewState = {
  pendingRequests: [],
  pendingCount: 0,
  showPendingSection: true,
  showApprovalDialog: false,
};

function activityViewReducer(
  state: ActivityViewState,
  action: ActivityViewAction
): ActivityViewState {
  switch (action.type) {
    case "setOriginFilter":
      return { ...state, originFilter: action.origin };
    case "setKindFilter":
      return { ...state, kindFilter: action.kind };
    case "clearFilters":
      return { ...state, originFilter: undefined, kindFilter: undefined };
    case "setPending":
      return {
        ...state,
        pendingRequests: action.requests,
        pendingCount: action.count,
      };
    case "togglePendingSection":
      return { ...state, showPendingSection: !state.showPendingSection };
    case "showApprovalDialog":
      return { ...state, showApprovalDialog: true };
    case "hideApprovalDialog":
      return { ...state, showApprovalDialog: false };
  }
}

export function ActivityView() {
  const [state, dispatch] = useReducer(
    activityViewReducer,
    initialActivityViewState
  );
  const { settings } = useAppSettings();

  const { entries, loading, error, hasMore, loadMore, refresh } = useActivityLog({
    origin: state.originFilter,
    kind: state.kindFilter,
  });

  // Fetch pending approvals
  const fetchPendingApprovals = useCallback(async () => {
    try {
      const [{ requests }, { count }] = await Promise.all([
        getAllApprovalRequests(),
        getApprovalCount(),
      ]);
      dispatch({ type: "setPending", requests, count });
    } catch (err) {
      console.error("[ActivityView] Failed to fetch pending approvals:", err);
    }
  }, []);

  // Initial fetch and listen for queue updates
  useEffect(() => {
    fetchPendingApprovals();

    const handleMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "__event" in message &&
        (message as { __event?: unknown }).__event ===
          BROADCAST_EVENTS.QUEUE_UPDATED
      ) {
        fetchPendingApprovals();
        // In sidepanel mode, auto-show the approval dialog when new request arrives
        if (settings?.sidePanel && !state.showApprovalDialog) {
          dispatch({ type: "showApprovalDialog" });
        }
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, [fetchPendingApprovals, settings?.sidePanel, state.showApprovalDialog]);

  // Open approval window or show inline dialog based on sidepanel mode
  const handleOpenApprovalWindow = async () => {
    // Check if in sidepanel mode
    if (settings?.sidePanel) {
      // Show approval dialog inline
      dispatch({ type: "showApprovalDialog" });
    } else {
      // Ask the background to open or focus the single managed approval window.
      try {
        const response = await browser.runtime.sendMessage({
          __command: OPEN_APPROVAL_WINDOW_COMMAND,
        });

        if (!response?.ok) {
          const errorMessage =
            typeof response?.error === "object" &&
            response.error !== null &&
            "message" in response.error
              ? String(response.error.message)
              : response?.error;

          throw new Error(
            errorMessage ?? "Failed to open approval window"
          );
        }
      } catch (err) {
        console.error("[ActivityView] Failed to open approval window:", err);
      }
    }
  };

  // The whole log's origins, not just those on the loaded page. Re-read when a
  // load finishes, so a site that has just been logged is offered.
  const uniqueOrigins = useActivityOrigins(!loading);

  const handleOriginChange = (value: string) => {
    if (value === "all") {
      dispatch({ type: "setOriginFilter", origin: undefined });
    } else {
      dispatch({ type: "setOriginFilter", origin: value });
    }
  };

  const handleKindChange = (value: string) => {
    if (value === "all") {
      dispatch({ type: "setKindFilter", kind: undefined });
    } else {
      dispatch({ type: "setKindFilter", kind: Number(value) });
    }
  };

  const handleClearFilters = () => {
    dispatch({ type: "clearFilters" });
  };

  // Kind 0 (profile metadata) is a real filter, so test for presence, not truthiness.
  const hasFilters =
    Boolean(state.originFilter) || state.kindFilter !== undefined;

  // A column that fills the tab, so the empty state can sit in the middle of
  // the space the list would occupy instead of hugging the title.
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 [overscroll-behavior:contain] [scrollbar-gutter:stable]">
        {/*
          Every block in this column is `shrink-0`: a flex item whose overflow
          is hidden has an automatic minimum height of zero, so without it the
          cards shrink to fit the viewport and clip their own rows instead of
          letting the column scroll.
        */}
        <div className="screen-header shrink-0">
          <h2 className="screen-title">Recent Activity</h2>
        </div>

        <ActivityPendingApprovals
          requests={state.pendingRequests}
          count={state.pendingCount}
          expanded={state.showPendingSection}
          sidePanel={Boolean(settings?.sidePanel)}
          showApprovalDialog={state.showApprovalDialog}
          onToggleExpanded={() => dispatch({ type: "togglePendingSection" })}
          onOpenApprovalWindow={handleOpenApprovalWindow}
          onCloseApprovalDialog={() => dispatch({ type: "hideApprovalDialog" })}
        />

        <ActivityFilters
          visible={entries.length > 0 || hasFilters}
          originFilter={state.originFilter}
          kindFilter={state.kindFilter}
          origins={uniqueOrigins}
          onOriginChange={handleOriginChange}
          onKindChange={handleKindChange}
          onClear={handleClearFilters}
        />

        <ActivityEntryList
          entries={entries}
          loading={loading}
          failed={error !== null}
          onRetry={refresh}
          hasMore={hasMore}
          hasFilters={hasFilters}
          onLoadMore={loadMore}
          onClearFilters={handleClearFilters}
        />
      </div>
    </div>
  );
}

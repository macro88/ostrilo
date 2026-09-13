import { useReducer, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  getAllApprovalRequests,
  resolveApprovalRequest,
  getApprovalCount,
  listKeys,
} from "@/infrastructure/messaging/client";
import type { PendingRequest, ApprovalAction, KeyRecord } from "@/domain/types";
import { AlertTriangle } from "lucide-react";
import { QueueListView } from "./QueueListView";
import { EventDetailView } from "./EventDetailView";
import { browser } from "wxt/browser";
import { Logo } from "@/ui/components/logo/Logo";
import { BROADCAST_EVENTS } from "@/infrastructure/messaging/events";

interface ApprovalPromptState {
  requests: PendingRequest[];
  selectedRequestId: string | null;
  isLoading: boolean;
  isResolving: boolean;
  error: string | null;
  nowSeconds: number;
  selectedKey: KeyRecord | null;
  showCompactDetail: boolean;
}

type ApprovalPromptAction =
  | { type: "loadStart" }
  | { type: "loadSuccess"; requests: PendingRequest[]; selectedKey: KeyRecord | null }
  | { type: "loadError"; error: string }
  | { type: "tick"; nowSeconds: number }
  | { type: "resolveStart" }
  | { type: "resolveEnd" }
  | { type: "selectRequest"; id: string }
  | { type: "showList" };

const initialApprovalPromptState: ApprovalPromptState = {
  requests: [],
  selectedRequestId: null,
  isLoading: true,
  isResolving: false,
  error: null,
  nowSeconds: Math.floor(Date.now() / 1000),
  selectedKey: null,
  showCompactDetail: false,
};

function approvalPromptReducer(
  state: ApprovalPromptState,
  action: ApprovalPromptAction
): ApprovalPromptState {
  switch (action.type) {
    case "loadStart":
      return { ...state, isLoading: true, error: null };
    case "loadSuccess": {
      const selectedStillPending =
        state.selectedRequestId &&
        action.requests.some((request) => request.id === state.selectedRequestId);

      return {
        ...state,
        requests: action.requests,
        selectedKey: action.selectedKey,
        // Deliberately NOT auto-selecting requests[0] when the previous
        // selection is gone. The detail pane used to instantly re-bind to
        // the next queued request, so the approve button the user had just
        // clicked reappeared under their cursor bound to a DIFFERENT event.
        // One more click and they have approved something they never read.
        // The user goes back to the list and chooses.
        selectedRequestId: selectedStillPending
          ? state.selectedRequestId
          : null,
        showCompactDetail: selectedStillPending ? state.showCompactDetail : false,
        isLoading: false,
        error: null,
      };
    }
    case "loadError":
      return { ...state, error: action.error, isLoading: false };
    case "tick":
      return { ...state, nowSeconds: action.nowSeconds };
    case "resolveStart":
      return { ...state, isResolving: true };
    case "resolveEnd":
      return { ...state, isResolving: false };
    case "selectRequest":
      return {
        ...state,
        selectedRequestId: action.id,
        showCompactDetail: true,
      };
    case "showList":
      return { ...state, showCompactDetail: false };
  }
}

/**
 * ApprovalPrompt component displays pending approval requests
 * in a queue list view, with detailed event information when selected
 */
export function ApprovalPrompt() {
  const [state, dispatch] = useReducer(
    approvalPromptReducer,
    initialApprovalPromptState
  );

  // Fetch all pending requests
  const fetchRequests = useCallback(async () => {
    try {
      dispatch({ type: "loadStart" });

      const [{ requests: allRequests }, keys] = await Promise.all([
        getAllApprovalRequests(),
        listKeys(),
      ]);

      // Find selected key
      const selected = keys?.find((k) => k.isSelected) ?? null;
      dispatch({
        type: "loadSuccess",
        requests: allRequests,
        selectedKey: selected,
      });
    } catch (err) {
      dispatch({
        type: "loadError",
        error: err instanceof Error ? err.message : "Failed to load requests",
      });
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    if (state.requests.length === 0) return;

    const timer = setInterval(() => {
      dispatch({
        type: "tick",
        nowSeconds: Math.floor(Date.now() / 1000),
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [state.requests.length]);

  // Listen for real-time queue updates
  useEffect(() => {
    const handleMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "__event" in message &&
        (message as { __event?: unknown }).__event ===
          BROADCAST_EVENTS.QUEUE_UPDATED
      ) {
        console.log("[ApprovalPrompt] Queue updated, refreshing...");
        fetchRequests();
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, [fetchRequests]);

  // Handle user action on selected request
  const handleAction = async (action: ApprovalAction) => {
    if (!state.selectedRequestId || state.isResolving) return;

    try {
      dispatch({ type: "resolveStart" });
      await resolveApprovalRequest(state.selectedRequestId, action);

      const [, { count }] = await Promise.all([
        fetchRequests(),
        getApprovalCount(),
      ]);
      if (count === 0) {
        // No more requests - close window
        window.close();
      } else {
        // Return to list view
        dispatch({ type: "showList" });
      }
    } catch (err) {
      dispatch({
        type: "loadError",
        error: err instanceof Error ? err.message : "Failed to process action",
      });
    } finally {
      dispatch({ type: "resolveEnd" });
    }
  };

  // Handle batch actions
  const handleBatchAction = async (
    action: "approve" | "deny",
    requestIds: string[]
  ) => {
    if (state.isResolving || requestIds.length === 0) return;

    try {
      dispatch({ type: "resolveStart" });
      const approvalAction = action === "approve" ? "allow_once" : "deny";

      // Resolve all requests in batch
      await Promise.all(
        requestIds.map((id) => resolveApprovalRequest(id, approvalAction))
      );

      const [, { count }] = await Promise.all([
        fetchRequests(),
        getApprovalCount(),
      ]);
      if (count === 0) {
        // No more requests - close window
        window.close();
      } else {
        // Return to list view
        dispatch({ type: "showList" });
      }
    } catch (err) {
      dispatch({
        type: "loadError",
        error: err instanceof Error ? err.message : "Failed to process batch",
      });
    } finally {
      dispatch({ type: "resolveEnd" });
    }
  };

  // Loading state
  if (state.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <div className="mb-4 h-16 w-16 animate-pulse">
          <Logo size="max" />
        </div>
        <p className="text-muted-foreground">Loading requests...</p>
      </div>
    );
  }

  // No requests state
  if (state.requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <div className="mb-4 h-16 w-16">
          <Logo size="max" />
        </div>
        <h2 className="text-lg font-semibold mb-2">No Pending Requests</h2>
        <p className="text-muted-foreground text-center text-sm">
          There are no signing requests waiting for approval.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => window.close()}
        >
          Close
        </Button>
      </div>
    );
  }

  // Error state
  if (state.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
        <h2 className="text-lg font-semibold mb-2">Error</h2>
        <p className="text-muted-foreground text-center text-sm">
          {state.error}
        </p>
        <Button variant="outline" className="mt-4" onClick={fetchRequests}>
          Try Again
        </Button>
      </div>
    );
  }

  // No fallback to requests[0]: the pane shows what the user chose, or
  // nothing. See the loadSuccess case above.
  const selectedRequest = state.requests.find(
    (r) => r.id === state.selectedRequestId
  );
  const countdown = selectedRequest
    ? Math.max(0, selectedRequest.timeoutAt - state.nowSeconds)
    : 0;

  const handleSelectRequest = (id: string) => {
    dispatch({ type: "selectRequest", id });
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden bg-background md:grid-cols-[330px_minmax(0,1fr)]">
      <QueueListView
        requests={state.requests}
        selectedRequestId={selectedRequest?.id ?? null}
        nowSeconds={state.nowSeconds}
        onSelectRequest={handleSelectRequest}
        onBatchAction={handleBatchAction}
        disabled={state.isResolving}
        className={state.showCompactDetail ? "hidden md:flex" : "flex"}
      />

      {selectedRequest ? (
        <EventDetailView
          request={selectedRequest}
          signingKey={state.selectedKey}
          countdown={countdown}
          onResolve={handleAction}
          onBack={() => dispatch({ type: "showList" })}
          showBackButton={state.showCompactDetail}
          isResolving={state.isResolving}
          className={state.showCompactDetail ? "flex" : "hidden md:flex"}
        />
      ) : (
        <div className="hidden items-center justify-center border-l border-border bg-background p-6 text-center md:flex">
          <p className="text-sm font-semibold text-muted-foreground">
            Select a request to review the exact payload.
          </p>
        </div>
      )}
    </div>
  );
}

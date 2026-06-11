import { useState, useEffect, useCallback } from "react";
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

/**
 * ApprovalPrompt component displays pending approval requests
 * in a queue list view, with detailed event information when selected
 */
export function ApprovalPrompt() {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowSeconds, setNowSeconds] = useState(() =>
    Math.floor(Date.now() / 1000)
  );
  const [selectedKey, setSelectedKey] = useState<KeyRecord | null>(null);
  const [showCompactDetail, setShowCompactDetail] = useState(false);

  // Fetch all pending requests
  const fetchRequests = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [{ requests: allRequests }, keys] = await Promise.all([
        getAllApprovalRequests(),
        listKeys(),
      ]);

      setRequests(allRequests);

      // Find selected key
      const selected = keys?.find((k) => k.isSelected) ?? null;
      setSelectedKey(selected);

      const selectedStillPending =
        selectedRequestId &&
        allRequests.some((request) => request.id === selectedRequestId);

      if (!selectedStillPending) {
        console.log(
          "[ApprovalPrompt] Selecting next pending request for detail pane"
        );
        setSelectedRequestId(allRequests[0]?.id ?? null);
        setShowCompactDetail(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load requests");
    } finally {
      setIsLoading(false);
    }
  }, [selectedRequestId]);

  // Initial fetch
  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    if (requests.length === 0) return;

    const timer = setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [requests.length]);

  // Listen for real-time queue updates
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message && message.__event === "ostrilo.queue.updated") {
        console.log("[ApprovalPrompt] Queue updated, refreshing...");
        fetchRequests();
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, [fetchRequests]);

  // Handle user action on selected request
  const handleAction = async (action: ApprovalAction) => {
    if (!selectedRequestId || isResolving) return;

    try {
      setIsResolving(true);
      await resolveApprovalRequest(selectedRequestId, action);

      // Refresh queue
      await fetchRequests();

      // Check if there are more requests
      const { count } = await getApprovalCount();
      if (count === 0) {
        // No more requests - close window
        window.close();
      } else {
        // Return to list view
        setShowCompactDetail(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process action");
    } finally {
      setIsResolving(false);
    }
  };

  // Handle batch actions
  const handleBatchAction = async (
    action: "approve" | "deny",
    requestIds: string[]
  ) => {
    if (isResolving || requestIds.length === 0) return;

    try {
      setIsResolving(true);
      const approvalAction = action === "approve" ? "allow_once" : "deny";

      // Resolve all requests in batch
      await Promise.all(
        requestIds.map((id) => resolveApprovalRequest(id, approvalAction))
      );

      // Refresh queue
      await fetchRequests();

      // Check if there are more requests
      const { count } = await getApprovalCount();
      if (count === 0) {
        // No more requests - close window
        window.close();
      } else {
        // Return to list view
        setShowCompactDetail(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process batch");
    } finally {
      setIsResolving(false);
    }
  };

  // Loading state
  if (isLoading) {
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
  if (requests.length === 0) {
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
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
        <h2 className="text-lg font-semibold mb-2">Error</h2>
        <p className="text-muted-foreground text-center text-sm">{error}</p>
        <Button variant="outline" className="mt-4" onClick={fetchRequests}>
          Try Again
        </Button>
      </div>
    );
  }

  const selectedRequest =
    requests.find((r) => r.id === selectedRequestId) ?? requests[0];
  const countdown = selectedRequest
    ? Math.max(0, selectedRequest.timeoutAt - nowSeconds)
    : 0;

  const handleSelectRequest = (id: string) => {
    setSelectedRequestId(id);
    setShowCompactDetail(true);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden bg-background md:grid-cols-[330px_minmax(0,1fr)]">
      <QueueListView
        requests={requests}
        selectedRequestId={selectedRequest?.id ?? null}
        nowSeconds={nowSeconds}
        onSelectRequest={handleSelectRequest}
        onBatchAction={handleBatchAction}
        disabled={isResolving}
        className={showCompactDetail ? "hidden md:flex" : "flex"}
      />

      {selectedRequest ? (
        <EventDetailView
          request={selectedRequest}
          signingKey={selectedKey}
          countdown={countdown}
          onResolve={handleAction}
          onBack={() => setShowCompactDetail(false)}
          showBackButton={showCompactDetail}
          isResolving={isResolving}
          className={showCompactDetail ? "flex" : "hidden md:flex"}
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

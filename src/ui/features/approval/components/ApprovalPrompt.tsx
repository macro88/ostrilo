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
import mascotLogo from "@/assets/ostrilo_front.svg";
import { QueueListView } from "./QueueListView";
import { EventDetailView } from "./EventDetailView";
import { browser } from "wxt/browser";

/**
 * ApprovalPrompt component displays pending approval requests
 * in a queue list view, with detailed event information when selected
 */
export function ApprovalPrompt() {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [selectedKey, setSelectedKey] = useState<KeyRecord | null>(null);

  // Fetch all pending requests
  const fetchRequests = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [{ requests: allRequests }, { count }, keys] = await Promise.all([
        getAllApprovalRequests(),
        getApprovalCount(),
        listKeys(),
      ]);

      setRequests(allRequests);
      setPendingCount(count);

      // Find selected key
      const selected = keys?.find((k) => k.isSelected) ?? null;
      setSelectedKey(selected);

      // If current selection is no longer in queue, return to list view
      if (
        selectedRequestId &&
        !allRequests.find((r) => r.id === selectedRequestId)
      ) {
        console.log(
          "[ApprovalPrompt] Selected request no longer in queue, returning to list view"
        );
        setSelectedRequestId(null);
      }

      // Don't auto-select - let user choose from queue list
      // (They can click on a request to view details)

      // Calculate countdown for selected request
      if (selectedRequestId) {
        const selectedReq = allRequests.find((r) => r.id === selectedRequestId);
        if (selectedReq) {
          const now = Math.floor(Date.now() / 1000);
          const remaining = Math.max(0, selectedReq.timeoutAt - now);
          setCountdown(remaining);
        }
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

  // Countdown timer for selected request
  useEffect(() => {
    if (!selectedRequestId || countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Timeout reached - close window
          window.close();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [selectedRequestId, countdown]);

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
        setSelectedRequestId(null);
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
        setSelectedRequestId(null);
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
        <img
          src={mascotLogo}
          alt="Ostrilo"
          className="w-16 h-16 mb-4 animate-pulse"
        />
        <p className="text-muted-foreground">Loading requests...</p>
      </div>
    );
  }

  // No requests state
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <img src={mascotLogo} alt="Ostrilo" className="w-16 h-16 mb-4" />
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

  // If a request is selected, show detail view
  if (selectedRequestId) {
    const selectedRequest = requests.find((r) => r.id === selectedRequestId);
    if (!selectedRequest) {
      // Request not found - return to list
      setSelectedRequestId(null);
      return null;
    }

    return (
      <EventDetailView
        request={selectedRequest}
        signingKey={selectedKey}
        countdown={countdown}
        onResolve={handleAction}
        onBack={() => setSelectedRequestId(null)}
        isResolving={isResolving}
      />
    );
  }

  // Show queue list view
  return (
    <QueueListView
      requests={requests}
      onSelectRequest={setSelectedRequestId}
      onBatchAction={handleBatchAction}
    />
  );
}

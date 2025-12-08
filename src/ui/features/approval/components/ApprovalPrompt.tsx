import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  getNextApprovalRequest,
  resolveApprovalRequest,
  getApprovalCount,
  listKeys,
} from "@/infrastructure/messaging/client";
import type { PendingRequest, ApprovalAction, KeyRecord } from "@/domain/types";
import { getKindName } from "@/domain/types";
import {
  Shield,
  Globe,
  Clock,
  FileText,
  AlertTriangle,
  Check,
  X,
  Ban,
  Key,
} from "lucide-react";
import { Pubkey } from "@/components/common/pubkey";
import mascotLogo from "@/assets/ostrilo_mascot_front.svg";

/** Maximum content preview length */
const MAX_CONTENT_PREVIEW = 200;

/**
 * ApprovalPrompt component displays a pending signing request
 * and allows the user to approve or deny it
 */
export function ApprovalPrompt() {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [selectedKey, setSelectedKey] = useState<KeyRecord | null>(null);

  // Fetch the next pending request
  const fetchRequest = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [{ request: pendingRequest }, { count }, keys] = await Promise.all([
        getNextApprovalRequest(),
        getApprovalCount(),
        listKeys(),
      ]);

      setRequest(pendingRequest);
      setPendingCount(count);

      // Find selected key
      const selected = keys?.find((k) => k.isSelected) ?? null;
      setSelectedKey(selected);

      if (pendingRequest) {
        // Calculate remaining time until timeout
        const now = Math.floor(Date.now() / 1000);
        const remaining = Math.max(0, pendingRequest.timeoutAt - now);
        setCountdown(remaining);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load request");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchRequest();
  }, [fetchRequest]);

  // Countdown timer
  useEffect(() => {
    if (!request || countdown <= 0) return;

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
  }, [request, countdown]);

  // Handle user action
  const handleAction = async (action: ApprovalAction) => {
    if (!request || isResolving) return;

    try {
      setIsResolving(true);
      await resolveApprovalRequest(request.id, action);

      // Check if there are more requests
      const { count } = await getApprovalCount();
      if (count > 0) {
        // Fetch next request
        await fetchRequest();
      } else {
        // No more requests - close window
        window.close();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process action");
    } finally {
      setIsResolving(false);
    }
  };

  // Truncate content for preview
  const truncateContent = (content: string): string => {
    if (content.length <= MAX_CONTENT_PREVIEW) return content;
    return content.slice(0, MAX_CONTENT_PREVIEW) + "...";
  };

  // Format domain from origin
  const formatDomain = (origin: string): string => {
    try {
      const url = new URL(origin);
      return url.hostname;
    } catch {
      return origin;
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
        <p className="text-muted-foreground">Loading request...</p>
      </div>
    );
  }

  // No request state
  if (!request) {
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
        <Button variant="outline" className="mt-4" onClick={fetchRequest}>
          Try Again
        </Button>
      </div>
    );
  }

  const kindName = getKindName(request.event.kind);
  const domain = formatDomain(request.origin);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-muted/50 p-4 border-b">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-primary" />
          <div className="flex-1">
            <h1 className="font-semibold">Signing Request</h1>
            {pendingCount > 1 && (
              <p className="text-xs text-muted-foreground">
                {pendingCount} requests pending
              </p>
            )}
          </div>
          <span className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border bg-background">
            <Clock className="w-3 h-3" />
            {countdown}s
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Origin */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Globe className="w-4 h-4" />
            <span>Origin</span>
          </div>
          <p className="font-medium truncate" title={request.origin}>
            {domain}
          </p>
        </div>

        <hr className="border-border" />

        {/* Event Kind */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="w-4 h-4" />
            <span>Event Type</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs rounded-md bg-muted">
              Kind {request.event.kind}
            </span>
            <span className="font-medium">{kindName}</span>
          </div>
        </div>

        <hr className="border-border" />

        {/* Content Preview */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="w-4 h-4" />
            <span>Content Preview</span>
          </div>
          <div className="bg-muted/50 rounded-md p-3 text-sm font-mono break-all max-h-24 overflow-y-auto">
            {request.event.content ? (
              truncateContent(request.event.content)
            ) : (
              <span className="text-muted-foreground italic">(empty)</span>
            )}
          </div>
        </div>

        <hr className="border-border" />

        {/* Signing Key */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Key className="w-4 h-4" />
            <span>Signing Key</span>
          </div>
          {selectedKey ? (
            <div className="flex items-center gap-2">
              {selectedKey.label && (
                <span className="font-medium">{selectedKey.label}</span>
              )}
              <Pubkey pubkey={selectedKey.pubkey} />
            </div>
          ) : (
            <span className="text-muted-foreground italic">
              No key selected
            </span>
          )}
        </div>
      </div>

      {/* Help text */}
      <div className="px-4 pb-2">
        <p className="text-xs text-muted-foreground text-center">
          <strong>Allow</strong> signs this event.{" "}
          <strong>Deny + Remember</strong> blocks future requests from this site
          for this event type.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="p-4 border-t bg-muted/30 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={() => handleAction("allow")}
            disabled={isResolving}
            className="flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Allow
          </Button>
          <Button
            variant="outline"
            onClick={() => handleAction("allow_once")}
            disabled={isResolving}
            className="flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Allow Once
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() => handleAction("deny")}
            disabled={isResolving}
            className="flex items-center gap-2"
          >
            <X className="w-4 h-4" />
            Deny
          </Button>
          <Button
            variant="destructive"
            onClick={() => handleAction("deny_remember")}
            disabled={isResolving}
            className="flex items-center gap-2"
          >
            <Ban className="w-4 h-4" />
            Deny + Remember
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  ChevronDown,
} from "lucide-react";
import { Pubkey } from "@/components/common/pubkey";
import mascotLogo from "@/assets/ostrilo_mascot_front.svg";

/** Maximum content preview length */
const MAX_CONTENT_PREVIEW = 150;

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
    <div className="flex flex-col h-full  ">
      {/* Header */}
      <div className="bg-muted/50 p-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm">Signing Request</h1>
            {pendingCount > 1 && (
              <p className="text-xs text-muted-foreground">
                {pendingCount} requests pending
              </p>
            )}
          </div>
          <span className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border bg-background shrink-0">
            <Clock className="w-3 h-3" />
            {countdown}s
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 space-y-3 min-h-0">
        {/* Origin */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Globe className="w-3.5 h-3.5" />
            <span>Origin</span>
          </div>
          <p className="text-sm font-medium truncate" title={request.origin}>
            {domain}
          </p>
        </div>

        <hr className="border-border" />

        {/* Event Kind */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="w-3.5 h-3.5" />
            <span>Event Type</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs rounded-md bg-muted">
              Kind {request.event.kind}
            </span>
            <span className="text-sm font-medium">{kindName}</span>
          </div>
        </div>

        <hr className="border-border" />

        {/* Content Preview */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="w-3.5 h-3.5" />
            <span>Content Preview</span>
          </div>
          <div className="bg-muted/50 rounded-md p-2 text-xs font-mono break-all max-h-20 overflow-y-auto">
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Key className="w-3.5 h-3.5" />
            <span>Signing Key</span>
          </div>
          {selectedKey ? (
            <div className="flex items-center gap-2 text-sm">
              {selectedKey.label && (
                <span className="font-medium truncate max-w-[150px]">
                  {selectedKey.label}
                </span>
              )}
              <Pubkey pubkey={selectedKey.pubkey} />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground italic">
              No key selected
            </span>
          )}
        </div>
      </div>

      {/* Help text */}
      <div className="px-3 pb-2 shrink-0">
        <p className="text-xs text-muted-foreground text-center">
          <strong>Allow</strong> signs this event.{" "}
          <strong>Deny + Remember</strong> blocks future requests from this site
          for this event type.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="p-3 border-t bg-muted/30 space-y-2 shrink-0">
        {/* Allow Button Group */}
        <ButtonGroup className="w-full">
          <Button
            onClick={() => handleAction("allow_once")}
            disabled={isResolving}
            className="flex-1 flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            Allow Once
          </Button>
          <ButtonGroupSeparator />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={isResolving}
                className="px-2"
                aria-label="More allow options"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleAction("allow")}>
                <Check className="w-4 h-4 mr-2" />
                Allow for this Site
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => alert("Trust this site - Coming soon")}
              >
                <Shield className="w-4 h-4 mr-2" />
                Trust this Site
                <span className="ml-auto text-xs text-muted-foreground">
                  Soon
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>

        {/* Deny Button Group */}
        <ButtonGroup className="w-full">
          <Button
            variant="secondary"
            onClick={() => handleAction("deny")}
            disabled={isResolving}
            className="flex-1 flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4" />
            Deny Once
          </Button>
          <ButtonGroupSeparator />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                disabled={isResolving}
                className="px-2"
                aria-label="More deny options"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleAction("deny_remember")}>
                <Ban className="w-4 h-4 mr-2" />
                Deny + Remember
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PendingRequest } from "@/domain/types";
import { getKindName } from "@/domain/types";
import {
  Globe,
  Clock,
  FileText,
  ChevronDown,
  ChevronRight,
  Check,
  X,
} from "lucide-react";
import { SealMark } from "@/components/common/SealMark";
import { cn } from "@/lib/utils";

export interface QueueListViewProps {
  /** All pending requests in the queue */
  requests: PendingRequest[];
  /** Currently selected request ID */
  selectedRequestId?: string | null;
  /** Current Unix time in seconds, used for live countdown display */
  nowSeconds: number;
  /** Callback when user selects a request to view details */
  onSelectRequest: (id: string) => void;
  /** Callback for batch actions (approve all from origin, deny all) */
  onBatchAction?: (action: "approve" | "deny", requestIds: string[]) => void;
  /** Disable actions while a resolution is in flight */
  disabled?: boolean;
  /** Optional layout class */
  className?: string;
}

interface OriginGroup {
  origin: string;
  domain: string;
  requests: PendingRequest[];
}

/**
 * QueueListView displays all pending approval requests grouped by origin.
 * Users can expand/collapse origin groups and select individual requests for details.
 */
export function QueueListView({
  requests,
  selectedRequestId,
  nowSeconds,
  onSelectRequest,
  onBatchAction,
  disabled = false,
  className,
}: QueueListViewProps) {
  const [expandedOrigins, setExpandedOrigins] = useState<Set<string>>(
    new Set(requests.map((r) => r.origin))
  );

  // Group requests by origin
  const groups: OriginGroup[] = requests.reduce((acc, request) => {
    const existing = acc.find((g) => g.origin === request.origin);
    if (existing) {
      existing.requests.push(request);
    } else {
      acc.push({
        origin: request.origin,
        domain: formatDomain(request.origin),
        requests: [request],
      });
    }
    return acc;
  }, [] as OriginGroup[]);

  // Sort groups by most recent request
  groups.sort((a, b) => {
    const aLatest = Math.max(...a.requests.map((r) => r.createdAt));
    const bLatest = Math.max(...b.requests.map((r) => r.createdAt));
    return bLatest - aLatest;
  });

  const toggleOrigin = (origin: string) => {
    setExpandedOrigins((prev) => {
      const next = new Set(prev);
      if (next.has(origin)) {
        next.delete(origin);
      } else {
        next.add(origin);
      }
      return next;
    });
  };

  const handleBatchApprove = (origin: string) => {
    const group = groups.find((g) => g.origin === origin);
    if (group && onBatchAction) {
      onBatchAction(
        "approve",
        group.requests.map((r) => r.id)
      );
    }
  };

  const handleBatchDeny = (origin: string) => {
    const group = groups.find((g) => g.origin === origin);
    if (group && onBatchAction) {
      onBatchAction(
        "deny",
        group.requests.map((r) => r.id)
      );
    }
  };

  const handleDenyAll = () => {
    if (onBatchAction) {
      onBatchAction(
        "deny",
        requests.map((r) => r.id)
      );
    }
  };

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <SealMark icon={FileText} size="lg" className="mb-4" />
        <h2 className="text-lg font-semibold mb-2">No Pending Requests</h2>
        <p className="text-muted-foreground text-center text-sm">
          All approval requests have been processed.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col bg-background", className)}
      data-testid="approval-inbox"
    >
      <div className="shrink-0 border-b border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Approval Inbox</h1>
            <p className="text-xs text-muted-foreground">
              {requests.length} request{requests.length !== 1 ? "s" : ""} from{" "}
              {groups.length} site{groups.length !== 1 ? "s" : ""}
            </p>
          </div>
          {onBatchAction && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDenyAll}
              disabled={disabled}
              className="gap-1"
            >
              <X className="w-3 h-3" />
              Deny all
            </Button>
          )}
        </div>
      </div>

      {/* Scrollable List */}
      <div className="flex-1 space-y-3 overflow-auto p-3">
        {groups.map((group) => {
          const isExpanded = expandedOrigins.has(group.origin);
          return (
            <div
              key={group.origin}
              className="ink-card overflow-hidden"
              data-testid="approval-origin-group"
              data-origin={group.origin}
            >
              <button
                type="button"
                onClick={() => toggleOrigin(group.origin)}
                className="flex w-full items-center justify-between p-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 shrink-0" />
                  )}
                  <Globe className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium text-sm truncate">
                    {group.domain}
                  </span>
                </div>
                <span className="seal-chip seal-chip-accent ml-2 shrink-0">
                  {group.requests.length}
                </span>
              </button>

              {/* Origin Batch Actions */}
              {isExpanded && onBatchAction && group.requests.length > 1 && (
                <div className="flex gap-2 border-y border-border bg-muted/30 px-3 py-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBatchApprove(group.origin)}
                    disabled={disabled}
                    className="flex-1 gap-1"
                  >
                    <Check className="w-3 h-3" />
                    Approve all from site
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleBatchDeny(group.origin)}
                    disabled={disabled}
                    className="flex-1 gap-1"
                  >
                    <X className="w-3 h-3" />
                    Deny all from site
                  </Button>
                </div>
              )}

              {/* Request List */}
              {isExpanded && (
                <div>
                  {group.requests.map((request) => (
                    <RequestItem
                      key={request.id}
                      request={request}
                      isSelected={request.id === selectedRequestId}
                      nowSeconds={nowSeconds}
                      onSelect={() => onSelectRequest(request.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface RequestItemProps {
  request: PendingRequest;
  isSelected: boolean;
  nowSeconds: number;
  onSelect: () => void;
}

function RequestItem({
  request,
  isSelected,
  nowSeconds,
  onSelect,
}: RequestItemProps) {
  const kindName = getKindName(request.event.kind);
  const timeRemaining = Math.max(0, request.timeoutAt - nowSeconds);

  // Truncate content to 50 chars
  const contentPreview =
    request.event.content.length > 50
      ? request.event.content.slice(0, 50) + "..."
      : request.event.content;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected ? "true" : undefined}
      data-testid="approval-request-item"
      data-request-id={request.id}
      className={cn(
        "w-full border-t p-3 text-left transition-colors first:border-t-0 hover:bg-muted/50",
        isSelected && "bg-secondary text-secondary-foreground hover:bg-secondary"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          {/* Kind Badge */}
          <div className="flex items-center gap-2">
            <span className="seal-chip seal-chip-accent font-mono">
              kind:{request.event.kind}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {kindName}
            </span>
          </div>

          {/* Content Preview */}
          {request.event.content && (
            <p className="text-xs text-muted-foreground font-mono truncate">
              {contentPreview}
            </p>
          )}

          {/* Timestamp */}
          <p className="text-xs text-muted-foreground">
            {formatTimestamp(request.createdAt)}
          </p>
        </div>

        {/* Countdown */}
        <div className="seal-chip seal-chip-warning shrink-0 font-mono">
          <Clock className="w-3 h-3" />
          {formatCountdown(timeRemaining)}
        </div>
      </div>
    </button>
  );
}

// Helper functions

function formatDomain(origin: string): string {
  try {
    const url = new URL(origin);
    return url.hostname;
  } catch {
    return origin;
  }
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins === 1) return "1 minute ago";
  if (diffMins < 60) return `${diffMins} minutes ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return "1 hour ago";
  if (diffHours < 24) return `${diffHours} hours ago`;

  // Format as date
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

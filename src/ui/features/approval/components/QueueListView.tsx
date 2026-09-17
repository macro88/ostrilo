import { useState } from "react";
import { formatOrigin } from "@/domain/display/origin";
import { escapeInvisible } from "@/domain/display/safe-text";
import { Button } from "@/components/ui/button";
import type { PendingRequest } from "@/domain/types";
import { getKindName, isSigningRequest } from "@/domain/types";
import { ChevronDown, ChevronRight, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCountdown, type OriginTrust } from "./useApprovalDisplay";
import { TrustChip } from "./EventDetailView";

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
  /**
   * Rendered inside another surface that already carries a title (the side
   * panel's "Pending Approvals" sheet). Keeps the count and Deny all, drops
   * the "Approval Inbox" heading so two titles never stack.
   */
  embedded?: boolean;
  /** Trust state per origin, for the chip on each group. Absent while settings load. */
  trustByOrigin?: ReadonlyMap<string, OriginTrust>;
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
  trustByOrigin,
  className,
  embedded = false,
}: QueueListViewProps) {
  // Lazy: the Set was being rebuilt on every render even though only the
  // first one is ever used, and this list re-renders on every queue change.
  const [expandedOrigins, setExpandedOrigins] = useState<Set<string>>(
    () => new Set(requests.map((r) => r.origin))
  );

  // Group requests by origin
  const groups: OriginGroup[] = requests.reduce((acc, request) => {
    const existing = acc.find((g) => g.origin === request.origin);
    if (existing) {
      existing.requests.push(request);
    } else {
      acc.push({
        origin: request.origin,
        domain: formatOrigin(request.origin).display,
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
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <h2 className="text-[17px] font-bold">No Pending Requests</h2>
      </div>
    );
  }

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col bg-background", className)}
      data-testid="approval-inbox"
    >
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        {!embedded && (
          <h1 className="text-[17px] font-bold leading-6">Approval Inbox</h1>
        )}
        <p
          className={
            embedded
              ? "text-sm font-semibold leading-6"
              : "text-xs text-muted-foreground"
          }
        >
          {requests.length} request{requests.length !== 1 ? "s" : ""} from{" "}
          {groups.length} site{groups.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Scrollable List */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {groups.map((group) => {
          const isExpanded = expandedOrigins.has(group.origin);
          const trust = trustByOrigin?.get(group.origin);
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
                aria-expanded={isExpanded}
                className="flex min-h-12 w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/50"
              >
                {isExpanded ? (
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-bold tracking-tight">
                  {group.domain}
                </span>
                {trust && <TrustChip trust={trust} />}
                {/* The count matters only while the rows are folded away. */}
                {!isExpanded && (
                  <span
                    className="seal-chip seal-chip-accent shrink-0 font-mono"
                    aria-label={`${group.requests.length} request${
                      group.requests.length !== 1 ? "s" : ""
                    }`}
                  >
                    {group.requests.length}
                  </span>
                )}
              </button>

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

              {/* Per-site batch action.

                  Bulk APPROVE is deliberately absent. Approving in bulk is
                  approving without looking, and the way to get a signature a
                  user did not mean to give is to ask many times and offer one
                  button that answers all of them. Bulk DENY stays: refusing
                  without looking is always safe, and a user buried in prompts
                  needs a way out that is not "approve everything".

                  Shown whether or not the group is expanded, and only when
                  there is more than one site - with a single site it is the
                  same action as Deny all in the footer. */}
              {onBatchAction &&
                groups.length > 1 &&
                group.requests.length > 1 && (
                  <div className="border-t border-border px-3.5 py-2.5">
                    <Button
                      variant="outline"
                      onClick={() => handleBatchDeny(group.origin)}
                      disabled={disabled}
                      className="h-10 w-full text-xs"
                    >
                      Deny all from site
                    </Button>
                  </div>
                )}
            </div>
          );
        })}
      </div>

      {/* Pinned footer, the same geometry as the detail screens: the trust
          line, then the one bulk action. Deny is the safe action, so it wears
          the same neutral ghost the detail's Deny does. */}
      {onBatchAction && (
        <div className="shrink-0 border-t border-border bg-card px-4 pb-4 pt-2.5">
          <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Shield className="h-3.5 w-3.5" aria-hidden="true" />
            Keys never leave your browser.
          </p>
          <Button
            variant="outline"
            onClick={handleDenyAll}
            disabled={disabled}
            className="mt-2.5 h-12 w-full"
          >
            Deny all
          </Button>
        </div>
      )}
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
  // A disclosure request signs nothing, so it has no kind and no content.
  // Reading `request.event` here without narrowing is what used to throw and
  // blank the whole window, taking the Deny control for every OTHER queued
  // request with it.
  const event = isSigningRequest(request) ? request.event : undefined;
  const kindName = event ? getKindName(event.kind) : "Identity disclosure";
  const timeRemaining = Math.max(0, request.timeoutAt - nowSeconds);

  // Escaped before truncation, so a bidi override in the first fifty
  // characters cannot reverse the preview the user skims.
  const safePreview = event ? escapeInvisible(event.content).text : "";
  const contentPreview =
    safePreview.length > 50 ? safePreview.slice(0, 50) + "..." : safePreview;

  // No "just now" line: requests expire after sixty seconds, so every row
  // would carry the same words. The countdown already says how fresh it is.
  // The trailing chevron is what says "this opens": a row with a timer, a
  // kind chip and a preview but no affordance reads as a status card.
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected ? "true" : undefined}
      data-testid="approval-request-item"
      data-request-id={request.id}
      className={cn(
        "flex w-full items-center gap-2 border-t border-border py-3 pl-3.5 pr-2.5 text-left transition-colors hover:bg-muted/50",
        isSelected && "bg-secondary text-secondary-foreground hover:bg-secondary"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex w-full items-center gap-2">
          <span className="seal-chip seal-chip-accent shrink-0 font-mono normal-case tracking-normal">
            {event ? `kind:${event.kind}` : "identity"}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {kindName}
          </span>
          <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-[var(--ink-amber)]">
            {formatCountdown(timeRemaining)}
          </span>
        </div>

        {event ? (
          event.content && (
            <p className="w-full truncate font-mono text-xs text-muted-foreground">
              {contentPreview}
            </p>
          )
        ) : (
          <p className="w-full truncate text-xs text-muted-foreground">
            Wants to read your public key.
          </p>
        )}
      </div>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </button>
  );
}

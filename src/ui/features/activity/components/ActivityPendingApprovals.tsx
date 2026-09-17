import { Button } from "@/components/ui/button";
import { SealMark } from "@/components/common/SealMark";
import { formatOrigin } from "@/domain/display/origin";
import { ApprovalPrompt } from "@/ui/features/approval/components/ApprovalPrompt";
import type { PendingRequest } from "@/domain/types";
import { getKindName, isSigningRequest } from "@/domain/types";
import {
  ArrowLeft,
  Bell,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

interface ActivityPendingApprovalsProps {
  requests: PendingRequest[];
  count: number;
  expanded: boolean;
  sidePanel: boolean;
  showApprovalDialog: boolean;
  onToggleExpanded: () => void;
  onOpenApprovalWindow: () => void;
  onCloseApprovalDialog: () => void;
}

export function ActivityPendingApprovals({
  requests,
  count,
  expanded,
  sidePanel,
  showApprovalDialog,
  onToggleExpanded,
  onOpenApprovalWindow,
  onCloseApprovalDialog,
}: ActivityPendingApprovalsProps) {
  if (count === 0) {
    return null;
  }

  return (
    <>
      {showApprovalDialog && sidePanel && (
        <div className="app-canvas fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
            <h2 className="text-lg font-bold">Pending Approvals</h2>
            <Button variant="ghost" size="sm" onClick={onCloseApprovalDialog}>
              <ArrowLeft className="h-4 w-4" />
              Back to Activity
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ApprovalPrompt embedded />
          </div>
        </div>
      )}

      {/* `shrink-0`: inside the tab's scrolling column an overflow-hidden card
          would otherwise shrink to fit and clip its own rows. */}
      <div className="ink-card shrink-0 overflow-hidden">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="ink-row w-full text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[var(--ink-violet-soft)]"
        >
          <SealMark icon={Bell} tone="warning" />
          <span className="min-w-0 flex-1 text-[13px] font-bold">
            Pending Approvals
          </span>
          <span className="seal-chip seal-chip-warning font-mono">{count}</span>
          {expanded ? (
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
        </button>

        {expanded && (
          <>
            {requests.slice(0, 3).map((request) => (
              <div key={request.id} className="ink-row">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">
                    {isSigningRequest(request)
                      ? getKindName(request.event.kind)
                      : "Identity disclosure"}
                  </p>
                  <p className="truncate font-mono text-[11.5px] text-muted-foreground">
                    {formatOrigin(request.origin).display}
                  </p>
                </div>
                <span className="seal-chip seal-chip-accent shrink-0 font-mono">
                  {isSigningRequest(request)
                    ? `kind:${request.event.kind}`
                    : "pubkey"}
                </span>
              </div>
            ))}

            <div className="space-y-2 border-t border-border p-3">
              {count > 3 && (
                <p className="text-center text-xs text-muted-foreground">
                  +{count - 3} more pending
                </p>
              )}
              <Button onClick={onOpenApprovalWindow} className="w-full">
                {sidePanel ? (
                  <>
                    <Bell className="h-4 w-4" />
                    Review Approvals
                  </>
                ) : (
                  <>
                    <ExternalLink className="h-4 w-4" />
                    Open Approval Window
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

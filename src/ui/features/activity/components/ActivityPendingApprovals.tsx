import { Button } from "@/components/ui/button";
import { formatOrigin } from "@/domain/display/origin";
import { Badge } from "@/components/ui/badge";
import { ApprovalPrompt } from "@/ui/features/approval/components/ApprovalPrompt";
import type { PendingRequest } from "@/domain/types";
import { getKindName, isSigningRequest } from "@/domain/types";
import { Bell, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

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
          <div className="flex items-center justify-between border-b border-border bg-card p-3">
            <h2 className="text-lg font-semibold">Pending Approvals</h2>
            <Button variant="ghost" size="sm" onClick={onCloseApprovalDialog}>
              ← Back to Activity
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ApprovalPrompt />
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-[10px] border border-border bg-card shadow-sm">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex w-full items-center justify-between p-3 transition-colors hover:bg-muted/60"
        >
          <div className="flex items-center gap-2">
            <span className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground bg-[var(--ink-amber-soft)] text-[var(--ink-amber)] h-7 w-7">
              <Bell className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-semibold">Pending Approvals</span>
            <Badge
              variant="secondary"
              className="bg-[var(--ink-amber-soft)] text-[var(--ink-amber)] border"
            >
              {count}
            </Badge>
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className="border-t border-border">
            <div className="p-3 space-y-2">
              {requests.slice(0, 3).map((request) => (
                <div
                  key={request.id}
                  className="rounded-xl border border-border bg-muted/40 p-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {isSigningRequest(request)
                          ? getKindName(request.event.kind)
                          : "Identity disclosure"}
                      </p>
                      <p className="text-muted-foreground truncate">
                        {formatOrigin(request.origin).display}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {isSigningRequest(request)
                        ? `Kind ${request.event.kind}`
                        : "Public key"}
                    </Badge>
                  </div>
                </div>
              ))}

              {count > 3 && (
                <p className="pt-1 text-center text-xs text-muted-foreground">
                  +{count - 3} more pending
                </p>
              )}

              <Button
                onClick={onOpenApprovalWindow}
                className="mt-2 w-full gap-2"
                size="sm"
              >
                {sidePanel ? (
                  <>
                    <Bell className="h-3 w-3" />
                    Review Approvals
                  </>
                ) : (
                  <>
                    <ExternalLink className="h-3 w-3" />
                    Open Approval Window
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

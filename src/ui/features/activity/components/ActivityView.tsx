import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useActivityLog } from "../hooks/useActivityLog";
import { getKindName, COMMON_EVENT_KINDS } from "@/domain/types";
import type { PendingRequest } from "@/domain/types";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Activity,
  Bell,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  getAllApprovalRequests,
  getApprovalCount,
} from "@/infrastructure/messaging/client";
import { browser } from "wxt/browser";
import { ApprovalPrompt } from "@/ui/features/approval/components/ApprovalPrompt";
import { useAppSettings } from "@/ui/hooks/useAppSettings";

/**
 * Format Unix timestamp to relative time
 */
function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

export function ActivityView() {
  const [originFilter, setOriginFilter] = useState<string | undefined>(
    undefined
  );
  const [kindFilter, setKindFilter] = useState<number | undefined>(undefined);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [showPendingSection, setShowPendingSection] = useState(true);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const { settings } = useAppSettings();

  const { entries, loading, hasMore, loadMore, refresh } = useActivityLog({
    origin: originFilter,
    kind: kindFilter,
  });

  // Fetch pending approvals
  const fetchPendingApprovals = async () => {
    try {
      const [{ requests }, { count }] = await Promise.all([
        getAllApprovalRequests(),
        getApprovalCount(),
      ]);
      setPendingRequests(requests);
      setPendingCount(count);
    } catch (err) {
      console.error("[ActivityView] Failed to fetch pending approvals:", err);
    }
  };

  // Initial fetch and listen for queue updates
  useEffect(() => {
    fetchPendingApprovals();

    const handleMessage = (message: any) => {
      if (message && message.__event === "ostrilo.queue.updated") {
        fetchPendingApprovals();
        // In sidepanel mode, auto-show the approval dialog when new request arrives
        if (settings?.sidePanel && !showApprovalDialog) {
          setShowApprovalDialog(true);
        }
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, [settings?.sidePanel, showApprovalDialog]);

  // Open approval window or show inline dialog based on sidepanel mode
  const handleOpenApprovalWindow = async () => {
    // Check if in sidepanel mode
    if (settings?.sidePanel) {
      // Show approval dialog inline
      setShowApprovalDialog(true);
    } else {
      // Open popup window (original behavior)
      try {
        await browser.windows.create({
          url: browser.runtime.getURL("/approval.html"),
          type: "popup",
          width: 640,
          height: 640,
          focused: true,
        });
      } catch (err) {
        console.error("[ActivityView] Failed to open approval window:", err);
      }
    }
  };

  // Get unique origins for filter dropdown
  const uniqueOrigins = Array.from(
    new Set(entries.map((e) => e.origin))
  ).sort();

  const handleOriginChange = (value: string) => {
    if (value === "all") {
      setOriginFilter(undefined);
    } else {
      setOriginFilter(value);
    }
  };

  const handleKindChange = (value: string) => {
    if (value === "all") {
      setKindFilter(undefined);
    } else {
      setKindFilter(Number(value));
    }
  };

  const handleClearFilters = () => {
    setOriginFilter(undefined);
    setKindFilter(undefined);
  };

  return (
    <div className="screen-shell">
      {showApprovalDialog && settings?.sidePanel && (
        <div className="app-canvas fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border bg-card p-3">
            <h2 className="text-lg font-semibold">Pending Approvals</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowApprovalDialog(false)}
            >
              ← Back to Activity
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ApprovalPrompt />
          </div>
        </div>
      )}

      <div className="screen-header">
        <div className="flex items-start gap-3">
          <div className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground">
            <Activity className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="screen-title">Recent Activity</h2>
            <p className="screen-description">
              Signing history, site requests, and approval decisions.
            </p>
          </div>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="overflow-hidden rounded-[10px] border border-border bg-card shadow-sm">
          <button
            onClick={() => setShowPendingSection(!showPendingSection)}
            className="flex w-full items-center justify-between p-3 transition-colors hover:bg-muted/60"
          >
            <div className="flex items-center gap-2">
              <span className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground bg-[var(--ink-amber-soft)] text-[var(--ink-amber)] h-7 w-7">
                <Bell className="h-3.5 w-3.5" />
              </span>
              <span className="text-sm font-semibold">
                Pending Approvals
              </span>
              <Badge
                variant="secondary"
                className="bg-[var(--ink-amber-soft)] text-[var(--ink-amber)] border"
              >
                {pendingCount}
              </Badge>
            </div>
            {showPendingSection ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {showPendingSection && (
            <div className="border-t border-border">
              <div className="p-3 space-y-2">
                {pendingRequests.slice(0, 3).map((request) => (
                  <div
                    key={request.id}
                    className="rounded-xl border border-border bg-muted/40 p-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {getKindName(request.event.kind)}
                        </p>
                        <p className="text-muted-foreground truncate">
                          {new URL(request.origin).hostname}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        Kind {request.event.kind}
                      </Badge>
                    </div>
                  </div>
                ))}

                {pendingCount > 3 && (
                  <p className="pt-1 text-center text-xs text-muted-foreground">
                    +{pendingCount - 3} more pending
                  </p>
                )}

                <Button
                  onClick={handleOpenApprovalWindow}
                  className="mt-2 w-full gap-2"
                  size="sm"
                >
                  {settings?.sidePanel ? (
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
      )}

      {/* Filters */}
      {(entries.length > 0 || originFilter || kindFilter) && (
        <div className="flex gap-2 flex-col sm:flex-row">
          {/* Origin Filter */}
          <Select
            value={originFilter || "all"}
            onValueChange={handleOriginChange}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue placeholder="All Origins" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Origins</SelectItem>
              {uniqueOrigins.map((origin) => (
                <SelectItem key={origin} value={origin}>
                  {new URL(origin).hostname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Kind Filter */}
          <Select
            value={kindFilter?.toString() || "all"}
            onValueChange={handleKindChange}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue placeholder="All Kinds" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Kinds</SelectItem>
              {Object.entries(COMMON_EVENT_KINDS).map(([kind, name]) => (
                <SelectItem key={kind} value={kind}>
                  {name} ({kind})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Clear Filters */}
          {(originFilter || kindFilter) && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
              className="w-full h-8 text-xs"
            >
              Clear Filters
            </Button>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && entries.length === 0 && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="ink-card p-4 animate-pulse"
            >
              <div className="h-4 bg-muted rounded w-1/3 mb-2" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && entries.length === 0 && (
        <div className="ink-card p-4 py-12 text-center">
          <div className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground mx-auto mb-4 h-12 w-12 opacity-80">
            <Activity className="h-5 w-5" />
          </div>
          <p className="text-muted-foreground font-medium mb-2">
            No activity yet
          </p>
          <p className="text-sm text-muted-foreground">
            Sign events to see your activity history here
          </p>
          {(originFilter || kindFilter) && (
            <Button
              variant="link"
              onClick={handleClearFilters}
              className="mt-2"
            >
              Clear filters to see all activity
            </Button>
          )}
        </div>
      )}

      {/* Activity Entries */}
      <div className="space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="ink-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Event Kind Name */}
                <h3 className="font-medium text-sm mb-1 truncate">
                  {getKindName(entry.kind)}
                </h3>

                {/* Origin */}
                <p className="text-xs text-muted-foreground truncate mb-1">
                  {new URL(entry.origin).hostname}
                </p>

                {/* Content Preview */}
                {entry.contentPreview && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-2">
                    {entry.contentPreview}
                  </p>
                )}

                {/* Timestamp */}
                <p className="text-xs text-muted-foreground mt-2">
                  {formatRelativeTime(entry.timestamp)}
                </p>
              </div>

              {/* Decision Badge */}
              <div className="flex-shrink-0">
                {entry.decision === "allow" ? (
                  <div className="seal-chip seal-chip-accent bg-[var(--ink-mint-soft)] text-[var(--ink-mint)]">
                    <CheckCircle className="h-3 w-3" />
                    Approved
                  </div>
                ) : (
                  <div className="seal-chip seal-chip-accent bg-[var(--ink-red-soft)] text-[var(--ink-red)]">
                    <XCircle className="h-3 w-3" />
                    Denied
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Load More */}
      {hasMore && !loading && (
        <div className="text-center pt-4">
          <Button onClick={loadMore} variant="outline" className="w-full">
            Load More
          </Button>
        </div>
      )}

      {/* Loading More State */}
      {loading && entries.length > 0 && (
        <div className="text-center pt-4">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        </div>
      )}
    </div>
  );
}

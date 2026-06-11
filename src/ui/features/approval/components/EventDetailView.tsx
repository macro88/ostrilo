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
import type { PendingRequest, ApprovalAction, KeyRecord } from "@/domain/types";
import { getKindName } from "@/domain/types";
import {
  Shield,
  Globe,
  Clock,
  FileText,
  Check,
  X,
  Ban,
  Key,
  ChevronDown,
  ArrowLeft,
  Copy,
} from "lucide-react";
import { Pubkey } from "@/components/common/pubkey";

export interface EventDetailViewProps {
  /** The pending request to display */
  request: PendingRequest;
  /** The key that will sign this event */
  signingKey: KeyRecord | null;
  /** Countdown timer in seconds */
  countdown: number;
  /** Callback when user makes a decision */
  onResolve: (action: ApprovalAction) => void;
  /** Callback to return to queue list */
  onBack: () => void;
  /** Whether the resolve action is in progress */
  isResolving?: boolean;
}

/**
 * EventDetailView displays complete event information for a pending approval request.
 * Shows full content, complete tags, metadata, and signing options.
 */
export function EventDetailView({
  request,
  signingKey,
  countdown,
  onResolve,
  onBack,
  isResolving = false,
}: EventDetailViewProps) {
  const kindName = getKindName(request.event.kind);
  const domain = formatDomain(request.origin);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-1 -ml-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <Shield className="w-5 h-5 text-primary" />
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm">Event Details</h1>
          </div>
          <span className="stamp-chip shrink-0">
            <Clock className="w-3 h-3" />
            {countdown}s
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {/* Origin */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Globe className="w-3.5 h-3.5" />
            <span>Origin</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium truncate" title={request.origin}>
              {domain}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(request.origin)}
              className="h-6 px-2"
            >
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <hr className="soft-divider" />

        {/* Event Kind */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="w-3.5 h-3.5" />
            <span>Event Type</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="stamp-chip">
              Kind {request.event.kind}
            </span>
            <span className="text-sm font-medium">{kindName}</span>
          </div>
        </div>

        <hr className="soft-divider" />

        {/* Timestamp */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span>Created At</span>
          </div>
          <p className="text-sm font-medium">
            {formatTimestamp(request.event.created_at)}
          </p>
        </div>

        <hr className="soft-divider" />

        {/* Full Content */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="w-3.5 h-3.5" />
            <span>Content</span>
          </div>
          <div className="code-panel">
            {request.event.content ? (
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {request.event.content}
              </pre>
            ) : (
              <span className="text-xs text-muted-foreground italic">
                (empty)
              </span>
            )}
          </div>
        </div>

        <hr className="soft-divider" />

        {/* Tags (JSON formatted) */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="w-3.5 h-3.5" />
            <span>Tags</span>
          </div>
          <div className="code-panel">
            {request.event.tags.length > 0 ? (
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {JSON.stringify(request.event.tags, null, 2)}
              </pre>
            ) : (
              <span className="text-xs text-muted-foreground italic">
                (no tags)
              </span>
            )}
          </div>
        </div>

        <hr className="soft-divider" />

        {/* Signing Key */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Key className="w-3.5 h-3.5" />
            <span>Signing Key</span>
          </div>
          {signingKey ? (
            <div className="flex items-center gap-2">
              {signingKey.label && (
                <span className="text-sm font-medium truncate max-w-[150px]">
                  {signingKey.label}
                </span>
              )}
              <Pubkey pubkey={signingKey.pubkey} />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground italic">
              No key selected
            </span>
          )}
        </div>

        <hr className="soft-divider" />

        {/* Request Metadata */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span>Request Info</span>
          </div>
          <div className="text-xs space-y-1">
            <p>
              <span className="text-muted-foreground">Request ID:</span>{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                {request.id}
              </code>
            </p>
            <p>
              <span className="text-muted-foreground">Created:</span>{" "}
              {formatTimestamp(request.createdAt)}
            </p>
            <p>
              <span className="text-muted-foreground">Timeout:</span>{" "}
              {formatTimestamp(request.timeoutAt)}
            </p>
          </div>
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
      <div className="shrink-0 space-y-2 border-t border-border bg-card p-3">
        {/* Allow Button Group */}
        <ButtonGroup className="w-full">
          <Button
            onClick={() => onResolve("allow_once")}
            disabled={isResolving}
            className="btn-plush flex-1 items-center justify-center gap-2"
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
              <DropdownMenuItem onClick={() => onResolve("allow")}>
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
            onClick={() => onResolve("deny")}
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
              <DropdownMenuItem onClick={() => onResolve("deny_remember")}>
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
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

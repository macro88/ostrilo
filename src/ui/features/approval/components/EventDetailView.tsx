import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PendingRequest, ApprovalAction, KeyRecord } from "@/domain/types";
import { getKindName } from "@/domain/types";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  FileJson,
  Shield,
  X,
} from "lucide-react";
import { SealMark } from "@/components/common/SealMark";

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
 * EventDetailView displays the exact payload a site is asking Ostrilo to sign.
 */
export function EventDetailView({
  request,
  signingKey,
  countdown,
  onResolve,
  onBack,
  isResolving = false,
}: EventDetailViewProps) {
  const [rememberChoice, setRememberChoice] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const kindName = getKindName(request.event.kind);
  const domain = formatDomain(request.origin);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleApprove = () => {
    onResolve(rememberChoice ? "allow" : "allow_once");
  };

  const handleDeny = () => {
    onResolve(rememberChoice ? "deny_remember" : "deny");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Back to approval queue"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="min-w-0 flex-1 text-lg font-bold">
            Signing request
          </h1>
          <span className="seal-chip seal-chip-warning font-mono text-sm">
            {formatCountdown(countdown)}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <section className="text-center">
          <SealMark
            label={domain}
            size="lg"
            className="mx-auto mb-3 h-14 w-14 text-xl"
          />
          <h2 className="text-xl font-bold">{domain}</h2>
          <p className="text-sm font-semibold text-muted-foreground">
            wants you to sign {kindName.toLowerCase()}
          </p>
          <span className="seal-chip seal-chip-accent mt-3">
            Review required
          </span>
        </section>

        <section className="ink-card overflow-hidden">
          <FactRow
            label="Signing as"
            value={signingKey?.label || "Selected key"}
          />
          <FactRow
            label="Kind"
            value={`${request.event.kind} · ${kindName}`}
            mono={false}
          />
          <FactRow
            label="Created"
            value={formatTimestamp(request.event.created_at)}
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Content
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => copyToClipboard(request.event.content)}
              disabled={!request.event.content}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          <div className="code-panel min-h-20">
            {request.event.content ? (
              <pre className="whitespace-pre-wrap break-all text-xs">
                {request.event.content}
              </pre>
            ) : (
              <span className="text-xs text-muted-foreground">(empty)</span>
            )}
          </div>
        </section>

        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm font-bold text-[var(--ink-violet)]"
          onClick={() => setShowRawJson((value) => !value)}
        >
          <FileJson className="h-4 w-4" />
          {showRawJson ? "Hide raw JSON" : "View raw JSON"}
        </button>

        {showRawJson && (
          <div className="code-panel">
            <pre className="whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(request.event, null, 2)}
            </pre>
          </div>
        )}

        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-muted-foreground">
          <Shield className="h-4 w-4" />
          Keys never leave your browser.
        </p>
      </div>

      <div className="shrink-0 space-y-3 border-t border-border bg-card p-4">
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Button
            variant="outline"
            onClick={handleDeny}
            disabled={isResolving}
            className="h-12"
          >
            <X className="h-4 w-4" />
            Deny
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isResolving}
            className="h-12"
          >
            <Check className="h-4 w-4" />
            Approve & sign
          </Button>
        </div>

        <label className="flex items-center justify-center gap-2 text-sm font-semibold text-muted-foreground">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-input accent-[var(--ink-violet)]"
            checked={rememberChoice}
            onChange={(event) => setRememberChoice(event.target.checked)}
          />
          Do not ask again for this kind from this site
        </label>
      </div>
    </div>
  );
}

function FactRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="ink-row">
      <span className="w-24 shrink-0 text-sm font-semibold text-muted-foreground">
        {label}
      </span>
      <span className={mono ? "font-mono text-xs" : "text-sm font-semibold"}>
        {value}
      </span>
    </div>
  );
}

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
  });
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

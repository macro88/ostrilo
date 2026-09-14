import { useState, useEffect } from "react";
import { useApprovalDisplay } from "./useApprovalDisplay";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { SigningRequest, ApprovalAction, KeyRecord } from "@/domain/types";
import { getKindName } from "@/domain/types";
import { isProtectedKind } from "@/domain/policy/trust-definitions";
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

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

export interface EventDetailViewProps {
  /** The pending request to display */
  request: SigningRequest;
  /** The key that will sign this event */
  signingKey: KeyRecord | null;
  /** Countdown timer in seconds */
  countdown: number;
  /** Callback when user makes a decision */
  onResolve: (action: ApprovalAction) => void;
  /** Callback to return to queue list */
  onBack: () => void;
  /** Whether to show the back button in compact layouts */
  showBackButton?: boolean;
  /** Whether the resolve action is in progress */
  isResolving?: boolean;
  /** Optional layout class */
  className?: string;
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
  showBackButton = true,
  isResolving = false,
  className,
}: EventDetailViewProps) {
  const [rememberChoice, setRememberChoice] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  const kindName = getKindName(request.event.kind);
  const isProtectedEventKind = isProtectedKind(request.event.kind);
  const rememberInputId = `remember-${request.id}`;
  const rememberDescriptionId = `${rememberInputId}-description`;
  const rememberLabel = isProtectedEventKind
    ? "Remember a denial for this site and event kind"
    : "Remember this decision for this site and event kind";
  const {
    origin,
    content: safeContentText,
    hiddenCharacters,
    contentBytes,
    tagBytes,
    signingPubkey,
    approveReady,
  } = useApprovalDisplay(request, signingKey?.pubkey);
  const domain = origin.display;
  const rememberDescription = isProtectedEventKind
    ? "This kind always requires approval before signing. Approving signs only this request."
    : `Future ${kindName.toLowerCase()} requests from ${domain} will use this choice.`;
  const rawEnvelope = {
    ...request.event,
    pubkey: signingPubkey || undefined,
    id: request.eventIdHash,
  };

  const handleApprove = () => {
    onResolve(
      rememberChoice && !isProtectedEventKind ? "allow" : "allow_once"
    );
  };

  const handleDeny = () => {
    onResolve(rememberChoice ? "deny_remember" : "deny");
  };

  return (
    <div
      className={["flex h-full min-h-0 flex-col bg-background", className]
        .filter(Boolean)
        .join(" ")}
      data-testid="approval-detail"
    >
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          {showBackButton && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Back to approval queue"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <h1 className="min-w-0 flex-1 text-lg font-bold">
            {kindName} request
          </h1>
          <span className="seal-chip seal-chip-warning font-mono text-sm">
            {formatCountdown(countdown)}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <section className="flex items-start gap-3">
          <SealMark
            label={domain}
            size="lg"
            className="h-12 w-12 text-xl"
          />
          <div className="min-w-0">
            <h2 className="break-all font-mono text-lg font-bold">
              {domain}
            </h2>
            <p className="text-sm font-semibold text-muted-foreground">
              Wants you to sign {kindName.toLowerCase()}.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="seal-chip seal-chip-accent">Review required</span>
              {origin.insecure && (
                <span className="seal-chip seal-chip-warning">
                  Not a secure connection
                </span>
              )}
              <span className="seal-chip seal-chip-warning font-mono">
                Expires {formatCountdown(countdown)}
              </span>
            </div>
          </div>
        </section>

        <section className="ink-card overflow-hidden">
          <FactRow
            label="Signing as"
            value={
              signingPubkey
                ? truncateMiddle(signingPubkey)
                : signingKey?.label || "Selected key"
            }
            mono
            copyValue={signingPubkey}
            onCopy={copyToClipboard}
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
          {request.eventIdHash && (
            <FactRow
              label="Event ID"
              value={truncateMiddle(request.eventIdHash)}
              mono
              copyValue={request.eventIdHash}
              onCopy={copyToClipboard}
            />
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Content · <span className="font-mono">{contentBytes}</span> bytes
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
          {hiddenCharacters > 0 && (
            <p
              className="seal-chip seal-chip-warning w-full justify-start text-left"
              role="status"
            >
              {hiddenCharacters} hidden or direction-control
              {hiddenCharacters === 1 ? " character is" : " characters are"}{" "}
              present and shown escaped below. They are part of what you would
              be signing.
            </p>
          )}
          {/* Scrolls rather than clips, with the end of the content marked,
              so nothing can be hidden below an invisible fold. */}
          <div className="code-panel min-h-20 max-h-64 overflow-auto">
            {request.event.content ? (
              <>
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {safeContentText}
                </pre>
                <p className="mt-2 border-t border-border pt-1 font-mono text-[10px] text-muted-foreground">
                  end of content · {contentBytes} bytes
                </p>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">(empty)</span>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Tags · <span className="font-mono">{request.event.tags.length}</span> ·{" "}
              <span className="font-mono">{tagBytes}</span> bytes
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() =>
                copyToClipboard(JSON.stringify(request.event.tags, null, 2))
              }
              disabled={request.event.tags.length === 0}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          <JsonPanel
            value={request.event.tags}
            emptyLabel="[]"
            testId="approval-tags-json"
          />
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
          <JsonPanel value={rawEnvelope} testId="approval-raw-json" />
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
            disabled={isResolving || !approveReady}
            className="h-12"
          >
            <Check className="h-4 w-4" />
            Approve &amp; sign
          </Button>
        </div>

        <div
          className="space-y-2 text-sm text-muted-foreground"
          data-testid="remember-scope-copy"
        >
          <div className="flex items-center justify-center gap-2 font-semibold">
            <input
              id={rememberInputId}
              type="checkbox"
              className="h-5 w-5 rounded border-input accent-[var(--ink-violet)]"
              checked={rememberChoice}
              aria-label={rememberLabel}
              aria-describedby={rememberDescriptionId}
              onChange={(event) => setRememberChoice(event.target.checked)}
            />
            <label htmlFor={rememberInputId}>{rememberLabel}</label>
          </div>
          <p className="text-center text-xs font-semibold">
            Kind {request.event.kind} · {kindName}
          </p>
          <p id={rememberDescriptionId} className="text-center text-xs">
            {rememberDescription}
          </p>
        </div>
      </div>
    </div>
  );
}

function FactRow({
  label,
  value,
  mono,
  copyValue,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyValue?: string;
  onCopy?: (value: string) => void;
}) {
  return (
    <div className="ink-row">
      <span className="w-24 shrink-0 text-sm font-semibold text-muted-foreground">
        {label}
      </span>
      <span
        className={
          mono
            ? "min-w-0 flex-1 truncate font-mono text-xs"
            : "min-w-0 flex-1 text-sm font-semibold"
        }
      >
        {value}
      </span>
      {copyValue && onCopy && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onCopy(copyValue)}
          aria-label={`Copy ${label}`}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function JsonPanel({
  value,
  emptyLabel,
  testId,
}: {
  value: unknown;
  emptyLabel?: string;
  testId?: string;
}) {
  const json = JSON.stringify(value, null, 2);

  return (
    <div className="code-panel" data-testid={testId}>
      <pre className="whitespace-pre-wrap break-all text-xs">
        {json ? syntaxHighlightJson(json) : emptyLabel}
      </pre>
    </div>
  );
}

function syntaxHighlightJson(json: string): ReactNode[] {
  const tokenPattern =
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:))|("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(json)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(json.slice(lastIndex, match.index));
    }

    const [token, key, stringValue, literalValue, numberValue] = match;
    const className = key
      ? "text-[var(--ink-violet)]"
      : stringValue
        ? "text-foreground"
        : literalValue
          ? "text-[var(--ink-red)]"
          : numberValue
            ? "text-[var(--ink-amber)]"
            : undefined;

    nodes.push(
      <span key={`${match.index}-${token}`} className={className}>
        {token}
      </span>
    );
    lastIndex = match.index + token.length;
  }

  if (lastIndex < json.length) {
    nodes.push(json.slice(lastIndex));
  }

  return nodes;
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

function truncateMiddle(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 1) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

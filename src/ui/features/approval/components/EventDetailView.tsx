import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type {
  SigningRequest,
  ApprovalAction,
  KeyRecord,
  UnsignedEvent,
} from "@/domain/types";
import { getKindName } from "@/domain/types";
import { isProtectedKind } from "@/domain/policy/trust-definitions";
import type { FormattedOrigin } from "@/domain/display/origin";
import { ArrowLeft, Check, Copy, FileJson, Globe, Shield } from "lucide-react";
import { SealMark } from "@/components/common/SealMark";
import { cn } from "@/lib/utils";
import {
  describeSigningConsequence,
  formatCountdown,
  formatEventTime,
  needsEndOfContentMarker,
  truncateMiddle,
  useApprovalDisplay,
  type OriginTrust,
} from "./useApprovalDisplay";

/*
 * The signing prompt, and the pieces the identity prompt shares with it.
 *
 * Two approval screens share one window, so the header, the origin block, the
 * fact rows and the pinned action bar are defined once here and imported by
 * DisclosureDetailView. A button in the same position must look and behave the
 * same on both screens.
 */

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
  /** Where the origin stands with the user. Absent while settings load. */
  originTrust?: OriginTrust;
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
  originTrust,
  className,
}: EventDetailViewProps) {
  const [rememberChoice, setRememberChoice] = useState(false);
  const copy = useCopyFeedback();

  const kindName = getKindName(request.event.kind);
  const isProtectedEventKind = isProtectedKind(request.event.kind);
  const {
    origin,
    content: safeContentText,
    hiddenCharacters,
    contentBytes,
    tagBytes,
    signingPubkey,
    approveReady,
  } = useApprovalDisplay(request, signingKey?.pubkey);
  const rawEnvelope = {
    ...request.event,
    pubkey: signingPubkey || undefined,
    id: request.eventIdHash,
  };
  // The key's name is shown only when it belongs to the key that will sign.
  // `signingKey` is whichever key the UI has selected, which can differ from
  // the one bound to the request; naming the wrong key next to the right
  // pubkey would tell the user something false about who is signing.
  const signingKeyLabel =
    signingKey && signingKey.pubkey === signingPubkey
      ? signingKey.label
      : undefined;

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
      className={cn("flex h-full min-h-0 flex-col bg-background", className)}
      data-testid="approval-detail"
    >
      <ApprovalHeader
        title={`${kindName} request`}
        countdown={countdown}
        onBack={showBackButton ? onBack : undefined}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <OriginBlock
          origin={origin}
          trust={originTrust}
          sentence={describeSigningConsequence(request.event.kind)}
        />

        <section className="ink-card" aria-label="Request facts">
          <SigningAsRow
            pubkey={signingPubkey}
            keyLabel={signingKeyLabel}
            copy={copy}
          />
          <FactRow
            label="Kind"
            value={
              <>
                <Mono>{request.event.kind}</Mono> · {kindName}
              </>
            }
          />
          <FactRow
            label="Created"
            value={<Mono>{formatEventTime(request.event.created_at)}</Mono>}
          />
        </section>

        <ContentSection
          content={request.event.content}
          safeText={safeContentText}
          bytes={contentBytes}
          hiddenCharacters={hiddenCharacters}
          copy={copy}
        />

        <TagsSection tags={request.event.tags} bytes={tagBytes} copy={copy} />

        <RawJsonSection envelope={rawEnvelope} />
      </div>

      <ApprovalActions
        approveLabel="Approve & sign"
        onApprove={handleApprove}
        onDeny={handleDeny}
        approveDisabled={isResolving || !approveReady}
        denyDisabled={isResolving}
      >
        <RememberControl
          requestId={request.id}
          checked={rememberChoice}
          onChange={setRememberChoice}
          label={
            isProtectedEventKind
              ? "Remember a denial for this site and event kind"
              : "Remember this decision for this site and event kind"
          }
          testId="remember-scope-copy"
        >
          <p className="font-semibold">
            Kind {request.event.kind} · {kindName}
          </p>
          <p>
            {isProtectedEventKind
              ? "This kind always requires approval before signing. Approving signs only this request."
              : `Future ${kindName.toLowerCase()} requests from ${origin.display} will use this choice.`}
          </p>
        </RememberControl>
      </ApprovalActions>
    </div>
  );
}

/** Chrome row: back, the request title, and the countdown. */
export function ApprovalHeader({
  title,
  countdown,
  onBack,
}: {
  title: string;
  countdown: number;
  onBack?: () => void;
}) {
  const remaining = formatCountdown(countdown);
  return (
    <div
      className={cn(
        "flex h-[52px] shrink-0 items-center gap-1 border-b border-border bg-card pr-4",
        onBack ? "pl-1.5 md:pl-4" : "pl-4"
      )}
    >
      {/* Hidden at the two-pane width, where the queue is already beside the
          detail and there is nothing to go back to. */}
      {onBack && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back to approval queue"
          className="h-11 w-11 text-foreground md:hidden"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}
      <h1 className="min-w-0 flex-1 truncate text-[17px] font-bold leading-6">
        {title}
      </h1>
      {/* role=timer is implicitly aria-live=off, so the ticking is not read
          aloud every second. */}
      <span
        role="timer"
        aria-label={`Expires in ${remaining}`}
        className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-[var(--ink-amber)]"
      >
        {remaining}
      </span>
    </div>
  );
}

/** The requesting site: seal, full origin, trust chip, and one sentence. */
export function OriginBlock({
  origin,
  trust,
  sentence,
}: {
  origin: FormattedOrigin;
  trust?: OriginTrust;
  sentence: string;
}) {
  // The seal carries the host's initial. An IP address or a punycode label
  // has no initial worth showing, so those hosts get the globe instead.
  const hasInitial = /^[a-z]/i.test(origin.hostname);
  return (
    <section className="flex items-start gap-3" aria-label="Requesting site">
      {/* Decorative next to the full origin, so hidden from assistive tech. */}
      <span aria-hidden="true" className="contents">
        <SealMark
          icon={hasInitial ? undefined : Globe}
          label={hasInitial ? origin.hostname : undefined}
          size="lg"
          className="h-10 w-10 text-sm"
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="min-w-0 break-all font-mono text-[13px] font-bold leading-5 tracking-tight">
            {origin.display}
          </h2>
          {trust && <TrustChip trust={trust} />}
          {origin.insecure && (
            <span className="seal-chip seal-chip-warning">
              Not a secure connection
            </span>
          )}
        </div>
        <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
          {sentence}
        </p>
      </div>
    </section>
  );
}

// Mint is reserved for the standing grant (§4: mint means go). The two
// intermediate states share the muted tone and are told apart by their words.
const TRUST_CHIP: Record<OriginTrust, { className: string; label: string }> = {
  first_visit: { className: "seal-chip-danger", label: "First visit" },
  known: { className: "bg-muted text-muted-foreground", label: "Known site" },
  medium: { className: "bg-muted text-muted-foreground", label: "Medium trust" },
  trusted: { className: "seal-chip-success", label: "Trusted" },
};

export function TrustChip({ trust }: { trust: OriginTrust }) {
  const chip = TRUST_CHIP[trust];
  return (
    <span className={cn("seal-chip shrink-0", chip.className)}>
      {chip.label}
    </span>
  );
}

/** Label left, value right. Data values are mono; a copy affordance is optional. */
export function FactRow({
  label,
  value,
  detail,
  copyValue,
  onCopy,
  copied,
}: {
  label: string;
  value: ReactNode;
  /** Second line under the value, mono and muted. */
  detail?: string;
  copyValue?: string;
  onCopy?: (value: string) => void;
  copied?: boolean;
}) {
  return (
    <div className="ink-row min-h-11 py-2.5">
      <span className="w-[88px] shrink-0 text-[13px] font-semibold text-muted-foreground">
        {label}
      </span>{" "}
      <div className="min-w-0 flex-1 text-right">
        <div className="truncate text-[13px] font-semibold leading-5">
          {value}
        </div>
        {detail && (
          <div className="truncate font-mono text-[11.5px] leading-4 text-muted-foreground">
            {detail}
          </div>
        )}
      </div>
      {copyValue && onCopy && (
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1.5 h-8 w-8 shrink-0"
          onClick={() => onCopy(copyValue)}
          aria-label={`Copy ${label}`}
        >
          <CopyGlyph copied={Boolean(copied)} />
        </Button>
      )}
    </div>
  );
}

/**
 * The identity row shared by both prompts: the key's name when it is the key
 * that will sign, with the hex pubkey beneath; the pubkey alone otherwise.
 */
export function SigningAsRow({
  label = "Signing as",
  pubkey,
  keyLabel,
  copy,
}: {
  label?: string;
  pubkey: string;
  keyLabel?: string;
  copy: CopyFeedback;
}) {
  const shortKey = pubkey ? truncateMiddle(pubkey) : undefined;
  return (
    <FactRow
      label={label}
      value={keyLabel ?? (shortKey ? <Mono>{shortKey}</Mono> : "Selected key")}
      detail={keyLabel ? shortKey : undefined}
      copyValue={pubkey || undefined}
      onCopy={copy.write}
      copied={copy.copied === pubkey}
    />
  );
}

/**
 * Pinned action bar: the trust line, ghost Deny (1fr) and the notched primary
 * (2fr), with the optional remember control beneath them (§8). The trust line
 * lives here rather than in the scrolling body so it is on screen at the
 * moment of decision regardless of how long the payload is.
 */
export function ApprovalActions({
  approveLabel,
  onApprove,
  onDeny,
  approveDisabled,
  denyDisabled,
  children,
}: {
  approveLabel: string;
  onApprove: () => void;
  onDeny: () => void;
  approveDisabled: boolean;
  denyDisabled: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="shrink-0 border-t border-border bg-card px-4 pb-4 pt-2.5">
      <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Shield className="h-3.5 w-3.5" aria-hidden="true" />
        Keys never leave your browser.
      </p>
      <div className="mt-2.5 grid grid-cols-[1fr_2fr] gap-3">
        <Button
          variant="outline"
          onClick={onDeny}
          disabled={denyDisabled}
          className="h-12"
        >
          Deny
        </Button>
        <Button onClick={onApprove} disabled={approveDisabled} className="h-12">
          {approveLabel}
        </Button>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/**
 * The remember checkbox. Its scope text is revealed when the box is ticked -
 * that is the moment the scope of the choice matters - but stays in the DOM
 * so aria-describedby can still reach it.
 */
export function RememberControl({
  requestId,
  checked,
  onChange,
  label,
  testId,
  children,
}: {
  requestId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  testId: string;
  children: ReactNode;
}) {
  const inputId = `remember-${requestId}`;
  const descriptionId = `${inputId}-description`;
  return (
    <div className="text-[12.5px] text-muted-foreground" data-testid={testId}>
      <label
        htmlFor={inputId}
        className="flex cursor-pointer items-start gap-2.5 font-semibold leading-5"
      >
        <input
          id={inputId}
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ink-violet)]"
          checked={checked}
          aria-describedby={descriptionId}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      <div
        id={descriptionId}
        hidden={!checked}
        className="mt-1.5 pl-[26px] text-xs leading-[1.45]"
      >
        {children}
      </div>
    </div>
  );
}

export interface CopyFeedback {
  /** The value most recently copied, for 1.5 s. */
  copied: string | null;
  write: (text: string) => void;
}

/**
 * Clipboard writes with a brief confirmation. Which value was copied is kept,
 * so only the affordance that was pressed shows the check.
 */
export function useCopyFeedback(): CopyFeedback {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const write = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(text),
      () => setCopied(null)
    );
  };

  return { copied, write };
}

function ContentSection({
  content,
  safeText,
  bytes,
  hiddenCharacters,
  copy,
}: {
  content: string;
  safeText: string;
  bytes: number;
  hiddenCharacters: number;
  copy: CopyFeedback;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="section-label">
          Content · <span className="font-mono">{bytes}</span> bytes
        </h3>
        <CopyButton text={content} copy={copy} />
      </div>
      {hiddenCharacters > 0 && (
        <p
          className="rounded-[10px] bg-[var(--ink-amber-soft)] px-3 py-2 text-xs font-semibold leading-[1.45] text-[var(--ink-amber)]"
          role="status"
        >
          {hiddenCharacters} hidden or direction-control
          {hiddenCharacters === 1 ? " character is" : " characters are"} present
          and shown escaped below. They are part of what you would be signing.
        </p>
      )}
      {/* Scrolls rather than clips, with the end of long content marked, so
          nothing can be hidden below an invisible fold. */}
      <div className="code-panel min-h-16 max-h-60">
        {content ? (
          <>
            <pre className="whitespace-pre-wrap break-all">{safeText}</pre>
            {needsEndOfContentMarker(content) && (
              <p className="mt-1.5 border-t border-border pt-1 text-[10.5px] text-muted-foreground">
                end of content
              </p>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">(empty)</span>
        )}
      </div>
    </section>
  );
}

/**
 * An event with no tags has nothing to show here; the raw JSON still carries
 * the empty array for anyone who wants to see it.
 */
function TagsSection({
  tags,
  bytes,
  copy,
}: {
  tags: UnsignedEvent["tags"];
  bytes: number;
  copy: CopyFeedback;
}) {
  if (tags.length === 0) return null;
  const json = JSON.stringify(tags, null, 2);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="section-label">
          Tags · <span className="font-mono">{tags.length}</span> ·{" "}
          <span className="font-mono">{bytes}</span> bytes
        </h3>
        <CopyButton text={json} copy={copy} />
      </div>
      <JsonPanel json={json} testId="approval-tags-json" />
    </section>
  );
}

function RawJsonSection({ envelope }: { envelope: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="inline-flex h-9 w-fit items-center gap-2 rounded-lg text-[13px] font-bold text-[var(--ink-violet)]"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <FileJson className="h-4 w-4" aria-hidden="true" />
        {open ? "Hide raw JSON" : "View raw JSON"}
      </button>
      {open && (
        <JsonPanel
          json={JSON.stringify(envelope, null, 2)}
          testId="approval-raw-json"
          // Opened from a toggle that may sit at the fold; bring the panel up
          // so the toggle does not appear to have done nothing.
          ref={(element) => element?.scrollIntoView?.({ block: "nearest" })}
        />
      )}
    </div>
  );
}

function CopyButton({ text, copy }: { text: string; copy: CopyFeedback }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-mr-2 h-8 px-2 text-xs"
      onClick={() => copy.write(text)}
      disabled={!text}
    >
      <CopyGlyph copied={copy.copied === text} />
      Copy
    </Button>
  );
}

function CopyGlyph({ copied }: { copied: boolean }) {
  return copied ? (
    <Check className="h-3.5 w-3.5 text-[var(--ink-mint)]" />
  ) : (
    <Copy className="h-3.5 w-3.5" />
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[12.5px]">{children}</span>;
}

function JsonPanel({
  json,
  testId,
  ref,
}: {
  json: string;
  testId?: string;
  ref?: (element: HTMLDivElement | null) => void;
}) {
  return (
    <div className="code-panel" data-testid={testId} ref={ref}>
      <pre className="whitespace-pre-wrap break-all">
        {syntaxHighlightJson(json)}
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

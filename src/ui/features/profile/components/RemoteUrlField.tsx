import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy, ExternalLink } from "lucide-react";
import { isAllowedRemoteUrl } from "@/domain/profile/types";
import { ProfileAddRow } from "./ProfileField";

interface RemoteUrlFieldProps {
  label: string;
  value?: string;
  /**
   * Opens the editor on this field. An empty URL row is then a control rather
   * than a line of grey prose - see `ProfileAddRow`.
   */
  onAdd: () => void;
  /**
   * Description of what the URL points at, used in the "open" control's
   * accessible name.
   */
  openLabel?: string;
  /**
   * The first fetch is still out. The value slot shows the same placeholder
   * bar as `ProfileField`, so the card loads as one piece rather than row by
   * row.
   */
  loading?: boolean;
}

/**
 * Show a URL that a remote party chose, without the extension fetching it.
 *
 * The host is picked by a relay, and this page holds the signing session, so
 * rendering the URL as an image source would hand that host the user's IP
 * address and a visit signal on every render. The URL is shown as monospace
 * data with a copy affordance instead - the same treatment the codebase gives
 * npub values - and opening it is an explicit action in an ordinary tab.
 *
 * Rendered as one row of the grouped profile card; the label is a level-3
 * heading for the same reasons as `ProfileField`.
 */
export function RemoteUrlField({
  label,
  value,
  onAdd,
  openLabel,
  loading = false,
}: RemoteUrlFieldProps) {
  const [copied, setCopied] = useState(false);
  const hasValue = isAllowedRemoteUrl(value);

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn("Could not copy to clipboard:", error);
    }
  };

  const handleOpen = () => {
    if (!hasValue) return;
    window.open(value, "_blank", "noopener,noreferrer");
  };

  if (!loading && !hasValue) {
    return <ProfileAddRow label={label} onAdd={onAdd} />;
  }

  // `relative` keeps the visually hidden live region inside the row; an
  // absolutely positioned span with no positioned ancestor is laid out against
  // the document and can stretch the popup past its viewport.
  return (
    <div className="ink-row relative min-h-[52px] justify-between">
      <h3 className="shrink-0 text-sm font-semibold text-foreground">
        {label}
      </h3>
      {loading ? (
        <span
          className="my-1 inline-block h-2.5 w-24 rounded-sm bg-muted motion-safe:animate-pulse"
          aria-hidden="true"
        />
      ) : (
        <div className="flex min-w-0 items-center gap-0.5">
          <span className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">
            {value}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 p-0"
            onClick={handleCopy}
            aria-label={`Copy ${label}`}
          >
            {copied ? (
              <Check className="h-4 w-4 text-[var(--ink-mint)]" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 p-0"
            onClick={handleOpen}
            aria-label={openLabel ?? `Open ${label} in a new tab`}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <span className="sr-only" aria-live="polite">
            {copied ? "Copied" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

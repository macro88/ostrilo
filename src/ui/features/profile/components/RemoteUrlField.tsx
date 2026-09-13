import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink } from "lucide-react";
import { isAllowedRemoteUrl } from "@/domain/profile/types";

interface RemoteUrlFieldProps {
  label: string;
  value?: string;
  emptyText: string;
  /**
   * Description of what the URL points at, used in the "open" control's
   * accessible name.
   */
  openLabel?: string;
}

/**
 * Show a URL that a remote party chose, without the extension fetching it.
 *
 * The host is picked by a relay, and this page holds the signing session, so
 * rendering the URL as an image source would hand that host the user's IP
 * address and a visit signal on every render. The URL is shown as monospace
 * data with a copy affordance instead - the same treatment the codebase gives
 * npub values - and opening it is an explicit action in an ordinary tab.
 */
export function RemoteUrlField({
  label,
  value,
  emptyText,
  openLabel,
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

  return (
    <div className="ink-card p-3">
      <h3 className="mb-1 text-sm font-medium">{label}</h3>
      {hasValue ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
            {value}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={handleCopy}
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={handleOpen}
            aria-label={openLabel ?? `Open ${label} in a new tab`}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground" aria-hidden>
            {copied ? "Copied" : ""}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}

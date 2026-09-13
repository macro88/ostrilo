import { Button } from "@/components/ui/button";
import { Check, Copy, AlertTriangle } from "lucide-react";
import type { ClipboardStatus } from "../../backup/useExpiringClipboard";

interface BackupClipboardPanelProps {
  status: ClipboardStatus;
  secondsRemaining: number;
  clearWindowSeconds: number;
  onCopy: () => void;
  onClearNow: () => void;
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * The copy control, its expiry, and what to do when the Clipboard API says no.
 *
 * The interval is stated BEFORE the click, not after. The clear overwrites the
 * clipboard without reading it - reading needs the `clipboardRead` permission -
 * so it can replace something the user copied in the meantime, and the only
 * honest place to say that is next to the button that starts the window.
 */
export function BackupClipboardPanel({
  status,
  secondsRemaining,
  clearWindowSeconds,
  onCopy,
  onClearNow,
}: BackupClipboardPanelProps) {
  const pending = status === "copied" && secondsRemaining > 0;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCopy} className="flex-1">
          {status === "copied" ? (
            <>
              <Check className="mr-2 h-4 w-4" />
              Copied
            </>
          ) : (
            <>
              <Copy className="mr-2 h-4 w-4" />
              Copy key
            </>
          )}
        </Button>
        {pending && (
          <Button variant="outline" onClick={onClearNow} className="flex-1">
            Clear now
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Copying clears the clipboard automatically after {clearWindowSeconds}{" "}
        seconds. Anything else you copy in that window is replaced too.
      </p>

      {pending && (
        <div
          className="flex items-center gap-2 text-xs text-[var(--ink-amber)]"
          role="status"
        >
          <span>Clipboard clears in</span>
          <span className="font-mono" data-testid="clipboard-countdown">
            {formatCountdown(secondsRemaining)}
          </span>
        </div>
      )}

      {status === "cleared" && (
        <div className="seal-chip seal-chip-success flex" role="status">
          <Check className="h-4 w-4" />
          Clipboard cleared
        </div>
      )}

      {status === "copy-failed" && (
        <div className="seal-chip seal-chip-danger flex" role="alert">
          <AlertTriangle className="h-4 w-4" />
          The copy did not happen. Write the key down from the panel below
          instead.
        </div>
      )}

      {status === "clear-failed" && (
        <div className="seal-chip seal-chip-danger flex" role="alert">
          <AlertTriangle className="h-4 w-4" />
          Could not clear the clipboard. Copy something else to overwrite it.
        </div>
      )}
    </div>
  );
}

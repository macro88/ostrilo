import { Button } from "@/components/ui/button";
import { Check, AlertTriangle } from "lucide-react";
import type { ClipboardStatus } from "../../backup/useExpiringClipboard";

interface BackupClipboardStatusProps {
  status: ClipboardStatus;
  secondsRemaining: number;
  clearWindowSeconds: number;
  onClearNow: () => void;
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * What the copy control does to the clipboard, its expiry, and what to do when
 * the Clipboard API says no. The button itself is rendered by the step, in the
 * same row as the encrypted export; this is the line underneath.
 *
 * The interval is stated BEFORE the click, not after. The clear overwrites the
 * clipboard without reading it - reading needs the `clipboardRead` permission -
 * so it can replace something the user copied in the meantime, and the only
 * honest place to say that is next to the button that starts the window. Once
 * the window is running, the countdown replaces that line.
 */
export function BackupClipboardStatus({
  status,
  secondsRemaining,
  clearWindowSeconds,
  onClearNow,
}: BackupClipboardStatusProps) {
  const pending = status === "copied" && secondsRemaining > 0;

  return (
    <div className="mt-2 text-xs leading-snug text-muted-foreground">
      {pending ? (
        <div
          className="flex items-center justify-between gap-2 text-[var(--ink-amber)]"
          role="status"
        >
          <span>
            Clipboard clears in{" "}
            <span className="font-mono" data-testid="clipboard-countdown">
              {formatCountdown(secondsRemaining)}
            </span>
          </span>
          {/* 44px hit box in a 24px line: the negative margins keep the row
              tight while the target stays the size the rules ask for. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearNow}
            className="-my-2.5 h-11 px-2 text-xs font-semibold text-foreground"
          >
            Clear now
          </Button>
        </div>
      ) : (
        <p>
          Copying clears the clipboard automatically after {clearWindowSeconds}{" "}
          seconds. Anything else you copy in that window is replaced too.
        </p>
      )}

      {status === "cleared" && (
        <p
          className="mt-1.5 flex items-center gap-1.5 font-semibold text-[var(--ink-mint)]"
          role="status"
        >
          <Check className="h-3.5 w-3.5" />
          Clipboard cleared
        </p>
      )}

      {status === "copy-failed" && (
        <p
          className="mt-1.5 flex items-start gap-1.5 font-medium text-destructive"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The copy did not happen. Write the key down from the panel below
            instead.
          </span>
        </p>
      )}

      {status === "clear-failed" && (
        <p
          className="mt-1.5 flex items-start gap-1.5 font-medium text-destructive"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Could not clear the clipboard. Copy something else to overwrite it.
          </span>
        </p>
      )}
    </div>
  );
}

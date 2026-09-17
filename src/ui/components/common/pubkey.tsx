import { useEffect, useRef, useState } from "react";
import { Check, Copy, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { QRCodeModal } from "./qr-code";

interface PubkeyProps {
  pubkey: string;
  label?: string;
  startChars?: number; // number of chars to show at start
  endChars?: number; // number of chars to show at end
  className?: string;
  /**
   * `inline` (default): a mono chip with icon actions, for a row.
   * `block`: the identity object on Home - section label over the npub, with
   * Copy and QR as icon buttons on the right. Fills an `.ink-card`; while a
   * copy is fresh the label reads "Copied" in mint.
   */
  layout?: "inline" | "block";
}

const COPIED_FEEDBACK_MS = 1500;

const ICON_ACTION_CLASS =
  "flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground";

export function Pubkey({
  pubkey,
  label,
  startChars = 8,
  endChars = 6,
  className = "",
  layout = "inline",
}: PubkeyProps) {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const display = pubkey
    ? `${pubkey.slice(0, startChars)}…${pubkey.slice(-endChars)}`
    : "";

  const markCopied = () => {
    setCopied(true);
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(
      () => setCopied(false),
      COPIED_FEEDBACK_MS
    );
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pubkey);
      markCopied();
    } catch {
      // best-effort fallback
      const ta = document.createElement("textarea");
      ta.value = pubkey;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        markCopied();
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  // Public key only. tests/security/qr-public-key-only.test.tsx pins this.
  const qrModal = showQR && (
    <QRCodeModal
      value={pubkey}
      title="Public Key"
      onClose={() => setShowQR(false)}
    />
  );

  if (layout === "block") {
    return (
      <>
        <div
          role="group"
          aria-label="Public key display"
          className={cn(
            "flex items-center justify-between gap-3 px-4 py-3",
            className
          )}
        >
          <div className="min-w-0 flex-1">
            {(label || copied) && (
              <span
                className={cn(
                  "section-label block",
                  copied && "text-[var(--ink-mint)]"
                )}
                aria-live="polite"
              >
                {copied ? "Copied" : label}
              </span>
            )}
            {/* The screen's title, in the title band of the type scale rather
                than the mono-data band: on a signer's home the public key is
                the most important thing present, and it has to out-weigh the
                rows beneath it for the screen to have a first read. */}
            <span className="mt-0.5 block truncate font-mono text-[20px] font-bold leading-tight tracking-[-0.01em] text-foreground">
              {display}
            </span>
          </div>
          <div className="-mr-2 flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy public key"
              className={ICON_ACTION_CLASS}
            >
              {copied ? (
                <Check
                  className="size-5 text-[var(--ink-mint)]"
                  aria-hidden="true"
                />
              ) : (
                <Copy className="size-5" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowQR(true)}
              aria-label="Show QR code"
              className={ICON_ACTION_CLASS}
            >
              <QrCode className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        {qrModal}
      </>
    );
  }

  return (
    <>
      <div
        role="group"
        aria-label="Public key display"
        className={cn(
          "flex w-full items-center justify-between gap-3",
          className
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {label && (
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              {label}
            </span>
          )}
          <span className="shrink-0 whitespace-nowrap rounded-lg bg-muted px-2.5 py-1 font-mono text-xs font-semibold">
            {display}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Show QR code"
            onClick={() => setShowQR(true)}
            className="size-9"
          >
            <QrCode className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Copy public key"
            onClick={handleCopy}
            className="size-9"
          >
            {copied ? (
              <Check className="size-4 text-[var(--ink-mint)]" />
            ) : (
              <Copy className="size-4" />
            )}
          </Button>
          <span
            className={cn("text-xs text-muted-foreground", copied && "ml-1")}
            aria-live="polite"
          >
            {copied ? "Copied" : ""}
          </span>
        </div>
      </div>

      {qrModal}
    </>
  );
}

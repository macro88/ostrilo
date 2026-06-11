import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, QrCode } from "lucide-react";
import { QRCodeModal } from "./qr-code";

interface PubkeyProps {
  pubkey: string;
  label?: string;
  startChars?: number; // number of chars to show at start
  endChars?: number; // number of chars to show at end
  className?: string;
}

export function Pubkey({
  pubkey,
  label,
  startChars = 8,
  endChars = 6,
  className = "",
}: PubkeyProps) {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const display = pubkey
    ? `${pubkey.slice(0, startChars)}…${pubkey.slice(-endChars)}`
    : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pubkey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
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
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  return (
    <>
      <div
        className={`flex items-center justify-between gap-3 w-full ${className}`}
        role="group"
        aria-label="Public key display"
      >
        <div className="flex items-center gap-3 min-w-0">
          {label && (
            <span className="text-sm text-muted-foreground truncate">
              {label}
            </span>
          )}
          <span className="truncate whitespace-nowrap rounded-full bg-muted px-3 py-1 font-mono text-sm">
            {display}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Show QR code"
            onClick={() => setShowQR(true)}
            className="h-8 w-8 p-0"
          >
            <QrCode className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Copy public key"
            onClick={handleCopy}
            className="h-8 w-8 p-0"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-xs text-muted-foreground" aria-hidden>
            {copied ? "Copied" : ""}
          </span>
        </div>
      </div>

      {showQR && (
        <QRCodeModal
          value={pubkey}
          title="Public Key"
          onClose={() => setShowQR(false)}
        />
      )}
    </>
  );
}

import { useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X } from "lucide-react";

interface QRCodeProps {
  value: string;
  size?: number;
  level?: "L" | "M" | "Q" | "H";
  includeMargin?: boolean;
  className?: string;
}

/**
 * Reusable QR code component that displays a QR code in an SVG format.
 * Optimized for displaying public keys and other text data.
 *
 * The SVG paints its own white quiet zone, so the code scans on the dark
 * surface too; nothing here tints it to the theme.
 */
function QRCode({
  value,
  size = 256,
  level = "M",
  includeMargin = true,
  className = "",
}: QRCodeProps) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <QRCodeSVG
        value={value}
        size={size}
        level={level}
        includeMargin={includeMargin}
        className="rounded-lg"
      />
    </div>
  );
}

interface QRCodeModalProps {
  value: string;
  title?: string;
  onClose: () => void;
  size?: number;
  showValue?: boolean; // Control whether to display the full value below QR code
}

/**
 * QR code modal component for displaying QR codes in a popup overlay.
 * Useful for showing public keys in a larger, scannable format.
 */
export function QRCodeModal({
  value,
  title = "QR Code",
  onClose,
  size = 232,
  showValue = true,
}: QRCodeModalProps) {
  const closeButton = useRef<HTMLButtonElement>(null);

  // A non-modal <dialog open> neither takes focus nor closes on Escape.
  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <dialog
      open
      className="fixed inset-0 z-50 flex h-full w-full max-w-none items-center justify-center bg-[rgb(42_34_56_/_0.35)] p-4 backdrop:bg-transparent"
      aria-modal="true"
      aria-labelledby="qr-code-title"
    >
      <div className="w-full max-w-sm rounded-[12px] border border-border bg-card p-4 text-card-foreground shadow-[var(--elev-overlay)]">
        <div className="mb-3 flex items-center justify-between">
          <h3 id="qr-code-title" className="text-[17px] font-bold">
            {title}
          </h3>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
            aria-label="Close QR code"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <QRCode value={value} size={size} />
        {showValue && (
          <p className="mt-3 break-all text-center font-mono text-xs leading-relaxed text-foreground">
            {value}
          </p>
        )}
      </div>
    </dialog>
  );
}

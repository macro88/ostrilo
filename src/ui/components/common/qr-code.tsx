import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
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
 */
export function QRCode({
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
        className="border-4 border-white rounded-lg"
      />
    </div>
  );
}

interface QRCodeModalProps {
  value: string;
  title?: string;
  onClose: () => void;
  size?: number;
}

/**
 * QR code modal component for displaying QR codes in a popup overlay.
 * Useful for showing public keys in a larger, scannable format.
 */
export function QRCodeModal({
  value,
  title = "QR Code",
  onClose,
  size = 280,
}: QRCodeModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-lg p-6 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            className="h-8 w-8"
            aria-label="Close QR code"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <QRCode value={value} size={size} className="mb-4" />
        <p className="text-xs text-muted-foreground text-center break-all font-mono">
          {value}
        </p>
      </div>
    </div>
  );
}

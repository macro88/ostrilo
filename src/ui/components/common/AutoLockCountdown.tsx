import type { ReactNode } from "react";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { useAppSettings } from "@/hooks/useAppSettings";
import { normalizeAutoLockMinutes } from "@/domain/types";
import { useAutoLockCountdown } from "@/hooks/useAutoLockCountdown";
import { cn } from "@/lib/utils";

/**
 * Ring geometry per size. `sm` matches the header lock button's 44px footprint
 * so the ring wraps the control rather than claiming a slot beside it; `lg` is
 * the settings variant, which has room for its own reading.
 */
const SIZES = {
  sm: { box: 44, stroke: 2, text: "text-[10px]" },
  lg: { box: 72, stroke: 4, text: "text-[13px]" },
} as const;

export interface AutoLockCountdownProps {
  size?: keyof typeof SIZES;
  /**
   * Rendered at the centre of the ring INSTEAD of the reading. The header puts
   * the lock button here; the centre holds one or the other, never both.
   */
  children?: ReactNode;
  className?: string;
}

/**
 * The time remaining before the vault auto-locks, as a draining ring.
 *
 * A readout and nothing else. It does not lock, does not gate anything, and is
 * not the source of truth for whether the vault is locked - `getLockState()`
 * is, and the lock poll corrects any disagreement within a few seconds. It
 * also never records activity: rendering this must not be what postpones the
 * lock it is describing.
 *
 * Drawn as an SVG stroke rather than a `conic-gradient`, which cannot put a
 * hairline track under the arc without a second stacked layer, takes no line
 * cap, and is harder to hold to the theme tokens in both roles. Stroke
 * geometry is exact, themes through the tokens, and needs no dependency.
 */
export function AutoLockCountdown({
  size = "lg",
  children,
  className,
}: AutoLockCountdownProps) {
  const { lockAt } = useKeyManager();
  const { settings } = useAppSettings();
  const windowMs = normalizeAutoLockMinutes(settings.autoLockMinutes) * 60_000;
  const reading = useAutoLockCountdown(lockAt, windowMs);

  // No deadline is not the same as no time left. An older background, or a
  // locked vault, reports nothing - and a ring reading zero would be asserting
  // something it was never told.
  if (reading.state === "unavailable") return children ?? null;

  const { box, stroke, text } = SIZES[size];
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const urgent = reading.state === "seconds" || reading.state === "expired";

  return (
    <div
      role="timer"
      // A live region that spoke every second would be unusable. The reading
      // is available on demand through the accessible name; it does not
      // interrupt. The name carries the remaining time in words, so the
      // sub-minute state is never conveyed by the colour change alone.
      aria-live="off"
      aria-label={reading.label}
      className={cn(
        "relative inline-grid shrink-0 place-items-center",
        urgent ? "text-destructive" : "text-muted-foreground",
        className
      )}
      style={{ width: box, height: box }}
    >
      <svg
        // Decorative: everything it encodes is already in the accessible name.
        aria-hidden="true"
        width={box}
        height={box}
        viewBox={`0 0 ${box} ${box}`}
        className="pointer-events-none absolute inset-0 -rotate-90"
      >
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
        />
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - reading.fraction)}
          // Stepped by default, eased only when motion is welcome - the
          // inverse of the usual guard, so reduced motion is the fallback
          // rather than an exception someone has to remember to write.
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-150 motion-safe:[transition-timing-function:var(--ease-out)]"
        />
      </svg>
      {children ?? (
        <span
          className={cn(
            "z-10 font-mono font-medium tabular-nums",
            reading.state === "expired" ? "text-[10px]" : text
          )}
        >
          {reading.state === "expired"
            ? "Locked"
            : `${reading.value}${reading.state === "seconds" ? "s" : "m"}`}
        </span>
      )}
    </div>
  );
}

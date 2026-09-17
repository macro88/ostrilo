import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type SealTone = "accent" | "success" | "warning" | "danger" | "muted";

interface SealMarkProps {
  icon?: LucideIcon;
  label?: string;
  /**
   * Hide the mark from assistive technology even though `label` is set. Use
   * when the same text is printed right next to the seal, so a screen reader
   * does not announce the initial and then the name.
   */
  decorative?: boolean;
  tone?: SealTone;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const toneClasses: Record<SealTone, string> = {
  accent: "bg-secondary text-secondary-foreground",
  success: "bg-[var(--ink-mint-soft)] text-[var(--ink-mint)]",
  warning: "bg-[var(--ink-amber-soft)] text-[var(--ink-amber)]",
  danger: "bg-[var(--ink-red-soft)] text-[var(--ink-red)]",
  muted: "bg-muted text-muted-foreground",
};

const sizeClasses = {
  sm: "h-5 w-5 text-[10px] [&_svg]:h-3 [&_svg]:w-3",
  md: "h-7 w-7 text-xs [&_svg]:h-3.5 [&_svg]:w-3.5",
  lg: "h-11 w-11 text-base [&_svg]:h-5 [&_svg]:w-5",
};

export function SealMark({
  icon: Icon,
  label,
  decorative = false,
  tone = "accent",
  size = "md",
  className,
}: SealMarkProps) {
  return (
    <span
      className={cn(
        "seal inline-flex shrink-0 items-center justify-center font-bold",
        toneClasses[tone],
        sizeClasses[size],
        className
      )}
      aria-hidden={decorative || !label}
      aria-label={decorative ? undefined : label}
    >
      {Icon ? <Icon /> : label?.slice(0, 1).toUpperCase()}
    </span>
  );
}

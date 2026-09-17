import { cn } from "@/lib/utils";

interface OnboardingStepDotsProps {
  /** Steps in the flow, the welcome screen included. */
  count: number;
  /** Zero-based index of the step on screen. */
  active: number;
  className?: string;
}

/**
 * DESIGN_RULES §7: faceted dots; the active step stretches to an 18px bar.
 *
 * Steps already passed keep the accent so the row reads as progress rather than
 * as a scatter of marks; steps ahead sit at hairline strength. One accent
 * colour, one shape - it is the only violet on the create and import steps
 * apart from the dark-theme primary button.
 */
export function OnboardingStepDots({
  count,
  active,
  className,
}: OnboardingStepDotsProps) {
  return (
    <div
      role="img"
      aria-label={`Step ${active + 1} of ${count}`}
      className={cn("flex items-center justify-center gap-1.5", className)}
    >
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={cn(
            "seal h-2 transition-[width] duration-150",
            index === active ? "w-[18px]" : "w-2",
            index <= active ? "bg-[var(--ink-violet)]" : "bg-[var(--input)]"
          )}
        />
      ))}
    </div>
  );
}

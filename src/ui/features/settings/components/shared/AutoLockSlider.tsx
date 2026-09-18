import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { AUTO_LOCK_BOUNDS, normalizeAutoLockMinutes } from "@/domain/types";
import { useDeferredSliderValue } from "@/hooks/useDeferredSliderValue";

interface AutoLockSliderProps {
  value: number;
  /** Writes the value. Must reject if the password prompt is refused. */
  onChange: (value: number) => Promise<unknown>;
  min?: number;
  max?: number;
  step?: number;
  /** Omit the explanatory sentence; for grouped rows in the popup. */
  compact?: boolean;
}

export function AutoLockSlider({
  value,
  onChange,
  min = AUTO_LOCK_BOUNDS.min,
  max = AUTO_LOCK_BOUNDS.max,
  step = 1,
  compact = false,
}: AutoLockSliderProps) {
  // A stored 0 used to render as "Never", and nothing enforced the timeout, so
  // the label was true for the wrong reason. Both are gone: the value is
  // normalized for display exactly as the background normalizes it for use.
  const { value: minutes, sliderProps } = useDeferredSliderValue(normalizeAutoLockMinutes(value), onChange);

  return (
    <div className="w-full space-y-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <Label className="text-sm font-semibold leading-snug">
          Auto-lock after inactivity
        </Label>
        <span className="text-sm font-medium text-muted-foreground tabular-nums">
          {minutes} min
        </span>
      </div>
      {/*
        The drag updates the thumb; only letting go asks for the password.
        `sliderProps` carries the whole of that - including the pointer-release
        handling Radix cannot be trusted with here. See the hook.
      */}
      <Slider
        {...sliderProps}
        max={max}
        min={min}
        step={step}
        className="w-full"
        aria-label="Auto-lock timeout"
      />
      {!compact && (
        <p className="text-[13px] leading-snug text-muted-foreground">
          Measured from your last activity in the extension, not from when you
          unlocked.
        </p>
      )}
    </div>
  );
}

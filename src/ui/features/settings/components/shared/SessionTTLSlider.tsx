import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  MAX_SESSION_TTL_MINUTES,
  resolveSessionTTLMinutes,
} from "@/domain/policy/session-grants";

interface SessionTTLSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export function SessionTTLSlider({ value, onChange }: SessionTTLSliderProps) {
  const handleChange = (values: number[]) => {
    onChange(values[0]);
  };

  // "Until lock" is no longer offered: it read as a permanent grant whenever
  // the vault did not lock, which until now it never did.
  const minutes = resolveSessionTTLMinutes(value);

  return (
    <div className="w-full space-y-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <Label className="text-sm font-semibold leading-snug">
          Session grant timeout
        </Label>
        <span className="text-sm font-medium text-muted-foreground tabular-nums">
          {minutes} min
        </span>
      </div>
      <Slider
        value={[minutes]}
        onValueChange={handleChange}
        max={MAX_SESSION_TTL_MINUTES}
        min={1}
        step={5}
        className="w-full"
        aria-label="Session grant timeout"
      />
      <p className="text-[13px] leading-snug text-muted-foreground">
        A session grant also ends when the vault locks, whichever comes first.
      </p>
    </div>
  );
}

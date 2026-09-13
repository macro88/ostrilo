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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Session grant timeout</Label>
        <span className="text-sm text-muted-foreground">{minutes} min</span>
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
      <p className="text-xs text-muted-foreground">
        A session grant also ends when the vault locks, whichever comes first.
      </p>
    </div>
  );
}

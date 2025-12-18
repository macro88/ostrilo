import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

interface AutoLockSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function AutoLockSlider({
  value,
  onChange,
  min = 0,
  max = 60,
  step = 5,
}: AutoLockSliderProps) {
  const handleChange = (values: number[]) => {
    onChange(values[0]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Auto-lock after inactivity</Label>
        <span className="text-sm text-muted-foreground">
          {value === 0 ? "Never" : `${value} min`}
        </span>
      </div>
      <Slider
        value={[value]}
        onValueChange={handleChange}
        max={max}
        min={min}
        step={step}
        className="w-full"
      />
    </div>
  );
}

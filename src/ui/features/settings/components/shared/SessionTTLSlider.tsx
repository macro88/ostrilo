import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

interface SessionTTLSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export function SessionTTLSlider({ value, onChange }: SessionTTLSliderProps) {
  const handleChange = (values: number[]) => {
    onChange(values[0]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Session grant timeout</Label>
        <span className="text-sm text-muted-foreground">
          {value === 0 ? "Until lock" : `${value} min`}
        </span>
      </div>
      <Slider
        value={[value]}
        onValueChange={handleChange}
        max={120}
        min={0}
        step={15}
        className="w-full"
      />
    </div>
  );
}

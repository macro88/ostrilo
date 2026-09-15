import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Trash2 } from "lucide-react";

interface ActivityLogConfigProps {
  maxEntries: number;
  onChange: (value: number) => void;
  onClear: () => void;
  onExport?: () => void | Promise<void>;
  exportDisabled?: boolean;
  exportLabel?: string;
}

export function ActivityLogConfig({
  maxEntries,
  onChange,
  onClear,
  onExport,
  exportDisabled = false,
  exportLabel = "Export Log",
}: ActivityLogConfigProps) {
  const handleChange = (values: number[]) => {
    onChange(values[0]);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Max entries to keep</Label>
          <span className="text-sm text-muted-foreground">
            {maxEntries} entries
          </span>
        </div>
        {/*
          The <Label> above is not associated with this control — Radix puts
          `role="slider"` on the Thumb, and a bare <Label> names nothing. Without
          this the retention control announced itself as "slider" and a number,
          on the setting that decides how much signing history is kept.
        */}
        <Slider
          value={[maxEntries]}
          onValueChange={handleChange}
          max={500}
          min={10}
          step={10}
          className="w-full"
          aria-label="Max entries to keep"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => {
            if (
              confirm(
                "Clear all activity log entries? This action cannot be undone."
              )
            ) {
              onClear();
            }
          }}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Clear Log
        </Button>
        {onExport && (
          <Button
            variant="outline"
            className="flex-1"
            onClick={onExport}
            disabled={exportDisabled}
          >
            {exportLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

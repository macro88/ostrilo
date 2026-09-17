import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

interface ActivityLogConfigProps {
  maxEntries: number;
  onChange: (value: number) => void;
  onClear: () => void;
  onExport?: () => void | Promise<void>;
  exportDisabled?: boolean;
  exportLabel?: string;
}

/**
 * One grouped card: how much is kept, then the two things you can do with
 * what is kept. Each action sits at the right of the row that explains it
 * (DESIGN_RULES §7); clearing is a red ghost with a confirm step (§6).
 */
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
    <div className="ink-card">
      <div className="ink-row">
        <div className="w-full space-y-2.5">
          <div className="flex items-baseline justify-between gap-4">
            <Label className="text-sm font-semibold leading-snug">
              Max entries to keep
            </Label>
            <span className="text-sm font-medium text-muted-foreground tabular-nums">
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
          <p className="text-[13px] leading-snug text-muted-foreground">
            Older entries are dropped as new ones arrive.
          </p>
        </div>
      </div>

      {onExport && (
        <div className="ink-row">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-snug">Export</div>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
              Saves the stored entries as a JSON file.
            </p>
          </div>
          <Button
            variant="outline"
            className="h-10"
            onClick={onExport}
            disabled={exportDisabled}
          >
            {exportLabel}
          </Button>
        </div>
      )}

      <div className="ink-row">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug">Clear</div>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
            Removes every stored entry. This cannot be undone.
          </p>
        </div>
        <Button
          variant="destructive"
          className="h-10"
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
          Clear Log
        </Button>
      </div>
    </div>
  );
}

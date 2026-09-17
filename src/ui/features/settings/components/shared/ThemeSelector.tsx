import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Theme } from "@/domain/types";
import { rowSelectTriggerClassName } from "./SettingsLayout";

interface ThemeSelectorProps {
  value: Theme;
  onChange: (theme: Theme) => void;
}

/**
 * One row: "Theme" on the left, the current value and a chevron on the right
 * (DESIGN_RULES §7, "Selects"). Fills whatever row or card it is placed in, so
 * the popup's Settings tab and the options page share one shape.
 */
export function ThemeSelector({ value, onChange }: ThemeSelectorProps) {
  return (
    <div className="flex w-full min-h-8 items-center justify-between gap-4">
      <Label htmlFor="theme" className="text-sm font-semibold leading-snug">
        Theme
      </Label>
      <Select value={value} onValueChange={(v) => onChange(v as Theme)}>
        <SelectTrigger id="theme" size="sm" className={rowSelectTriggerClassName}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
          <SelectItem value="system">System</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

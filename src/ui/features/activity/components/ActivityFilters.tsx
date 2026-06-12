import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMMON_EVENT_KINDS } from "@/domain/types";

interface ActivityFiltersProps {
  visible: boolean;
  originFilter?: string;
  kindFilter?: number;
  origins: string[];
  onOriginChange: (value: string) => void;
  onKindChange: (value: string) => void;
  onClear: () => void;
}

export function ActivityFilters({
  visible,
  originFilter,
  kindFilter,
  origins,
  onOriginChange,
  onKindChange,
  onClear,
}: ActivityFiltersProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="flex gap-2 flex-col sm:flex-row">
      <Select value={originFilter || "all"} onValueChange={onOriginChange}>
        <SelectTrigger className="w-full h-8 text-xs">
          <SelectValue placeholder="All Origins" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Origins</SelectItem>
          {origins.map((origin) => (
            <SelectItem key={origin} value={origin}>
              {new URL(origin).hostname}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={kindFilter?.toString() || "all"}
        onValueChange={onKindChange}
      >
        <SelectTrigger className="w-full h-8 text-xs">
          <SelectValue placeholder="All Kinds" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Kinds</SelectItem>
          {Object.entries(COMMON_EVENT_KINDS).map(([kind, name]) => (
            <SelectItem key={kind} value={kind}>
              {name} ({kind})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(originFilter || kindFilter) && (
        <Button
          variant="outline"
          size="sm"
          onClick={onClear}
          className="w-full h-8 text-xs"
        >
          Clear Filters
        </Button>
      )}
    </div>
  );
}

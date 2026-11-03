import { Button } from "@/components/ui/button";
import { formatOrigin } from "@/domain/display/origin";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMMON_EVENT_KINDS, getKindName } from "@/domain/types";
import { PROTECTED_KINDS } from "@/domain/policy/trust-definitions";

/**
 * The kinds the filter offers: the common set plus every protected kind. A
 * protected kind always prompts, so it is the one most likely to be in the log
 * and the one a user goes looking for; leaving it out of the list made those
 * entries unfilterable.
 */
const FILTER_KINDS: ReadonlyArray<{ kind: number; name: string }> = [
  ...new Set<number>([
    ...Object.keys(COMMON_EVENT_KINDS).map(Number),
    ...PROTECTED_KINDS,
  ]),
]
  .sort((a, b) => a - b)
  .map((kind) => ({
    kind,
    name:
      (COMMON_EVENT_KINDS as Record<number, string>)[kind] ?? getKindName(kind),
  }));

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

  const active = Boolean(originFilter) || kindFilter !== undefined;

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Select value={originFilter || "all"} onValueChange={onOriginChange}>
        <SelectTrigger
          size="sm"
          className="w-full min-w-0 flex-1 text-xs"
          aria-label="Filter by site"
        >
          <SelectValue placeholder="All Origins" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Origins</SelectItem>
          {origins.map((origin) => (
            <SelectItem key={origin} value={origin}>
              {formatOrigin(origin).display}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={kindFilter === undefined ? "all" : String(kindFilter)}
        onValueChange={onKindChange}
      >
        <SelectTrigger
          size="sm"
          className="w-full min-w-0 flex-1 text-xs"
          aria-label="Filter by event kind"
        >
          <SelectValue placeholder="All Kinds" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Kinds</SelectItem>
          {FILTER_KINDS.map(({ kind, name }) => (
            <SelectItem key={kind} value={String(kind)}>
              {name} ({kind})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-8 shrink-0 px-2 text-xs"
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProfileFieldProps {
  label: string;
  value: string;
  loading: boolean;
  /**
   * Long free text (the bio) sits under its label instead of beside it. Short
   * values are right-aligned on the label's line, the way a settings row reads.
   */
  multiline?: boolean;
}

/**
 * One row of the grouped profile card, showing what the profile carries.
 *
 * The label is a level-3 heading: the e2e suite locates a field by the card
 * that carries its heading, and screen readers get a navigable outline of the
 * published profile for free. While the first fetch is in flight the value
 * slot holds a quiet placeholder bar rather than the word "Loading" - the
 * label says what is coming, and the bar says it has not arrived yet.
 */
export function ProfileField({
  label,
  value,
  loading,
  multiline = false,
}: ProfileFieldProps) {
  return (
    <div
      className={cn(
        // 52px: these rows are hit targets once the empty ones are controls,
        // and a settings row that reads as tappable has to be tappable
        // (DESIGN_RULES §11).
        "ink-row min-h-[52px]",
        multiline ? "flex-col items-start gap-1" : "justify-between"
      )}
    >
      <h3 className="shrink-0 text-sm font-semibold text-foreground">
        {label}
      </h3>
      {loading ? (
        <span
          className="my-1 inline-block h-2.5 w-24 rounded-sm bg-muted motion-safe:animate-pulse"
          aria-hidden="true"
        />
      ) : (
        <p
          className={cn(
            "text-sm text-muted-foreground",
            multiline
              ? "whitespace-pre-wrap break-words"
              : "min-w-0 truncate text-right"
          )}
        >
          {value}
        </p>
      )}
    </div>
  );
}

interface ProfileTextFieldProps {
  label: string;
  value?: string;
  loading: boolean;
  multiline?: boolean;
  onAdd: () => void;
}

/**
 * One text field of the profile, in whichever of its three states applies:
 * a placeholder while the first fetch is out, the published value, or - when
 * there is nothing published - a control that opens the editor on it.
 *
 * The choice lives here rather than in the summary so that every field makes
 * it the same way, and the summary stays a list of fields.
 */
export function ProfileTextField({
  label,
  value,
  loading,
  multiline = false,
  onAdd,
}: ProfileTextFieldProps) {
  if (!loading && !value) {
    return <ProfileAddRow label={label} onAdd={onAdd} />;
  }

  return (
    <ProfileField
      label={label}
      loading={loading}
      value={value ?? ""}
      multiline={multiline && Boolean(value)}
    />
  );
}

interface ProfileAddRowProps {
  label: string;
  onAdd: () => void;
}

/**
 * The same row when the field has nothing in it: a control, not a placeholder.
 *
 * An empty field used to render as right-aligned grey prose ("Not set", "Add a
 * bio", "Add your website") that looked like data and did nothing. Every empty
 * field now carries the same verb and opens the editor on that field, so the
 * card reads as four things the user can do rather than four things missing.
 *
 * The label is deliberately NOT an `<h3>` here. ARIA makes every descendant of
 * a button presentational, so a heading inside one is not a heading to anybody
 * - and a field with no content has nothing for a heading to introduce. The
 * whole row is the hit target, which is what keeps it over the 44px floor
 * (DESIGN_RULES §11).
 */
export function ProfileAddRow({ label, onAdd }: ProfileAddRowProps) {
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={`Add ${label}`}
      className="ink-row min-h-[52px] w-full justify-between text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[var(--ink-violet-soft)]"
    >
      <span className="shrink-0 text-sm font-semibold text-foreground">
        {label}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
        Add
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </button>
  );
}

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface KeyFormActionsProps {
  /** Leaves the form without submitting it. Disabled while `pending`. */
  onBack: () => void;
  /** The submit is in flight: both buttons lock and the spinner shows. */
  pending: boolean;
  /** Submit label at rest, e.g. "Create Key". */
  submitLabel: string;
  /** Submit label in flight, e.g. "Creating...". */
  pendingLabel: string;
}

/**
 * The back/submit row shared by the key dialogs' forms.
 *
 * `CreateKeyForm` and `ImportKeyForm` are the same interaction - name a key,
 * re-enter the vault password, commit - and their action rows had drifted into
 * two copies of the same twenty lines, differing only in the two labels and the
 * name of the in-flight flag. The rows are worth sharing rather than the whole
 * form: what the two forms collect genuinely differs (one generates, the other
 * takes a pasted nsec), but "disable everything and show a spinner while the
 * vault is being written" is one behaviour, and it should not be possible to fix
 * it in one dialog and miss the other.
 *
 * Ghost at one part, primary at two, primary on the right (DESIGN_RULES §7).
 */
export function KeyFormActions({
  onBack,
  pending,
  submitLabel,
  pendingLabel,
}: KeyFormActionsProps) {
  return (
    <div className="flex gap-2 pt-1">
      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        disabled={pending}
        className="flex-1"
      >
        Back
      </Button>
      <Button type="submit" disabled={pending} className="flex-[2]">
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
            {pendingLabel}
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </div>
  );
}

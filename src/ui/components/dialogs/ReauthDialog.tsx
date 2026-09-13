import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { PasswordInput } from "@/ui/components/ui/password-input";

/**
 * Collects the password for a high-risk action.
 *
 * This dialog is a convenience, not a control. The action is refused in the
 * background unless a verified password arrives with it, so a caller who skips
 * the dialog gets refused rather than waved through - see
 * `src/infrastructure/messaging/reauth.ts`.
 *
 * No strength meter: this is an existing password being re-entered, and a meter
 * would be telling the user their own password is weak at the exact moment they
 * can do nothing about it.
 */
export interface ReauthDialogProps {
  open: boolean;
  /** What the user is authorizing, in their words. */
  action: string;
  /** The consequence, stated plainly. Shown under the title. */
  consequence?: string;
  error?: string;
  busy?: boolean;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

export function ReauthDialog({
  open,
  action,
  consequence,
  error,
  busy,
  onConfirm,
  onCancel,
}: ReauthDialogProps) {
  const [password, setPassword] = useState("");

  const close = () => {
    // Dropped as soon as the dialog closes. A JS string cannot be wiped, but it
    // must not outlive the dialog in component state.
    setPassword("");
    onCancel();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    onConfirm(password);
    setPassword("");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm with your password</DialogTitle>
          <DialogDescription>
            {action}
            {consequence ? ` ${consequence}` : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <PasswordInput
            label="Password"
            value={password}
            onChange={setPassword}
            error={error}
            disabled={busy}
            idPrefix="reauth"
          />

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={!password || busy}
            >
              {busy ? "Checking…" : "Confirm"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

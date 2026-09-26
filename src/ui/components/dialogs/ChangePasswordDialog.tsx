import { useState } from "react";
import { Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { PasswordInput } from "@/ui/components/ui/password-input";
import { SealMark } from "@/components/common/SealMark";
import { changePassword } from "@/infrastructure/messaging/client";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { countdownDetail } from "@/ui/lib/password-failure";
import { userFacingError } from "@/ui/lib/user-facing-error";

const CHANGE_FAILURE_COPY: Partial<Record<string, string>> = {
  [RPC_ERROR_CODES.INVALID_PASSWORD]: "That is not your current password.",
  [RPC_ERROR_CODES.RATE_LIMITED]:
    "Too many failed attempts. Try again in a moment.",
  [RPC_ERROR_CODES.INVALID_PARAMS]:
    "The new password must differ from the current one.",
  [RPC_ERROR_CODES.VAULT_MIGRATION_PENDING]:
    "One key still uses the old storage format. Lock the vault and unlock it once to finish migrating, then try again.",
  [RPC_ERROR_CODES.VAULT_RECORDS_DAMAGED]:
    "Some keys could not be opened with your password. Remove the damaged key under Keys & Identities, then try again.",
  [RPC_ERROR_CODES.VAULT_UNREADABLE]:
    "This vault could not be read. Update the extension; do not re-create your vault.",
  [RPC_ERROR_CODES.LOCKED]: "The vault is locked. Unlock it and try again.",
};

interface Refusal {
  message: string;
  /** A throttle wait is a warning, not a failure: amber, per DESIGN_RULES §7. */
  wait: boolean;
}

/**
 * The sentence for a refused change. A throttle wait, the pause a wrong
 * password just earned, and a policy failure each arrive with background
 * `details` worth more than local copy - the same rule the lock screen uses.
 */
function describeChangeFailure(error: unknown): Refusal {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  const detail = (error as { rpcError?: { data?: { details?: unknown } } } | null)
    ?.rpcError?.data?.details;
  const wait = code === RPC_ERROR_CODES.RATE_LIMITED;
  if (typeof code === "string" && typeof detail === "string") {
    const countdown = countdownDetail(code, detail);
    if (countdown) return { message: countdown, wait };
  }
  return {
    message: userFacingError(
      error,
      "Could not change the password. Try again.",
      CHANGE_FAILURE_COPY
    ),
    wait,
  };
}

export interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Collects the current and new master password for `vault.changePassword`.
 * All three values are dropped on success, failure and close: a JS string
 * cannot be wiped, but none may outlive the attempt in state.
 */
export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Refusal | undefined>();
  const [done, setDone] = useState(false);

  const clearFields = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const close = () => {
    clearFields();
    setError(undefined);
    setDone(false);
    onClose();
  };

  const canSubmit =
    current.length > 0 && next.length > 0 && next === confirm && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(undefined);
    try {
      await changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(describeChangeFailure(err));
    } finally {
      clearFields();
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && close()}>
      <DialogContent className="w-[calc(100%-2rem)] gap-4 p-5 sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-[17px] font-bold">
            Change master password
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            {done
              ? "Use the new password from now on. This browser stays unlocked."
              : "Your keys are re-encrypted under the new password. Nothing leaves this browser."}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4" data-testid="change-password-success">
            <div className="flex items-start gap-3 rounded-[10px] bg-[var(--ink-mint-soft)] px-3 py-2.5">
              <SealMark icon={Check} tone="success" size="sm" decorative />
              <p className="text-[13px] font-semibold text-[var(--ink-mint)]">
                Master password changed.
              </p>
            </div>
            <p className="text-[13px] text-muted-foreground">
              Encrypted backup files keep the passphrase they were made with.
              The new password does not change them.
            </p>
            <Button type="button" className="w-full" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <PasswordInput
              label="Current password"
              placeholder="Enter your current password"
              value={current}
              onChange={setCurrent}
              disabled={busy}
              idPrefix="change-current"
            />
            <PasswordInput
              label="New password"
              placeholder="Choose a new password"
              value={next}
              onChange={setNext}
              showStrengthMeter
              confirmValue={confirm}
              onConfirmChange={setConfirm}
              confirmLabel="Confirm new password"
              confirmPlaceholder="Enter the new password again"
              disabled={busy}
              idPrefix="change-new"
            />

            {error?.wait && (
              <div
                role="alert"
                className="flex items-center gap-2.5 rounded-[10px] bg-[var(--ink-amber-soft)] px-3 py-2.5 text-[13px] text-[var(--ink-amber)]"
              >
                <SealMark icon={Clock} tone="warning" size="sm" decorative />
                <span>{error.message}</span>
              </div>
            )}
            {error && !error.wait && (
              <div
                role="alert"
                className="rounded-[10px] bg-[var(--ink-red-soft)] px-3 py-2.5 text-[13px] text-[var(--ink-red)]"
              >
                {error.message}
              </div>
            )}

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
              <Button type="submit" className="flex-[2]" disabled={!canSubmit}>
                {busy ? "Changing…" : "Change password"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

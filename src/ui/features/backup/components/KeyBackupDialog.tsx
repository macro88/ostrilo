import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { SealMark } from "@/components/common/SealMark";
import { markKeyBackupVerified } from "@/infrastructure/messaging/client";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { userFacingError } from "@/ui/lib/user-facing-error";
import type { KeyBackupPayload } from "../key-backup-envelope";
import type { BackupTarget } from "../hooks/useKeyBackup";
import { BackupEncryptedExport } from "./BackupEncryptedExport";
import { BackupVerification } from "./BackupVerification";

interface KeyBackupDialogProps {
  target: BackupTarget | null;
  /** An accessor: the key is never a prop. `null` once it has been released. */
  getPayload: () => KeyBackupPayload | null;
  /** The vault locked while the dialog was open. The flow has stopped. */
  lockedMidBackup: boolean;
  /** Fires once the verified backup is in the status record; the key is not needed after it. */
  onRecorded: () => void;
  /** Fires when the background answers that the vault is locked; the key should go. */
  onVaultLocked: () => void;
  /** Drops the key and closes. Runs on every way out. */
  onClose: () => void;
}

const LOCKED_COPY =
  "The vault locked, so the backup was stopped. Nothing was recorded as backed up. Unlock it and start again.";

function LockedPanel() {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-[10px] bg-[var(--ink-amber-soft)] px-3 py-2.5 text-[13px] font-medium text-[var(--ink-amber)]"
    >
      <SealMark icon={Lock} tone="warning" size="sm" decorative />
      <span className="min-w-0">{LOCKED_COPY}</span>
    </div>
  );
}

/**
 * The encrypted-backup dialog for one key, opened after the password reveal.
 *
 * It reuses onboarding's export panel and its file verification, unchanged. The
 * key is never displayed here, so the "re-enter the last characters" route is
 * not offered: the file is the only evidence a Settings backup can give, and it
 * is the stronger one.
 *
 * A key counts as backed up only when the saved file is read back and decrypts
 * to this key. A vault that locks before that point records nothing.
 */
export function KeyBackupDialog({
  target,
  getPayload,
  lockedMidBackup,
  onRecorded,
  onVaultLocked,
  onClose,
}: KeyBackupDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] gap-4 p-5 sm:max-w-md">
        {target && (
          <KeyBackupBody
            key={target.id}
            target={target}
            getPayload={getPayload}
            lockedMidBackup={lockedMidBackup}
            onRecorded={onRecorded}
            onVaultLocked={onVaultLocked}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function KeyBackupBody({
  target,
  getPayload,
  lockedMidBackup,
  onRecorded,
  onVaultLocked,
  onClose,
}: Omit<KeyBackupDialogProps, "target"> & { target: BackupTarget }) {
  const [fileSaved, setFileSaved] = useState(false);
  const [verified, setVerified] = useState(false);
  const [recordError, setRecordError] = useState("");

  const handleVerified = async () => {
    try {
      await markKeyBackupVerified(target.id);
    } catch (error) {
      if ((error as { errorCode?: unknown })?.errorCode === RPC_ERROR_CODES.LOCKED) {
        onVaultLocked();
      }
      setRecordError(
        userFacingError(
          error,
          "The backup checks out, but Ostrilo could not record it. Check the file again.",
          { [RPC_ERROR_CODES.LOCKED]: LOCKED_COPY }
        )
      );
      return;
    }
    setRecordError("");
    setVerified(true);
    onRecorded();
  };

  const checkNsec = (nsec: string) => {
    const held = getPayload()?.nsec;
    return held !== undefined && held === nsec;
  };

  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle className="truncate pr-6 text-[17px] font-bold">
          Back up “{target.label}”
        </DialogTitle>
        <DialogDescription className="text-[13px]">
          {verified
            ? "This key is backed up."
            : "Save an encrypted copy of this key to a file, then check that the file opens."}
        </DialogDescription>
      </DialogHeader>

      {lockedMidBackup ? (
        <LockedPanel />
      ) : verified ? (
        <BackupVerification
          checkNsec={checkNsec}
          verified
          onVerified={handleVerified}
          fileRouteAvailable
        />
      ) : (
        <>
          <BackupEncryptedExport
            getPayload={getPayload}
            onSaved={() => setFileSaved(true)}
            onClose={onClose}
          />
          {fileSaved && (
            <BackupVerification
              checkNsec={checkNsec}
              verified={false}
              onVerified={handleVerified}
              fileRouteAvailable
            />
          )}
          {recordError && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {recordError}
            </p>
          )}
        </>
      )}

      {(verified || lockedMidBackup) && (
        <Button type="button" className="w-full" onClick={onClose}>
          {verified ? "Done" : "Close"}
        </Button>
      )}
    </>
  );
}

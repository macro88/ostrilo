import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { describeViolation } from "@/domain/utils/password-policy";
import { evaluatePasswordStrength } from "@/infrastructure/messaging/client";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import {
  backupFileName,
  createKeyBackup,
  serializeKeyBackup,
  type KeyBackupPayload,
} from "../key-backup-envelope";

interface BackupEncryptedExportProps {
  /**
   * Reads the payload out of the flow's refs at the moment of export. Returning
   * `null` means the reveal was dropped underneath us, which must abort rather
   * than write an empty file.
   */
  getPayload: () => KeyBackupPayload | null;
  onSaved: () => void;
  /** Cancel. The step unmounts the panel, and the passphrase state goes with it. */
  onClose: () => void;
}

type ExportPhase = "prompt" | "working" | "saved";

/**
 * Hands the browser a file without a navigation.
 *
 * The object URL is revoked immediately: it is a live handle to the ciphertext
 * for as long as it exists, and any script in the realm can fetch it.
 */
function saveFile(contents: string, filename: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * The panel behind "Save encrypted backup", the replacement for "Download
 * Backup". The trigger button lives in the backup step's action row; this
 * component is the form it opens.
 *
 * The removed control serialised `{ name, privateKey: nsec, privateKeyHex }` to
 * disk in the clear, with no passphrase and no warning, under a filename that
 * carried the key's name. There is deliberately no plaintext escape hatch, not
 * even behind a typed confirmation: a typed confirmation measures compliance,
 * not comprehension, and the residual risk of a plaintext key file is total and
 * permanent because a Nostr identity cannot be rotated.
 *
 * The passphrase is separate from the master password by design. Sealing the
 * backup under the master password would mean one forgotten password loses the
 * vault and its backup together, and the backup would add no recovery value at
 * all.
 */
export function BackupEncryptedExport({
  getPayload,
  onSaved,
  onClose,
}: BackupEncryptedExportProps) {
  const [phase, setPhase] = useState<ExportPhase>("prompt");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState("");

  /** Drops the passphrase on every exit: success, failure and cancel alike. */
  const dropPassphrase = useCallback(() => {
    setPassphrase("");
    setConfirmPassphrase("");
  }, []);

  const handleCancel = useCallback(() => {
    dropPassphrase();
    setError("");
    onClose();
  }, [dropPassphrase, onClose]);

  const handleSave = useCallback(async () => {
    if (passphrase !== confirmPassphrase) {
      setError("Passphrases do not match.");
      return;
    }

    setError("");
    setPhase("working");
    try {
      const verdict = await evaluatePasswordStrength(passphrase);
      if (!verdict.acceptable) {
        setError(
          verdict.violations.length > 0
            ? describeViolation(verdict.violations[0])
            : "Passphrase does not meet the policy."
        );
        setPhase("prompt");
        return;
      }

      const payload = getPayload();
      if (!payload) {
        setError("The key is no longer available. Reveal it again.");
        setPhase("prompt");
        return;
      }

      const envelope = await createKeyBackup(payload, passphrase);
      saveFile(serializeKeyBackup(envelope), backupFileName());
      setPhase("saved");
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not write the backup."
      );
      setPhase("prompt");
    } finally {
      // Runs on success, on a rejected passphrase, and on a thrown export.
      dropPassphrase();
    }
  }, [
    confirmPassphrase,
    dropPassphrase,
    getPayload,
    onSaved,
    passphrase,
  ]);

  if (phase === "saved") {
    return (
      <div className="mt-3 border-t border-border pt-3">
        <p
          className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-mint)]"
          role="status"
        >
          <Check className="h-3.5 w-3.5" />
          Encrypted backup saved
        </p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          The file is useless without the passphrase you just chose. Ostrilo
          cannot recover it.
        </p>
        <button
          type="button"
          onClick={() => setPhase("prompt")}
          className="-my-2.5 mt-0.5 inline-flex h-11 items-center text-xs font-semibold text-[var(--ink-violet)] hover:underline"
        >
          Save another copy
        </button>
      </div>
    );
  }

  const working = phase === "working";

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-xs leading-snug text-muted-foreground">
        Choose a passphrase for this file. It is separate from your master
        password, is stored nowhere, and cannot be recovered. Lose it and the
        file is unusable.
      </p>

      <div className="mt-3">
        <PasswordInput
          idPrefix="backup"
          label="Backup passphrase"
          placeholder="Passphrase for this file"
          value={passphrase}
          onChange={setPassphrase}
          confirmValue={confirmPassphrase}
          onConfirmChange={setConfirmPassphrase}
          confirmLabel="Confirm backup passphrase"
          confirmPlaceholder="Re-enter the passphrase"
          showStrengthMeter
          disabled={working}
        />
      </div>

      {error && (
        <p
          className="mt-3 flex items-start gap-1.5 text-xs font-medium text-destructive"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          variant="outline"
          onClick={handleCancel}
          disabled={working}
          className="h-11 flex-1"
        >
          Cancel
        </Button>
        {/* Not the notched primary: DESIGN_RULES.md §5 allows one notched CTA
            per screen, and on this screen that is Finish. */}
        <Button
          variant="secondary"
          onClick={handleSave}
          disabled={working || passphrase.length === 0}
          className="h-11 flex-1"
        >
          {working ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Encrypting
            </>
          ) : (
            "Save file"
          )}
        </Button>
      </div>
    </div>
  );
}

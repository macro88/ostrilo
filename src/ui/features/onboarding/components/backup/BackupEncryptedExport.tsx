import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { describeViolation } from "@/domain/utils/password-policy";
import { evaluatePasswordStrength } from "@/infrastructure/messaging/client";
import { AlertTriangle, Check, Download, Loader2 } from "lucide-react";
import {
  backupFileName,
  createKeyBackup,
  serializeKeyBackup,
  type KeyBackupPayload,
} from "../../backup/key-backup-envelope";

interface BackupEncryptedExportProps {
  /**
   * Reads the payload out of the flow's refs at the moment of export. Returning
   * `null` means the reveal was dropped underneath us, which must abort rather
   * than write an empty file.
   */
  getPayload: () => KeyBackupPayload | null;
  onSaved: () => void;
}

type ExportPhase = "closed" | "prompt" | "working" | "saved";

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
 * "Save encrypted backup", the replacement for "Download Backup".
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
}: BackupEncryptedExportProps) {
  const [phase, setPhase] = useState<ExportPhase>("closed");
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
    setPhase("closed");
  }, [dropPassphrase]);

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

  if (phase === "closed") {
    return (
      <Button
        variant="outline"
        onClick={() => setPhase("prompt")}
        className="w-full"
      >
        <Download className="mr-2 h-4 w-4" />
        Save encrypted backup
      </Button>
    );
  }

  if (phase === "saved") {
    return (
      <div className="space-y-2">
        <div className="seal-chip seal-chip-success flex" role="status">
          <Check className="h-4 w-4" />
          Encrypted backup saved
        </div>
        <p className="text-xs text-muted-foreground">
          The file is useless without the passphrase you just chose. Ostrilo
          cannot recover it.
        </p>
        <Button
          variant="outline"
          onClick={() => setPhase("prompt")}
          className="w-full"
        >
          Save another copy
        </Button>
      </div>
    );
  }

  const working = phase === "working";

  return (
    <div className="ink-card space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold">Encrypt the backup file</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          This passphrase is only for this file. It is separate from your master
          password, it is not stored anywhere, and Ostrilo cannot recover it.
          Lose it and the file is unusable.
        </p>
      </div>

      <PasswordInput
        idPrefix="backup"
        label="Backup passphrase"
        placeholder="Enter a passphrase for this file"
        value={passphrase}
        onChange={setPassphrase}
        confirmValue={confirmPassphrase}
        onConfirmChange={setConfirmPassphrase}
        confirmLabel="Confirm backup passphrase"
        confirmPlaceholder="Re-enter the passphrase"
        showStrengthMeter
        disabled={working}
      />

      {error && (
        <div className="seal-chip seal-chip-danger flex" role="alert">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={handleCancel}
          disabled={working}
          className="flex-1"
        >
          Cancel
        </Button>
        {/* Not the notched primary: DESIGN_RULES.md §5 allows one notched CTA
            per screen, and on this screen that is Finish. */}
        <Button
          variant="secondary"
          onClick={handleSave}
          disabled={working || passphrase.length === 0}
          className="flex-1"
        >
          {working ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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

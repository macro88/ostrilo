import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NO_AUTOFILL_PROPS } from "@/components/ui/password-input";
import { AlertTriangle, Check } from "lucide-react";
import {
  BACKUP_DECRYPT_FAILURE_MESSAGE,
  openKeyBackup,
  parseKeyBackupEnvelope,
} from "../key-backup-envelope";

/**
 * How much of the nsec the user re-enters.
 *
 * Full 63-character re-entry is disproportionate: users would paste, which
 * proves nothing, or give up. Eight characters is enough to catch a
 * transcription that went wrong at the end, which is where it goes wrong.
 */
export const VERIFICATION_SUFFIX_LENGTH = 8;

/**
 * Which proofs the flow offers. Explicit rather than inferred from a missing
 * callback, so a caller that forgets the re-entry check is a type error and not
 * a silently weaker verification.
 */
type VerificationModes =
  | {
      /** The user was shown the key, so re-entering its end is evidence. */
      mode: "key-shown";
      /** `true` when a suffix matches the nsec the flow holds. Never gets the key. */
      checkSuffix: (value: string) => boolean;
    }
  | {
      /**
       * The key was never shown, as when backing up from Settings:
       * re-entering characters nobody saw proves nothing, so only the saved
       * file is offered.
       */
      mode: "file-only";
      checkSuffix?: never;
    };

type BackupVerificationProps = VerificationModes & {
  /** `true` when a decrypted backup is the key this flow just created. */
  checkNsec: (nsec: string) => boolean;
  verified: boolean;
  onVerified: () => void;
  /** Offered only once a file has actually been written in this flow. */
  fileRouteAvailable: boolean;
};

type Route = "transcription" | "file";

const FIELD_LABEL_CLASS = "mb-1.5 text-[13px]";

/**
 * Evidence that the key was actually recorded, replacing a checkbox.
 *
 * What this can and cannot prove, stated plainly because the design should not
 * oversell itself: no in-browser check can establish that a key was written on
 * paper, and within the clipboard window the transcription route can be
 * satisfied from the clipboard. The goal is to defeat accidental click-through,
 * which is the common failure. A determined bypass is the user's own risk.
 *
 * The file route is the stronger of the two: it establishes that the file
 * exists, that it is readable, and that the user knows its passphrase - which
 * is exactly what recovery needs.
 */
export function BackupVerification({
  mode,
  checkSuffix,
  checkNsec,
  verified,
  onVerified,
  fileRouteAvailable,
}: BackupVerificationProps) {
  const transcriptionAvailable = mode === "key-shown";
  const [route, setRoute] = useState<Route>(
    transcriptionAvailable ? "transcription" : "file"
  );
  const [suffix, setSuffix] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileTextRef = useRef<string | null>(null);
  const [fileName, setFileName] = useState("");

  // Cleared in the handlers that succeed, not in an effect watching the
  // `verified` prop: reacting to a prop change means an extra render with
  // the secret still in state, and the handler knows the moment it stops
  // being needed.
  useEffect(() => {
    return () => {
      fileTextRef.current = null;
    };
  }, []);

  const handleCheckSuffix = useCallback(() => {
    if (checkSuffix?.(suffix.trim())) {
      setError("");
      setSuffix("");
      setPassphrase("");
      fileTextRef.current = null;
      onVerified();
      return;
    }
    setError(
      `That is not the last ${VERIFICATION_SUFFIX_LENGTH} characters of your key. Reveal it again and check.`
    );
  }, [checkSuffix, onVerified, suffix]);

  const handleFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setError("");
      setFileName(file.name);
      fileTextRef.current = await file.text();
    },
    []
  );

  const handleCheckFile = useCallback(async () => {
    const text = fileTextRef.current;
    if (!text) {
      setError("Choose the backup file you saved.");
      return;
    }
    const envelope = parseKeyBackupEnvelope(text);
    if (!envelope) {
      setError("That file is not an Ostrilo encrypted backup.");
      return;
    }

    setBusy(true);
    try {
      // The plaintext lives for exactly this comparison and is never rendered.
      const payload = await openKeyBackup(envelope, passphrase);
      const matches = checkNsec(payload.nsec);
      payload.nsec = "";
      payload.hex = "";
      if (!matches) {
        setError("That backup holds a different key.");
        return;
      }
      setError("");
      setPassphrase("");
      setSuffix("");
      fileTextRef.current = null;
      onVerified();
    } catch {
      setError(BACKUP_DECRYPT_FAILURE_MESSAGE);
    } finally {
      setBusy(false);
    }
  }, [checkNsec, onVerified, passphrase]);

  if (verified) {
    // Mint, because this is the one "go" state on the step (DESIGN_RULES §2.4).
    return (
      <div
        className="mt-3 flex items-center gap-2.5 px-1 text-sm font-semibold text-[var(--ink-mint)]"
        role="status"
      >
        <span className="seal flex h-6 w-6 shrink-0 items-center justify-center bg-[var(--ink-mint-soft)]">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
        Backup verified
      </div>
    );
  }

  return (
    <div className="ink-card mt-3 p-4">
      <div className="section-label">Check your backup</div>

      {transcriptionAvailable && fileRouteAvailable && (
        <div
          className="mt-2 flex gap-2"
          role="tablist"
          aria-label="Verification method"
        >
          <Button
            variant={route === "transcription" ? "secondary" : "ghost"}
            size="sm"
            role="tab"
            aria-selected={route === "transcription"}
            className="h-10 flex-1"
            onClick={() => {
              setRoute("transcription");
              setError("");
            }}
          >
            Re-enter the key
          </Button>
          <Button
            variant={route === "file" ? "secondary" : "ghost"}
            size="sm"
            role="tab"
            aria-selected={route === "file"}
            className="h-10 flex-1"
            onClick={() => {
              setRoute("file");
              setError("");
            }}
          >
            Use the saved file
          </Button>
        </div>
      )}

      {transcriptionAvailable && (route === "transcription" || !fileRouteAvailable) ? (
        <div className="mt-3">
          <Label htmlFor="backupVerification" className={FIELD_LABEL_CLASS}>
            Last {VERIFICATION_SUFFIX_LENGTH} characters of your nsec
          </Label>
          <div className="flex gap-2">
            <Input
              id="backupVerification"
              type="text"
              value={suffix}
              maxLength={VERIFICATION_SUFFIX_LENGTH}
              // Pasting the answer proves nothing about a backup.
              onPaste={(event) => event.preventDefault()}
              onChange={(event) => setSuffix(event.target.value)}
              className="h-11 min-w-0 flex-1 font-mono text-[13px] tracking-wider"
              {...NO_AUTOFILL_PROPS}
            />
            <Button
              variant="secondary"
              onClick={handleCheckSuffix}
              disabled={suffix.trim().length !== VERIFICATION_SUFFIX_LENGTH}
              className="h-11 px-5"
            >
              Check
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <Label
              htmlFor="backupFile"
              className="btn-ghost flex h-11 w-full cursor-pointer items-center justify-center text-sm"
            >
              {fileName || "Choose backup file"}
            </Label>
            <input
              id="backupFile"
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleFileSelected}
              aria-label="Choose backup file"
            />
          </div>
          <div>
            <Label htmlFor="backupFilePassphrase" className={FIELD_LABEL_CLASS}>
              Backup passphrase
            </Label>
            <Input
              id="backupFilePassphrase"
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              className="h-11 text-sm"
              {...NO_AUTOFILL_PROPS}
            />
          </div>
          <Button
            variant="secondary"
            onClick={handleCheckFile}
            disabled={busy || !fileName || passphrase.length === 0}
            className="h-11 w-full"
          >
            {busy ? "Checking" : "Check file"}
          </Button>
        </div>
      )}

      {error && (
        <p
          className="mt-3 flex items-start gap-1.5 text-xs font-medium text-destructive"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

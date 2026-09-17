import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Check, Copy, Download, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { BackupClipboardStatus } from "./backup/BackupClipboardPanel";
import { BackupEncryptedExport } from "./backup/BackupEncryptedExport";
import { BackupKeyDisplay } from "./backup/BackupKeyDisplay";
import { BackupVerification } from "./backup/BackupVerification";
import type { ClipboardStatus } from "../backup/useExpiringClipboard";
import type { KeyBackupPayload } from "../backup/key-backup-envelope";

interface OnboardingCreateKeyBackupStepProps {
  /**
   * Accessors, not values. The nsec is never a prop: a prop is retained in the
   * element's `memoizedProps` for as long as the fiber lives, which outlasts
   * every ref the flow clears on exit.
   */
  getNsec: () => string | null;
  getBackupPayload: () => KeyBackupPayload | null;
  revealNonce: number;
  showPrivateKey: boolean;
  hasRevealedPrivateKey: boolean;
  showTranscription: boolean;
  clipboardStatus: ClipboardStatus;
  clipboardSecondsRemaining: number;
  clipboardWindowSeconds: number;
  backupFileSaved: boolean;
  verified: boolean;
  acknowledged: boolean;
  revealError: string;
  onReveal: () => void;
  onToggleShowPrivateKey: () => void;
  onToggleTranscription: () => void;
  onCopy: () => void;
  onClearClipboard: () => void;
  onBackupFileSaved: () => void;
  onVerifySuffix: (value: string) => boolean;
  onVerifyNsec: (nsec: string) => boolean;
  onVerified: () => void;
  onAcknowledgedChange: (checked: boolean) => void;
  onBack: () => void;
  onFinish: () => void;
}

/** An nsec is 63 characters: the prefix and 58 data characters. */
const NSEC_DATA_LENGTH = 58;

/**
 * Before the reveal the key panel already stands where the key will appear:
 * the prefix every nsec shares, a run of bullets for the rest, and the reveal
 * button inside the same panel. Nothing here is derived from the key.
 */
function MaskedKeySlot({
  onReveal,
  revealError,
}: {
  onReveal: () => void;
  revealError: string;
}) {
  return (
    <div>
      <div className="section-label">Private Key (nsec format)</div>
      <div
        aria-hidden="true"
        className="mt-2 select-none overflow-hidden whitespace-nowrap font-mono text-[13px] tracking-wide text-[var(--ink-3)]"
      >
        nsec1{"•".repeat(NSEC_DATA_LENGTH)}
      </div>
      <Button
        variant="outline"
        onClick={onReveal}
        className="mt-3 h-11 w-full"
      >
        Reveal Private Key
      </Button>
      {revealError && (
        <p
          className="mt-2 flex items-start gap-1.5 text-xs font-medium text-destructive"
          role="alert"
        >
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{revealError}</span>
        </p>
      )}
    </div>
  );
}

export function OnboardingCreateKeyBackupStep({
  getNsec,
  getBackupPayload,
  revealNonce,
  showPrivateKey,
  hasRevealedPrivateKey,
  showTranscription,
  clipboardStatus,
  clipboardSecondsRemaining,
  clipboardWindowSeconds,
  backupFileSaved,
  verified,
  acknowledged,
  revealError,
  onReveal,
  onToggleShowPrivateKey,
  onToggleTranscription,
  onCopy,
  onClearClipboard,
  onBackupFileSaved,
  onVerifySuffix,
  onVerifyNsec,
  onVerified,
  onAcknowledgedChange,
  onBack,
  onFinish,
}: OnboardingCreateKeyBackupStepProps) {
  // Whether the encrypted-export panel is open. Presentation state only; the
  // passphrase it collects lives inside the panel and leaves with it.
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <div className="flex flex-1 flex-col">
      <div className="screen-header text-center">
        <h2 className="screen-title text-[20px]">Backup Your Key</h2>
        {/* The one hot line. Amber is the warning colour, and this is the
            warning: every other sentence the old panel carried said the same
            thing again. */}
        <p className="mx-auto mt-1.5 max-w-[340px] text-balance text-[13px] font-medium leading-snug text-[var(--ink-amber)]">
          Whoever holds this key controls the identity. Lose it and it is gone
          permanently — no recovery service.
        </p>
      </div>

      {/* The object: one hairline panel that is the key. */}
      <div className="ink-card mt-5 p-4">
        {hasRevealedPrivateKey ? (
          <>
            <BackupKeyDisplay
              getNsec={getNsec}
              revealNonce={revealNonce}
              showPrivateKey={showPrivateKey}
              onToggleShowPrivateKey={onToggleShowPrivateKey}
              showTranscription={showTranscription}
            />

            {/* Copy sizes to its short label; the export, whose label says
                what it does and is what the tests drive, takes the rest. */}
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                onClick={onCopy}
                className="h-11 shrink-0"
              >
                {clipboardStatus === "copied" ? (
                  <>
                    <Check className="h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy key
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setExportOpen((open) => !open)}
                aria-expanded={exportOpen}
                className={cn("h-11 flex-1", exportOpen && "bg-muted")}
              >
                <Download className="h-4 w-4" />
                Save encrypted backup
              </Button>
            </div>

            <BackupClipboardStatus
              status={clipboardStatus}
              secondsRemaining={clipboardSecondsRemaining}
              clearWindowSeconds={clipboardWindowSeconds}
              onClearNow={onClearClipboard}
            />

            <button
              type="button"
              onClick={onToggleTranscription}
              className="-my-2.5 mt-0.5 inline-flex h-11 items-center text-xs font-semibold text-[var(--ink-violet)] hover:underline"
            >
              {showTranscription
                ? "Hide the written-down form"
                : "Show it grouped for writing down"}
            </button>

            {exportOpen && (
              <BackupEncryptedExport
                getPayload={getBackupPayload}
                onSaved={onBackupFileSaved}
                onClose={() => setExportOpen(false)}
              />
            )}
          </>
        ) : (
          <MaskedKeySlot onReveal={onReveal} revealError={revealError} />
        )}
      </div>

      {hasRevealedPrivateKey && (
        <BackupVerification
          checkSuffix={onVerifySuffix}
          checkNsec={onVerifyNsec}
          verified={verified}
          onVerified={onVerified}
          fileRouteAvailable={backupFileSaved}
        />
      )}

      {/* Directly above the actions, so the statement of understanding and
          the button it precedes read as one group whatever the panel above
          is doing. */}
      <div className="mt-auto flex items-start gap-3 px-1 pt-5">
        <input
          id="backupConfirm"
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ink-violet)]"
          checked={acknowledged}
          onChange={(e) => onAcknowledgedChange(e.target.checked)}
          aria-label="Confirm private key backup"
        />
        <Label
          htmlFor="backupConfirm"
          className="block text-xs font-medium leading-snug text-muted-foreground"
        >
          I understand that if I lose this key and my password, no one can
          recover this identity.
        </Label>
      </div>

      <div className="mt-4 flex gap-3">
        <Button variant="outline" onClick={onBack} className="h-12 flex-1">
          Back
        </Button>
        <Button
          onClick={onFinish}
          disabled={!verified}
          className="h-12 flex-[2]"
        >
          Finish
        </Button>
      </div>
    </div>
  );
}

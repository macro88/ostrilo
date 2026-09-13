import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight, CheckCircle, Key, ShieldAlert } from "lucide-react";
import { SealMark } from "@/components/common/SealMark";
import { BackupClipboardPanel } from "./backup/BackupClipboardPanel";
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
  return (
    <div className="space-y-6">
      <div className="screen-header text-center">
        <SealMark
          icon={CheckCircle}
          tone="success"
          size="lg"
          className="mx-auto mb-3"
        />
        <h2 className="screen-title">Backup Your Key</h2>
        <p className="screen-description">
          Record this key now. It is the only thing that can restore your
          identity.
        </p>
      </div>

      {!hasRevealedPrivateKey && (
        <div className="space-y-2">
          <Button variant="secondary" onClick={onReveal} className="w-full">
            Reveal Private Key
          </Button>
          {revealError && (
            <div className="seal-chip seal-chip-danger flex" role="alert">
              <ShieldAlert className="h-4 w-4" />
              {revealError}
            </div>
          )}
        </div>
      )}

      {hasRevealedPrivateKey && (
        <div className="ink-card space-y-4 p-4">
          <BackupKeyDisplay
            getNsec={getNsec}
            revealNonce={revealNonce}
            showPrivateKey={showPrivateKey}
            onToggleShowPrivateKey={onToggleShowPrivateKey}
            showTranscription={showTranscription}
          />

          <BackupClipboardPanel
            status={clipboardStatus}
            secondsRemaining={clipboardSecondsRemaining}
            clearWindowSeconds={clipboardWindowSeconds}
            onCopy={onCopy}
            onClearNow={onClearClipboard}
          />

          <Button variant="ghost" onClick={onToggleTranscription} size="sm">
            {showTranscription
              ? "Hide the written-down form"
              : "Show it grouped for writing down"}
          </Button>

          <BackupEncryptedExport
            getPayload={getBackupPayload}
            onSaved={onBackupFileSaved}
          />
        </div>
      )}

      <div className="rounded-[10px] bg-[var(--ink-amber-soft)] p-4 text-[var(--ink-amber)]">
        <div className="flex items-start gap-3">
          <SealMark icon={Key} tone="warning" />
          <div className="text-sm">
            <div className="mb-1 font-medium">There is no recovery</div>
            <div>
              If you forget your master password and have no backup, this
              identity is gone permanently. No recovery service, no support
              channel and no reset exists — not here, not anywhere. Anyone who
              reads this key controls the identity, so keep it offline and never
              share it.
            </div>
          </div>
        </div>
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

      <div className="flex items-start space-x-2 rounded-xl border border-border bg-card p-3">
        <input
          id="backupConfirm"
          type="checkbox"
          className="mt-1"
          checked={acknowledged}
          onChange={(e) => onAcknowledgedChange(e.target.checked)}
          aria-label="Confirm private key backup"
        />
        <Label htmlFor="backupConfirm" className="text-sm">
          I understand that losing both my master password and my backup means
          this identity cannot be recovered by anyone.
        </Label>
      </div>

      <div className="flex space-x-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onFinish} disabled={!verified} className="flex-1">
          Finish
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

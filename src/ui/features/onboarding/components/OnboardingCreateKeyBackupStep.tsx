import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Copy,
  Download,
  Eye,
  EyeOff,
  Key,
} from "lucide-react";
import { SealMark } from "@/components/common/SealMark";

interface PrivateKeyBackup {
  nsec: string;
  hex: string;
}

interface OnboardingCreateKeyBackupStepProps {
  keyName: string;
  privateKey: PrivateKeyBackup | null;
  showPrivateKey: boolean;
  hasRevealedPrivateKey: boolean;
  copySuccess: boolean;
  backupChecked: boolean;
  onReveal: () => void;
  onToggleShowPrivateKey: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onBack: () => void;
  onBackupCheckedChange: (checked: boolean) => void;
  onFinish: () => void;
}

export function OnboardingCreateKeyBackupStep({
  keyName,
  privateKey,
  showPrivateKey,
  hasRevealedPrivateKey,
  copySuccess,
  backupChecked,
  onReveal,
  onToggleShowPrivateKey,
  onCopy,
  onDownload,
  onBack,
  onBackupCheckedChange,
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
          Save your private key somewhere safe. You'll need it to restore your
          account if you lose access.
        </p>
      </div>

      {!hasRevealedPrivateKey && (
        <Button onClick={onReveal} className="w-full">
          Reveal Private Key
        </Button>
      )}

      {hasRevealedPrivateKey && privateKey && (
        <div className="ink-card space-y-3 p-4">
          <div>
            <Label htmlFor="privateKey">Private Key (nsec format)</Label>
            <div className="relative">
              <Input
                id="privateKey"
                type={showPrivateKey ? "text" : "password"}
                value={privateKey.nsec}
                readOnly
                className="pr-10 font-mono text-sm"
              />
              <button
                type="button"
                onClick={onToggleShowPrivateKey}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                aria-label={showPrivateKey ? "Hide private key" : "Show private key"}
              >
                {showPrivateKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onCopy} className="flex-1">
              {copySuccess ? (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Key
                </>
              )}
            </Button>
            <Button variant="outline" onClick={onDownload} className="flex-1">
              <Download className="mr-2 h-4 w-4" />
              Download Backup
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-[10px] bg-[var(--ink-amber-soft)] p-4 text-[var(--ink-amber)]">
        <div className="flex items-start gap-3">
          <SealMark icon={Key} tone="warning" />
          <div className="text-sm">
            <div className="mb-1 font-medium">Keep it offline</div>
            <div>
              Anyone with access to your private key can control your Nostr
              identity. Never share it with anyone and store it securely.
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-start space-x-2 rounded-xl border border-border bg-card p-3">
        <input
          id="backupConfirm"
          type="checkbox"
          className="mt-1"
          checked={backupChecked}
          onChange={(e) => onBackupCheckedChange(e.target.checked)}
          aria-label="Confirm private key backup"
        />
        <Label htmlFor="backupConfirm" className="text-sm">
          I have safely backed up my private key and understand that I cannot
          recover it if I lose it.
        </Label>
      </div>
      <div className="flex space-x-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onFinish} disabled={!backupChecked} className="flex-1">
          Finish
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

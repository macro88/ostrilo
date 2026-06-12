import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  FileKey,
  Key,
  Upload,
} from "lucide-react";
import { SealMark } from "@/components/common/SealMark";

interface OnboardingImportKeyStepProps {
  keyName: string;
  showPrivateKey: boolean;
  importError: string;
  isLoading: boolean;
  privateKeyRef: RefObject<HTMLInputElement | null>;
  onBack: () => void;
  onKeyNameChange: (value: string) => void;
  onTogglePrivateKey: () => void;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onContinue: () => void;
}

export function OnboardingImportKeyStep({
  keyName,
  showPrivateKey,
  importError,
  isLoading,
  privateKeyRef,
  onBack,
  onKeyNameChange,
  onTogglePrivateKey,
  onFileUpload,
  onContinue,
}: OnboardingImportKeyStepProps) {
  return (
    <div className="space-y-6">
      <div className="screen-header text-center">
        <SealMark icon={FileKey} size="lg" className="mx-auto mb-3" />
        <h2 className="screen-title">Import Your Key</h2>
        <p className="screen-description">
          Import an existing Nostr private key (nsec format)
        </p>
      </div>

      <div className="ink-card space-y-4 p-4">
        <div>
          <Label htmlFor="keyName">Key Name</Label>
          <Input
            id="keyName"
            placeholder="My Imported Key"
            value={keyName}
            onChange={(e) => onKeyNameChange(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="privateKey" className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            Private Key (nsec)
          </Label>
          <div className="relative">
            <Input
              id="privateKey"
              ref={privateKeyRef}
              type={showPrivateKey ? "text" : "password"}
              placeholder="nsec1..."
              className={importError ? "border-destructive pr-16" : "pr-16"}
            />
            <div className="absolute right-1 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
              <button
                type="button"
                onClick={onTogglePrivateKey}
                className="p-1 text-muted-foreground hover:text-foreground"
                aria-label={
                  showPrivateKey ? "Hide private key" : "Show private key"
                }
              >
                {showPrivateKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-[10px] border border-dashed border-border bg-muted/40 p-4">
          <div className="text-center space-y-2">
            <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Or upload a key file
            </div>
            <Label
              htmlFor="file-upload"
              className="inline-flex cursor-pointer items-center rounded-lg border border-input bg-card px-3 py-2 text-sm font-semibold hover:bg-accent hover:text-accent-foreground"
            >
              Choose File
            </Label>
            <input
              id="file-upload"
              type="file"
              accept=".json,.txt,.key"
              onChange={onFileUpload}
              className="hidden"
              aria-label="Upload key file"
            />
          </div>
        </div>

        <div className="rounded-[10px] bg-muted/60 p-3">
          <div className="text-sm">
            <div className="font-medium mb-1">Supported formats:</div>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>nsec1... (bech32 format)</li>
              <li>Hex private key (64 characters)</li>
              <li>Exported JSON key file</li>
            </ul>
          </div>
        </div>

        <div className="rounded-[10px] bg-[var(--ink-amber-soft)] p-3 text-[var(--ink-amber)]">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4" />
            <div className="font-medium text-sm">Security Notice</div>
          </div>
          <div className="text-xs">
            Only import keys you trust. Malicious keys could compromise your
            Nostr identity.
          </div>
        </div>
      </div>

      {importError && (
        <div className="seal-chip seal-chip-danger flex">
          <AlertTriangle className="h-4 w-4" />
          {importError}
        </div>
      )}

      <div className="flex space-x-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onContinue} disabled={isLoading} className="flex-1">
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

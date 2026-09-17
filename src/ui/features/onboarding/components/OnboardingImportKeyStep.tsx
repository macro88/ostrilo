import { useRef, type CSSProperties, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { NO_AUTOFILL_PROPS } from "@/components/ui/password-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Eye, EyeOff, FolderOpen } from "lucide-react";

interface OnboardingImportKeyStepProps {
  keyName: string;
  showPrivateKey: boolean;
  importError: string;
  isLoading: boolean;
  privateKeyRef: RefObject<HTMLInputElement | null>;
  /** Name of a selected Ostrilo encrypted backup, or "" when none is pending. */
  backupFileName: string;
  backupPassphrase: string;
  backupError: string;
  backupBusy: boolean;
  onBack: () => void;
  onKeyNameChange: (value: string) => void;
  onTogglePrivateKey: () => void;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onBackupPassphraseChange: (value: string) => void;
  onUnlockBackup: () => void;
  onCancelBackup: () => void;
  onContinue: () => void;
}

const FIELD_LABEL_CLASS = "mb-1.5 text-[13px]";

export function OnboardingImportKeyStep({
  keyName,
  showPrivateKey,
  importError,
  isLoading,
  privateKeyRef,
  backupFileName,
  backupPassphrase,
  backupError,
  backupBusy,
  onBack,
  onKeyNameChange,
  onTogglePrivateKey,
  onFileUpload,
  onBackupPassphraseChange,
  onUnlockBackup,
  onCancelBackup,
  onContinue,
}: OnboardingImportKeyStepProps) {
  // The file picker is a real button that forwards to the hidden input, so it
  // is reachable from the keyboard. A styled <label> is not focusable.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex flex-1 flex-col">
      <div className="screen-header text-center">
        <h2 className="screen-title text-[20px]">Import Your Key</h2>
        <p className="screen-description mx-auto mt-1.5 max-w-[340px]">
          Paste an nsec1… or hex private key (64 characters), or open an
          Ostrilo encrypted backup.
        </p>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <Label htmlFor="keyName" className={FIELD_LABEL_CLASS}>
            Key Name
          </Label>
          <Input
            id="keyName"
            placeholder="My Imported Key"
            value={keyName}
            onChange={(e) => onKeyNameChange(e.target.value)}
            className="h-11 text-sm"
            {...NO_AUTOFILL_PROPS}
          />
        </div>

        <div>
          <Label htmlFor="privateKey" className={FIELD_LABEL_CLASS}>
            Private Key (nsec)
          </Label>
          <div className="relative">
            {/* No `type="password"`: that attribute is what browser password
                managers key off, so using it to mask an nsec is close to a
                guarantee of capture. Masked with `-webkit-text-security`
                instead, matching the backup step. */}
            <Input
              id="privateKey"
              ref={privateKeyRef}
              type="text"
              placeholder="nsec1…"
              style={
                {
                  WebkitTextSecurity: showPrivateKey ? "none" : "disc",
                } as CSSProperties
              }
              aria-invalid={importError ? true : undefined}
              className="h-11 pr-11 font-mono text-[13px]"
              {...NO_AUTOFILL_PROPS}
            />
            <button
              type="button"
              onClick={onTogglePrivateKey}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground"
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

        <div>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="h-11 w-full"
          >
            <FolderOpen className="h-4 w-4" />
            Open a key file
          </Button>
          <input
            id="file-upload"
            ref={fileInputRef}
            type="file"
            accept=".json,.txt,.key"
            onChange={onFileUpload}
            className="hidden"
            aria-label="Upload key file"
          />
        </div>

        {backupFileName && (
          <div className="ink-card p-4">
            <div className="text-sm font-semibold">
              Encrypted backup: {backupFileName}
            </div>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              Enter the passphrase you chose when you saved this file. It is not
              your master password, and Ostrilo cannot recover it.
            </p>
            <div className="mt-3">
              <Label htmlFor="importBackupPassphrase" className={FIELD_LABEL_CLASS}>
                Backup passphrase
              </Label>
              <Input
                id="importBackupPassphrase"
                type="password"
                value={backupPassphrase}
                onChange={(e) => onBackupPassphraseChange(e.target.value)}
                className="h-11 text-sm"
                {...NO_AUTOFILL_PROPS}
              />
            </div>
            {backupError && (
              <p
                className="mt-3 flex items-start gap-1.5 text-xs font-medium text-destructive"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{backupError}</span>
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                onClick={onCancelBackup}
                disabled={backupBusy}
                className="h-11 flex-1"
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={onUnlockBackup}
                disabled={backupBusy || backupPassphrase.length === 0}
                className="h-11 flex-1"
              >
                {backupBusy ? "Opening" : "Open backup"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {importError && (
        <p className="mt-3 flex items-start gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{importError}</span>
        </p>
      )}

      <div className="mt-auto flex gap-3 pt-6">
        <Button variant="outline" onClick={onBack} className="h-12 flex-1">
          Back
        </Button>
        <Button
          onClick={onContinue}
          disabled={isLoading}
          className="h-12 flex-[2]"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

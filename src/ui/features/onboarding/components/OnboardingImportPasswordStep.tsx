import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Check } from "lucide-react";

interface OnboardingImportPasswordStepProps {
  keyName: string;
  password: string;
  confirmPassword: string;
  passwordError: string;
  hasParsedKey: boolean;
  isLoading: boolean;
  onBack: () => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onImport: () => void;
}

export function OnboardingImportPasswordStep({
  keyName,
  password,
  confirmPassword,
  passwordError,
  hasParsedKey,
  isLoading,
  onBack,
  onPasswordChange,
  onConfirmPasswordChange,
  onImport,
}: OnboardingImportPasswordStepProps) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="screen-header text-center">
        <h2 className="screen-title text-[20px]">Secure Your Key</h2>
        <p className="screen-description mx-auto mt-1.5 max-w-[320px]">
          Choose the master password you will unlock this key with.
        </p>
      </div>

      {/* Mint, because the background parsed the key: this is a "go" state. */}
      {hasParsedKey && (
        <div className="mt-5 flex items-start gap-2.5 rounded-[10px] bg-[var(--ink-mint-soft)] px-3.5 py-3 text-[var(--ink-mint)]">
          <span className="seal mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center bg-[var(--ink-mint)] text-[var(--ink-mint-soft)]">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Key Validated</div>
            <div className="mt-0.5 break-words text-xs">
              Private key "{keyName}" is ready for import
            </div>
          </div>
        </div>
      )}

      <div className={hasParsedKey ? "mt-4" : "mt-5"}>
        <PasswordInput
          label="Master Password"
          placeholder="Choose a strong password"
          value={password}
          onChange={onPasswordChange}
          confirmValue={confirmPassword}
          onConfirmChange={onConfirmPasswordChange}
          showStrengthMeter={true}
          error={passwordError}
          disabled={isLoading}
        />
      </div>

      <div className="mt-auto flex gap-3 pt-6">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isLoading}
          className="h-12 flex-1"
        >
          Back
        </Button>
        <Button
          onClick={onImport}
          disabled={isLoading}
          className="h-12 flex-[2]"
        >
          {isLoading ? "Importing..." : "Import Key"}
        </Button>
      </div>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { ArrowLeft, ArrowRight, CheckCircle, Key } from "lucide-react";
import { SealMark } from "@/components/common/SealMark";

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
    <div className="space-y-6">
      <div className="screen-header text-center">
        <SealMark icon={Key} size="lg" className="mx-auto mb-3" />
        <h2 className="screen-title">Secure Your Key</h2>
        <p className="screen-description">
          Create a strong password to encrypt your imported key
        </p>
      </div>

      <div className="ink-card space-y-4 p-4">
        {hasParsedKey && (
          <div className="seal-chip seal-chip-success flex w-full items-start rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-4 w-4" />
              <div className="font-medium text-sm">Key Validated</div>
            </div>
            <div className="text-xs">
              Private key "{keyName}" is ready for import
            </div>
          </div>
        )}

        <PasswordInput
          label="Master Password"
          placeholder="Enter a strong password"
          value={password}
          onChange={onPasswordChange}
          confirmValue={confirmPassword}
          onConfirmChange={onConfirmPasswordChange}
          showStrengthMeter={true}
          error={passwordError}
          disabled={isLoading}
        />
      </div>

      <div className="flex space-x-3">
        <Button variant="outline" onClick={onBack} disabled={isLoading} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onImport} disabled={isLoading} className="flex-1">
          {isLoading ? "Importing..." : "Import Key"}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

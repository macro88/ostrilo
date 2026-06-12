import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { ArrowLeft, ArrowRight, Key } from "lucide-react";
import { SealMark } from "@/components/common/SealMark";

interface OnboardingCreateKeyInputStepProps {
  keyName: string;
  password: string;
  confirmPassword: string;
  passwordError: string;
  isGenerating: boolean;
  onBack: () => void;
  onKeyNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onGenerate: () => void;
}

export function OnboardingCreateKeyInputStep({
  keyName,
  password,
  confirmPassword,
  passwordError,
  isGenerating,
  onBack,
  onKeyNameChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onGenerate,
}: OnboardingCreateKeyInputStepProps) {
  return (
    <>
      <div className="screen-header text-center">
        <SealMark icon={Key} size="lg" className="mx-auto mb-3" />
        <h2 className="screen-title">Create Your Nostr Key</h2>
        <p className="screen-description">
          Set up a secure password to protect your new identity
        </p>
      </div>

      <div className="ink-card space-y-4 p-4">
        <div>
          <Label htmlFor="keyName">Key Name</Label>
          <Input
            id="keyName"
            placeholder="My Nostr Key"
            value={keyName}
            onChange={(e) => onKeyNameChange(e.target.value)}
          />
        </div>

        <PasswordInput
          label="Master Password"
          placeholder="Enter a strong password"
          value={password}
          onChange={onPasswordChange}
          confirmValue={confirmPassword}
          onConfirmChange={onConfirmPasswordChange}
          showStrengthMeter={true}
          error={passwordError}
        />
      </div>

      <div className="flex space-x-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onGenerate} disabled={isGenerating} className="flex-1">
          {isGenerating ? "Creating..." : "Create Key"}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </>
  );
}

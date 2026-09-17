import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NO_AUTOFILL_PROPS,
  PasswordInput,
} from "@/components/ui/password-input";

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

/**
 * Title, one sentence, three fields, two buttons. The fields sit on the canvas
 * rather than in a card: a hairline box around a form is a box inside the box
 * the popup already is, and it cost 34px of width at 400px.
 */
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
    <div className="flex flex-1 flex-col">
      <div className="screen-header text-center">
        <h2 className="screen-title text-[20px]">Create Your Nostr Key</h2>
        <p className="screen-description mx-auto mt-1.5 max-w-[320px]">
          Name the key, then choose the master password you will unlock it
          with.
        </p>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <Label htmlFor="keyName" className="mb-1.5 text-[13px]">
            Key Name
          </Label>
          {/* The key name is not secret, but it sits in the same form as the
              master password and is the field a manager would offer to fill
              first. Nothing here belongs in an autofill store. */}
          <Input
            id="keyName"
            placeholder="My Nostr Key"
            value={keyName}
            onChange={(e) => onKeyNameChange(e.target.value)}
            className="h-11 text-sm"
            {...NO_AUTOFILL_PROPS}
          />
        </div>

        <PasswordInput
          label="Master Password"
          placeholder="Choose a strong password"
          value={password}
          onChange={onPasswordChange}
          confirmValue={confirmPassword}
          onConfirmChange={onConfirmPasswordChange}
          showStrengthMeter={true}
          error={passwordError}
        />
      </div>

      {/* Pinned to the bottom: ghost 1fr, notched primary 2fr (DESIGN_RULES §7). */}
      <div className="mt-auto flex gap-3 pt-6">
        <Button variant="outline" onClick={onBack} className="h-12 flex-1">
          Back
        </Button>
        <Button
          onClick={onGenerate}
          disabled={isGenerating}
          className="h-12 flex-[2]"
        >
          {isGenerating ? "Creating..." : "Create Key"}
        </Button>
      </div>
    </div>
  );
}

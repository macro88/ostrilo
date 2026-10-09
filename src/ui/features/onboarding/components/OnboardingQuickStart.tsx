import { useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { SealMark } from "@/components/common/SealMark";
import {
  generateKey,
  listKeys,
  unlockVault,
} from "@/infrastructure/messaging/client";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { userFacingError } from "@/ui/lib/user-facing-error";
import { useKeyManager } from "../../authentication/hooks/useKeyManager";
import { newPasswordProblem } from "../validate-new-password";
import { OnboardingStepDots } from "./OnboardingStepDots";

interface OnboardingQuickStartProps {
  onBack: () => void;
  onComplete: () => void;
}

/** The label the vault stores; the user can rename it from Settings. */
export const QUICK_START_KEY_NAME = "My Nostr Key";

export const QUICK_START_NOTICE =
  "This creates a new identity on this browser. You can back it up later. If you lose access to this browser before making a backup, you may lose access to this identity.";

/**
 * Password, one key, one notice, Home. No backup step, no reveal, no download.
 *
 * The key comes from the same `vault.generate` the full flow uses, which
 * records it as having no backup. Nothing here marks it verified.
 *
 * Retrying must never mint a second key. A click while a submit is in flight is
 * dropped by a ref, because state would not be current until the next render.
 * And a retry after a lost reply, or from a second surface, asks the vault
 * whether a key already exists and unlocks it instead of generating again.
 */
export function OnboardingQuickStart({
  onBack,
  onComplete,
}: OnboardingQuickStartProps) {
  const { isLoading } = useKeyManager();
  const [step, setStep] = useState<"password" | "notice">("password");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const inFlight = useRef(false);

  const handleCreate = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsCreating(true);
    try {
      const problem = await newPasswordProblem(password, confirmPassword);
      if (problem) {
        setError(problem);
        return;
      }
      if ((await listKeys()).length === 0) {
        await generateKey(password, QUICK_START_KEY_NAME);
      }
      await unlockVault(password);
      setError("");
      setPassword("");
      setConfirmPassword("");
      setStep("notice");
    } catch (failure) {
      setError(
        userFacingError(failure, "Could not create the key. Try again.", {
          [RPC_ERROR_CODES.INVALID_PASSWORD]:
            "That password was not accepted. Use at least 12 characters, and avoid common passwords and patterns.",
        })
      );
    } finally {
      inFlight.current = false;
      setIsCreating(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col p-4">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <OnboardingStepDots
          count={3}
          active={step === "password" ? 1 : 2}
          className="mb-5"
        />

        {step === "password" && (
          <div className="flex flex-1 flex-col">
            <div className="screen-header text-center">
              <h2 className="screen-title text-[20px]">Quick start</h2>
              <p className="screen-description mx-auto mt-1.5 max-w-[320px]">
                Ostrilo makes one new identity on this browser. Choose the
                password that unlocks it.
              </p>
            </div>

            <div className="mt-5">
              <PasswordInput
                label="Master Password"
                placeholder="Choose a strong password"
                value={password}
                onChange={setPassword}
                confirmValue={confirmPassword}
                onConfirmChange={setConfirmPassword}
                showStrengthMeter={true}
                error={error}
                disabled={isCreating}
              />
            </div>

            <div className="mt-auto flex gap-3 pt-6">
              <Button
                variant="outline"
                onClick={onBack}
                disabled={isCreating}
                className="h-12 flex-1"
              >
                Back
              </Button>
              <Button
                onClick={() => void handleCreate()}
                disabled={isCreating || isLoading}
                className="h-12 flex-[2]"
              >
                {isCreating ? "Creating..." : "Create identity"}
              </Button>
            </div>
          </div>
        )}

        {step === "notice" && (
          <div className="flex flex-1 flex-col">
            <div className="screen-header text-center">
              <h2 className="screen-title text-[20px]">Your identity is ready</h2>
            </div>

            <div
              role="note"
              className="mt-5 flex items-start gap-2.5 rounded-[10px] bg-[var(--ink-amber-soft)] px-3.5 py-3 text-[13px] font-medium leading-[1.45] text-[var(--ink-amber)]"
            >
              <SealMark icon={ShieldAlert} tone="warning" size="sm" decorative />
              <p className="min-w-0">{QUICK_START_NOTICE}</p>
            </div>

            <Button onClick={onComplete} className="mt-auto h-12 w-full" size="lg">
              Continue
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

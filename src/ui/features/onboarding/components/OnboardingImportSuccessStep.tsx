import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

interface OnboardingImportSuccessStepProps {
  keyName: string;
  onStart: () => void;
}

/**
 * The one screen in the import flow where mint is right: the key is in the
 * vault, encrypted, and nothing is left to do but start.
 */
export function OnboardingImportSuccessStep({
  keyName,
  onStart,
}: OnboardingImportSuccessStepProps) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className="seal flex h-14 w-14 items-center justify-center bg-[var(--ink-mint-soft)] text-[var(--ink-mint)]">
          <Check className="h-6 w-6" strokeWidth={2.5} />
        </span>
        <h2 className="screen-title mt-4 text-[20px]">Import Successful</h2>
        <p className="mt-1.5 text-sm font-medium text-foreground">
          "{keyName}" is ready to use
        </p>
        <p className="screen-description mt-1 max-w-[300px]">
          Encrypted with your master password and stored on this device.
        </p>
      </div>

      <Button onClick={onStart} className="mt-auto h-12 w-full" size="lg">
        Get Started
      </Button>
    </div>
  );
}

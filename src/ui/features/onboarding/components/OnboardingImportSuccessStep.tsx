import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle } from "lucide-react";
import { SealMark } from "@/components/common/SealMark";

interface OnboardingImportSuccessStepProps {
  keyName: string;
  onStart: () => void;
}

export function OnboardingImportSuccessStep({
  keyName,
  onStart,
}: OnboardingImportSuccessStepProps) {
  return (
    <div className="space-y-6">
      <div className="screen-header text-center">
        <SealMark
          icon={CheckCircle}
          tone="success"
          size="lg"
          className="mx-auto mb-3"
        />
        <h2 className="screen-title">Import Successful</h2>
        <p className="screen-description">
          Your Nostr key has been securely imported and encrypted
        </p>
      </div>

      <div className="rounded-[10px] bg-[var(--ink-mint-soft)] p-4 text-[var(--ink-mint)]">
        <div className="space-y-2">
          <div className="font-semibold">"{keyName}" is ready to use</div>
          <div className="text-sm">
            Your key is now encrypted and stored securely on this device
          </div>
        </div>
      </div>

      <Button onClick={onStart} className="w-full" size="lg">
        Get Started
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

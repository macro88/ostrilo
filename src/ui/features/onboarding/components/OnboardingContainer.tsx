import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useOnboarding } from "../hooks/useOnboarding";
import { OnboardingWelcome } from "./OnboardingWelcome";
import { OnboardingCreateKey } from "./OnboardingCreateKey";
import { OnboardingImportKey } from "./OnboardingImportKey";

type OnboardingFlow = "welcome" | "create" | "import";

interface OnboardingContainerProps {
  onComplete: () => void;
}

export function OnboardingContainer({ onComplete }: OnboardingContainerProps) {
  const [currentFlow, setCurrentFlow] = useState<OnboardingFlow>("welcome");
  const { markOnboardingComplete } = useOnboarding();

  const handleComplete = async () => {
    await markOnboardingComplete();
    onComplete();
  };

  const handleCreateKey = () => {
    setCurrentFlow("create");
  };

  const handleImportKey = () => {
    setCurrentFlow("import");
  };

  const handleBack = () => {
    setCurrentFlow("welcome");
  };

  return (
    <div className="min-h-screen bg-background">
      {currentFlow === "welcome" && (
        <OnboardingWelcome
          onCreateKey={handleCreateKey}
          onImportKey={handleImportKey}
        />
      )}

      {currentFlow === "create" && (
        <OnboardingCreateKey onBack={handleBack} onComplete={handleComplete} />
      )}

      {currentFlow === "import" && (
        <OnboardingImportKey onBack={handleBack} onComplete={handleComplete} />
      )}
    </div>
  );
}

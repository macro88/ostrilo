import { useState } from "react";
import { useOnboarding } from "../hooks/useOnboarding";
import { OnboardingWelcome } from "./OnboardingWelcome";
import { OnboardingCreateKey } from "./OnboardingCreateKey";
import { OnboardingQuickStart } from "./OnboardingQuickStart";
import { OnboardingImportKey } from "./OnboardingImportKey";

type OnboardingFlow = "welcome" | "create" | "quick" | "import";

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

  const handleQuickStart = () => {
    setCurrentFlow("quick");
  };

  const handleImportKey = () => {
    setCurrentFlow("import");
  };

  const handleBack = () => {
    setCurrentFlow("welcome");
  };

  return (
    <div className="app-canvas min-h-screen bg-background">
      {currentFlow === "welcome" && (
        <OnboardingWelcome
          onCreateKey={handleCreateKey}
          onQuickStart={handleQuickStart}
          onImportKey={handleImportKey}
        />
      )}

      {currentFlow === "create" && (
        <OnboardingCreateKey onBack={handleBack} onComplete={handleComplete} />
      )}

      {currentFlow === "quick" && (
        <OnboardingQuickStart onBack={handleBack} onComplete={handleComplete} />
      )}

      {currentFlow === "import" && (
        <OnboardingImportKey onBack={handleBack} onComplete={handleComplete} />
      )}
    </div>
  );
}

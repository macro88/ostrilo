import { useAppSettings } from "./useAppSettings";
import { useKeyManager } from "./useKeyManager";

/**
 * Hook for first-run detection and onboarding state
 */

export function useOnboarding() {
  const { settings, updateSettings } = useAppSettings();
  const { hasKeys } = useKeyManager();

  const isFirstRun = !hasKeys && !settings.onboardingCompleted;
  const needsOnboarding = isFirstRun;

  const markOnboardingComplete = async () => {
    // Set a flag in settings to indicate onboarding is complete
    // This could be used for showing help tips or other first-time user guidance
    await updateSettings({
      onboardingCompleted: true,
      onboardingCompletedAt: Math.floor(Date.now() / 1000),
    });
  };

  return {
    isFirstRun,
    needsOnboarding,
    hasKeys,
    markOnboardingComplete,
  };
}

import { useCallback, useEffect, useState } from "react";
import type { BiometricStatus } from "@/application/services/biometric-factor.service";
import { IS_CHROMIUM_BUILD } from "@/domain/platform/build-target";
import { biometricStatus } from "@/infrastructure/messaging/client";

/**
 * What the background says about biometric unlock, or null when it says
 * nothing: a build without the feature, or a background that could not be
 * asked. Null renders as no biometric affordance at all.
 */
export function useBiometricStatus(): {
  status: BiometricStatus | null;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<BiometricStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!IS_CHROMIUM_BUILD) return;
    try {
      setStatus(await biometricStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!IS_CHROMIUM_BUILD) return;
    let live = true;
    biometricStatus().then(
      (next) => {
        if (live) setStatus(next);
      },
      () => {
        if (live) setStatus(null);
      }
    );
    return () => {
      live = false;
    };
  }, []);

  return { status, refresh };
}

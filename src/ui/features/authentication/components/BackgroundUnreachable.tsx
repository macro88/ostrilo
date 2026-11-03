import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SealMark } from "@/components/common/SealMark";

interface BackgroundUnreachableProps {
  onRetry: () => void;
  isRetrying?: boolean;
}

/**
 * Shown in place of both the lock screen and the vault when a lock-state
 * request fails.
 *
 * A failed request says nothing about the vault, so this screen does not say
 * it is locked - telling someone to unlock a vault that may be open sends them
 * to type a password for nothing. It shows no vault content either, and the
 * context keeps polling, so it clears itself when the background answers.
 */
export function BackgroundUnreachable({
  onRetry,
  isRetrying = false,
}: BackgroundUnreachableProps) {
  return (
    <div
      className="app-canvas flex h-full flex-col items-center justify-center bg-background px-6 py-6"
      role="alert"
    >
      <SealMark icon={AlertTriangle} tone="warning" size="lg" decorative />
      <h1 className="screen-title mt-4 text-center text-[20px]">
        Can&apos;t reach Ostrilo
      </h1>
      <p className="mt-2 max-w-sm text-center text-[13px] text-muted-foreground">
        Ostrilo&apos;s background did not answer. Your keys and settings are
        unchanged. Try again.
      </p>
      <Button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="mt-4 h-12 w-full max-w-sm"
      >
        {isRetrying ? "Trying..." : "Try again"}
      </Button>
    </div>
  );
}

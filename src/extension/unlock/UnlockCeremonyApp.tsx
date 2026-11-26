import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/ui/components/logo/Logo";
import { useTheme } from "@/ui/hooks/useTheme";
import { biometricForget } from "@/infrastructure/messaging/client";
import { BrowserWebAuthnCeremony } from "@/infrastructure/webauthn/webauthn-ceremony.adapter";
import {
  runUnlockCeremony,
  type UnlockCeremonyOutcome,
} from "@/ui/features/authentication/lib/unlock-ceremony";

type Phase = "asking" | Exclude<UnlockCeremonyOutcome["kind"], "unlocked">;

/**
 * A deleted passkey looks exactly like a dismissed prompt, so the second miss
 * in a row is when forgetting the factor is offered.
 */
const MISSES_BEFORE_OFFERING_FORGET = 2;

const COPY: Record<Phase, { title: string; body: string }> = {
  asking: {
    title: "Confirm it\u2019s you",
    body: "Use your device to unlock Ostrilo.",
  },
  cancelled: {
    title: "Nothing was unlocked",
    body: "The request was dismissed, or the passkey could not be found.",
  },
  password_needed: {
    title: "Your password is needed this time",
    body: "Close this window and unlock with your master password.",
  },
  refused: {
    title: "That did not unlock the vault",
    body: "The passkey no longer matches this vault. Unlock with your master password.",
  },
  paused: {
    title: "Unlocking is paused",
    body: "Too many failed attempts. Try again in a moment.",
  },
  failed: {
    title: "Could not reach the vault",
    body: "Close this window and try again.",
  },
};

/**
 * The window a biometric unlock runs in.
 *
 * It holds no key and no list of keys: it asks the authenticator, hands the
 * answer to the background, and closes. The answer itself never enters React
 * state; see `runUnlockCeremony`.
 */
export default function UnlockCeremonyApp() {
  useTheme();
  const [phase, setPhase] = useState<Phase>("asking");
  const [detail, setDetail] = useState<string>();
  const [misses, setMisses] = useState(0);
  const started = useRef(false);

  const attempt = useCallback(async () => {
    setPhase("asking");
    setDetail(undefined);
    const outcome = await runUnlockCeremony(BrowserWebAuthnCeremony);
    if (outcome.kind === "unlocked") {
      window.close();
      return;
    }
    if (outcome.kind === "cancelled") setMisses((count) => count + 1);
    if (outcome.kind === "paused") setDetail(outcome.detail);
    setPhase(outcome.kind);
  }, []);

  useEffect(() => {
    // StrictMode mounts twice in development; one window is one ceremony.
    if (started.current) return;
    started.current = true;
    void attempt();
  }, [attempt]);

  const forget = async () => {
    await biometricForget();
    window.close();
  };

  const canRetry = phase === "cancelled";
  const offerForget =
    phase === "refused" ||
    (phase === "cancelled" && misses >= MISSES_BEFORE_OFFERING_FORGET);
  const copy = COPY[phase];

  return (
    <main className="app-canvas flex h-screen w-screen flex-col items-center justify-center bg-background px-6 py-6 text-foreground">
      <div className="h-20 w-20">
        <Logo size="max" alt="" />
      </div>
      <h1 className="screen-title mt-5 text-center text-[20px]" aria-live="polite">
        {copy.title}
      </h1>
      <p className="mt-1.5 max-w-xs text-center text-[13px] leading-snug text-muted-foreground">
        {detail ?? copy.body}
      </p>

      <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
        {canRetry && (
          <Button className="h-12 w-full" onClick={() => void attempt()}>
            Try again
          </Button>
        )}
        <Button variant="outline" className="h-11 w-full" onClick={() => window.close()}>
          {phase === "asking" ? "Cancel" : "Close"}
        </Button>
        {offerForget && (
          <>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {phase === "refused"
                ? "You can turn device unlock off here and set it up again in Settings. Your password still opens the vault."
                : "If you deleted the passkey, this can no longer work. Your password still opens the vault."}
            </p>
            <Button variant="ghost" className="h-11 w-full" onClick={() => void forget()}>
              Forget device unlock
            </Button>
          </>
        )}
      </div>
    </main>
  );
}

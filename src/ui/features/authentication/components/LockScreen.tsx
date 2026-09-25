import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { useKeyManager } from "../hooks/useKeyManager";
import { UNLOCK_FAILED, type UnlockResult } from "@/ui/state/KeyManagerContext";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { useEphemeralInputTeardown } from "../hooks/useEphemeralInputTeardown";
import { AlertTriangle, Lock } from "lucide-react";
import { Logo } from "@/ui/components/logo/Logo";
import { SealMark } from "@/components/common/SealMark";

interface LockScreenProps {
  onUnlock?: () => void;
  title?: string;
}

/**
 * Copy for every failure `vault.unlock` can return, chosen here rather than
 * taken from the background.
 *
 * The list is derived from the whole of `handleUnlock`
 * (`src/infrastructure/messaging/handlers/vault-rpc.ts:127-195`): a password
 * that fails `PasswordSchema`, the throttle, an incorrect password, a vault
 * that does not exist, and a vault whose format or KDF parameters cannot be
 * read. Anything the background adds later arrives as an unrecognised code and
 * gets the generic message below - a new background error cannot put unexpected
 * text on this screen.
 *
 * Note that `INVALID_PASSWORD` covers two different causes: the schema-shape
 * failure at `vault-rpc.ts:134` and a genuinely incorrect password at `:164`.
 * The code alone does not tell them apart, which is why its `details` is shown.
 */
const UNLOCK_FAILURE_COPY: Record<string, string> = {
  [RPC_ERROR_CODES.INVALID_PASSWORD]: "Incorrect password.",
  [RPC_ERROR_CODES.RATE_LIMITED]:
    "Too many failed attempts. Unlocking is paused for a moment.",
  [RPC_ERROR_CODES.NO_KEY_SELECTED]:
    "No vault exists yet. Create or import a key before unlocking.",
  [RPC_ERROR_CODES.VAULT_UNREADABLE]:
    "This vault could not be opened. It was written by a different version of Ostrilo, or its stored encryption parameters are not acceptable. Update the extension; do not re-create your vault.",
  [UNLOCK_FAILED]: "Could not reach the vault. Try again.",
};

/**
 * The codes whose `details` the background populates with a countdown the UI
 * cannot compute for itself, so the detail is worth more than the local copy.
 *
 * Only these render it. The residual to keep in mind: for these two codes the
 * detail string is rendered verbatim, so editing it in the background reaches
 * this screen without passing through the UI.
 */
const CODES_CARRYING_A_COUNTDOWN: string[] = [
  RPC_ERROR_CODES.INVALID_PASSWORD,
  RPC_ERROR_CODES.RATE_LIMITED,
];

const GENERIC_UNLOCK_FAILURE = "Could not unlock the vault. Try again.";

export function describeUnlockFailure(
  result: Extract<UnlockResult, { ok: false }>
): string {
  const copy = UNLOCK_FAILURE_COPY[result.code];
  if (!copy) return GENERIC_UNLOCK_FAILURE;
  if (result.detail && CODES_CARRYING_A_COUNTDOWN.includes(result.code)) {
    return result.detail;
  }
  return copy;
}

/**
 * The lock screen is five things, top to bottom: the mascot wearing the lock
 * seal, the title, the field, Unlock, and one honest line at the foot. It used to say
 * "your keys are safe" four different ways and offer a biometric button whose
 * only behaviour was to report that it did not work. Ostrilo has no recovery
 * path by design, so where another wallet puts "Forgot password" this screen
 * says nothing.
 */
export function LockScreen({
  onUnlock,
  title = "Ostrilo is Locked",
}: LockScreenProps) {
  const { unlock, isLoading } = useKeyManager();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const passwordFieldRef = useRef<HTMLInputElement>(null);

  useEphemeralInputTeardown(passwordFieldRef);

  const handleUnlock = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (isLoading) return;

    // Unlock stays enabled on an empty field - a disabled primary reads as a
    // dead control - so this guard is the one that answers an empty submit.
    if (!password.trim()) {
      setError("Enter your master password.");
      return;
    }

    setError("");
    const result = await unlock(password);
    // Dropped on both branches. A JS string cannot be wiped, but it must not
    // outlive the attempt in component state.
    setPassword("");

    if (result.ok) {
      onUnlock?.();
      return;
    }

    // `onUnlock` used to run here too, because `unlock` returned a boolean that
    // nobody read and its `catch` was unreachable.
    setError(describeUnlockFailure(result));
  };

  return (
    <div className="app-canvas flex h-full flex-col items-center bg-background px-6 py-6">
      {/* One group, read top to bottom with no gap wider than a line of type:
          mascot, heading, field, Unlock. `my-auto` centres it in whatever
          height the document gives (600px popup, full-tab options page); the
          extra bottom padding lifts it a little above true centre, which is
          where the eye expects a single object to sit. Only the reassurance
          line lives at the foot. */}
      <form
        onSubmit={handleUnlock}
        className="my-auto flex w-full max-w-sm flex-col items-center pb-8"
      >
        <div className="relative h-28 w-28">
          <Logo size="max" alt="" />
          {/* The lock seal, ringed in the canvas colour so it reads as a
              badge pinned to the mascot rather than a mark floating beside it. */}
          <span className="seal absolute -bottom-0.5 right-0 flex h-10 w-10 items-center justify-center bg-background">
            <SealMark icon={Lock} size="md" className="h-8 w-8" />
          </span>
        </div>

        <h1 className="screen-title mt-6 text-center text-[20px]">{title}</h1>

        <div className="mt-4 w-full">
          <PasswordInput
            label="Master Password"
            labelHidden
            placeholder="Master password"
            value={password}
            onChange={setPassword}
            disabled={isLoading}
            idPrefix="unlock"
            autoFocus
            inputRef={passwordFieldRef}
            invalid={Boolean(error)}
          />
          {error && (
            <p
              className="mt-2 flex items-start gap-1.5 text-xs font-medium text-destructive"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>

        <Button type="submit" disabled={isLoading} className="mt-4 h-12 w-full">
          {isLoading ? "Unlocking..." : "Unlock"}
        </Button>

        {/* There is deliberately no attempt counter here. One used to live in
            component state, which meant closing and reopening the popup reset it
            and a caller driving the message bus never saw it at all. Rate
            limiting is the background's, in `unlock-throttle.service.ts`, and the
            wait it imposes is reported through the error above. */}
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Your keys stay encrypted in this browser.
      </p>
    </div>
  );
}

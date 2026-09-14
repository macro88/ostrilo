import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { useKeyManager } from "../hooks/useKeyManager";
import { UNLOCK_FAILED, type UnlockResult } from "@/ui/state/KeyManagerContext";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { useEphemeralInputTeardown } from "../hooks/useEphemeralInputTeardown";
import { Lock, Unlock, AlertTriangle, Fingerprint, Shield, Key } from "lucide-react";
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

export function LockScreen({
  onUnlock,
  title = "Ostrilo is Locked",
}: LockScreenProps) {
  const { unlock, isLoading, hasKeys } = useKeyManager();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const passwordFieldRef = useRef<HTMLInputElement>(null);

  useEphemeralInputTeardown(passwordFieldRef);

  // Derive biometric availability synchronously
  const biometricAvailable =
    typeof navigator !== "undefined" &&
    typeof (navigator as any).credentials !== "undefined" &&
    typeof (navigator as any).credentials.create === "function";

  const handleUnlock = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (isLoading) return;

    if (!password.trim()) {
      setError("Password is required");
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

  const handleBiometricUnlock = async () => {
    console.log("Biometric unlock requested (not implemented yet)");
    setError("Biometric unlock is not yet implemented");
  };

  return (
    <div className="app-canvas flex h-full flex-col items-center justify-center space-y-4 bg-background p-4 text-center">
      <div className="w-full max-w-sm text-center">
        <div className="relative mx-auto mb-3 h-24 w-24">
          <Logo size="max" mode="model" />
          <SealMark
            icon={Lock}
            size="sm"
            className="absolute bottom-1 right-2 h-7 w-7"
          />
        </div>
        <h1 className="screen-title">{title}</h1>
        <p className="screen-description">
          Enter your master password to access your keys
        </p>
      </div>

      {hasKeys && (
        <div className="seal-chip seal-chip-accent">
          <Key className="h-3 w-3" />
          Your keys are secured
        </div>
      )}

      <div className="ink-card w-full max-w-sm space-y-4 p-4">
        {/* One guard for both the Enter key and the button. `onKeyPress` was
            deprecated in React 19 and only the Enter path ever reached the
            empty-password check, because the button is disabled when the field
            is blank. */}
        <form onSubmit={handleUnlock} className="space-y-4">
          <div className="text-left">
            <PasswordInput
              label="Master Password"
              placeholder="Enter your password"
              value={password}
              onChange={setPassword}
              disabled={isLoading}
              idPrefix="unlock"
              autoFocus
              inputRef={passwordFieldRef}
            />
          </div>

          {/* Error message */}
          {error && (
            <div
              className="seal-chip seal-chip-danger flex text-left"
              role="alert"
            >
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* Unlock button */}
          <Button
            type="submit"
            disabled={isLoading || !password.trim()}
            className="h-11 w-full"
          >
            {isLoading ? (
              "Unlocking..."
            ) : (
              <>
                <Unlock className="mr-2 h-4 w-4" />
                Unlock
              </>
            )}
          </Button>
        </form>

        {/* Biometric unlock */}
        {biometricAvailable && (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  or
                </span>
              </div>
            </div>

            <Button
              variant="outline"
              onClick={handleBiometricUnlock}
              disabled={isLoading}
              className="w-full"
            >
              <Fingerprint className="mr-2 h-4 w-4" />
              Use Biometric
            </Button>
          </>
        )}
      </div>

      {/* Security notice */}
      <div className="text-xs text-muted-foreground">
        <Shield className="h-3 w-3 inline mr-1" />
        Your keys stay encrypted in this browser
      </div>

      {/* There is deliberately no attempt counter here. One used to live in
          component state, which meant closing and reopening the popup reset it
          and a caller driving the message bus never saw it at all. Rate
          limiting is the background's, in `unlock-throttle.service.ts`, and the
          wait it imposes is reported through the error above. */}
    </div>
  );
}

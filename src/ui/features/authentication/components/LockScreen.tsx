import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useKeyManager } from "../hooks/useKeyManager";
import {
  Lock,
  Unlock,
  Eye,
  EyeOff,
  AlertTriangle,
  Fingerprint,
  Shield,
  Key,
} from "lucide-react";
import { Logo } from "@/ui/components/logo/Logo";
import { SealMark } from "@/components/common/SealMark";

interface LockScreenProps {
  onUnlock?: () => void;
  title?: string;
}

export function LockScreen({
  onUnlock,
  title = "Ostrilo is Locked",
}: LockScreenProps) {
  const { unlock, isLoading, hasKeys } = useKeyManager();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [attemptCount, setAttemptCount] = useState(0);

  // Derive biometric availability synchronously
  const biometricAvailable =
    typeof navigator !== "undefined" &&
    typeof (navigator as any).credentials !== "undefined" &&
    typeof (navigator as any).credentials.create === "function";

  const handleUnlock = async () => {
    if (!password.trim()) {
      setError("Password is required");
      return;
    }

    try {
      setError("");
      await unlock(password);
      setPassword(""); // Clear password from memory
      onUnlock?.();
    } catch (error) {
      setAttemptCount((prev) => prev + 1);
      setError(error instanceof Error ? error.message : "Incorrect password");
      setPassword(""); // Clear password on error
    }
  };

  const handleBiometricUnlock = async () => {
    try {
      console.log("Biometric unlock requested (not implemented yet)");
      setError("Biometric unlock is not yet implemented");
    } catch (error) {
      setError("Biometric authentication failed");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading) {
      handleUnlock();
    }
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
        <div className="space-y-2 text-left">
          <Label htmlFor="password" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Master Password
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={isLoading}
              className={error ? "border-destructive" : ""}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              disabled={isLoading}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="seal-chip seal-chip-danger flex text-left">
            <AlertTriangle className="h-4 w-4" />
            {error}
            {attemptCount > 2 && (
              <span className="text-xs">({attemptCount} attempts)</span>
            )}
          </div>
        )}

        {/* Unlock button */}
        <Button
          onClick={handleUnlock}
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

      {/* Attempt warning */}
      {attemptCount > 3 && (
        <div className="max-w-sm rounded-[10px] bg-[var(--ink-amber-soft)] p-4 text-[var(--ink-amber)]">
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4" />
            Multiple failed attempts detected. Ensure you're using the correct
            password.
          </div>
        </div>
      )}
    </div>
  );
}

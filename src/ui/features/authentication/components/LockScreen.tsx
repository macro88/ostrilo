import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useKeyManager } from "../hooks/useKeyManager";
import mascotLogo from "@/assets/ostrilo_mascot_front.svg";
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
    <div className="flex flex-col items-center justify-center h-full p-8 space-y-6 text-center bg-background">
      {/* Mascot and title */}
      <img src={mascotLogo} alt="Ostrilo Mascot" className="w-24 h-24" />

      <div className="space-y-2">
        <h1 className="text-2xl font-display">{title}</h1>
        <p className="text-muted-foreground">
          Enter your master password to access your keys
        </p>
      </div>

      {/* Key count indicator */}
      {hasKeys && (
        <div className="text-center p-3 bg-muted rounded-lg">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Key className="h-4 w-4" />
            <span>Your keys are secured</span>
          </div>
        </div>
      )}

      {/* Password form */}
      <div className="w-full space-y-4">
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
              className={error ? "border-red-500" : ""}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={isLoading}
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
          <div className="text-sm text-red-600 flex items-center gap-2 text-left">
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
          className="w-full btn-plush h-11"
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
        Your keys are encrypted and secure
      </div>

      {/* Attempt warning */}
      {attemptCount > 3 && (
        <div className="p-3 border-2 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            Multiple failed attempts detected. Ensure you're using the correct
            password.
          </div>
        </div>
      )}
    </div>
  );
}

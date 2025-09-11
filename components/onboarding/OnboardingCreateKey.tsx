import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useKeyManager } from "@/hooks/useKeyManager";
import { useOnboarding } from "@/hooks/useOnboarding";

import {
  evaluatePasswordStrength,
  generateKeyPair,
  publicKeyToBech32,
} from "@/lib/crypto";
import {
  Key,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Fingerprint,
} from "lucide-react";

interface OnboardingCreateKeyProps {
  onBack: () => void;
  onComplete: () => void;
}

export function OnboardingCreateKey({
  onBack,
  onComplete,
}: OnboardingCreateKeyProps) {
  const { generateKey, isLoading } = useKeyManager();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [keyName, setKeyName] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const { markOnboardingComplete } = useOnboarding();
  const [isGenerating, setIsGenerating] = useState(false);

  const validatePassword = () => {
    if (!password) {
      setPasswordError("Password is required");
      return false;
    }

    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return false;
    }

    const strength = evaluatePasswordStrength(password);
    if (!strength.meetsMinimum) {
      setPasswordError("Password does not meet minimum requirements");
      return false;
    }

    if (!keyName.trim()) {
      setPasswordError("Key name is required");
      return false;
    }

    setPasswordError("");
    return true;
  };

  const handleGenerateKey = async () => {
    if (!validatePassword()) return;

    setIsGenerating(true);
    try {
      // Generate and save the key
      await generateKey(password, keyName.trim());
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : "Failed to generate key"
      );
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      setIsGenerating(false);
      await markOnboardingComplete();
      // Complete onboarding immediately
      onComplete();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Key className="h-12 w-12 mx-auto text-blue-500" />
          <h2 className="text-2xl font-bold">Create Your Nostr Key</h2>
          <p className="text-muted-foreground">
            Set up a secure password to protect your new identity
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="keyName">Key Name</Label>
            <Input
              id="keyName"
              placeholder="My Nostr Key"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            />
          </div>

          <PasswordInput
            label="Master Password"
            placeholder="Enter a strong password"
            value={password}
            onChange={setPassword}
            confirmValue={confirmPassword}
            onConfirmChange={setConfirmPassword}
            showStrengthMeter={true}
            error={passwordError}
          />

          <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-blue-600 mb-1">
                  Backup Reminder
                </div>
                <div className="text-blue-600">
                  You can backup your private key later from Settings → Export
                  Key. Keep your password safe!
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex space-x-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button
            onClick={handleGenerateKey}
            disabled={isLoading || isGenerating}
            className="flex-1"
          >
            {isGenerating ? "Creating..." : "Create Key"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

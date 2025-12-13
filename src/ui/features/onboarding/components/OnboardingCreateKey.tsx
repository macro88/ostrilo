import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useKeyManager } from "../../authentication/hooks/useKeyManager";
import {
  generateKey as rpcGenerateKey,
  unlockVault,
  evaluatePasswordStrength,
  exportKey,
} from "@/infrastructure/messaging/client";
import { useOnboarding } from "../hooks/useOnboarding";
import {
  Key,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Fingerprint,
  Copy,
  Download,
  Eye,
  EyeOff,
} from "lucide-react";

interface OnboardingCreateKeyProps {
  onBack: () => void;
  onComplete: () => void;
}

export function OnboardingCreateKey({
  onBack,
  onComplete,
}: OnboardingCreateKeyProps) {
  const { isLoading } = useKeyManager();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [keyName, setKeyName] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const { markOnboardingComplete } = useOnboarding();
  const [isGenerating, setIsGenerating] = useState(false);
  const [backupChecked, setBackupChecked] = useState(false);
  const [step, setStep] = useState<"input" | "backup">("input");
  const [privateKey, setPrivateKey] = useState<{
    nsec: string;
    hex: string;
  } | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const validatePassword = async () => {
    if (!password) {
      setPasswordError("Password is required");
      return false;
    }

    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return false;
    }

    try {
      const strength = await evaluatePasswordStrength(password);
      // Use score instead of meetsMinimum property - score of 3+ is recommended for strong passwords
      if (strength.score < 3) {
        setPasswordError("Password does not meet minimum requirements");
        return false;
      }
    } catch (error) {
      setPasswordError("Could not validate password strength");
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
    if (!(await validatePassword())) return;

    setIsGenerating(true);
    try {
      // Generate key in background and set as selected if first
      await rpcGenerateKey(password, keyName.trim());
      // Immediately unlock session so user can proceed
      await unlockVault(password);
      // Export the private key for backup
      const exported = await exportKey();
      setPrivateKey(exported);
      setStep("backup");
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : "Failed to generate key"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyKey = async () => {
    if (!privateKey) return;
    try {
      await navigator.clipboard.writeText(privateKey.nsec);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error("Failed to copy key:", error);
    }
  };

  const handleDownloadKey = () => {
    if (!privateKey) return;
    const keyData = {
      name: keyName,
      privateKey: privateKey.nsec,
      privateKeyHex: privateKey.hex,
      createdAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(keyData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ostrilo-key-${keyName.replace(
      /\s+/g,
      "-"
    )}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md space-y-4">
        {step === "input" && (
          <>
            <div className="text-center space-y-2">
              <Key className="h-10 w-10 mx-auto text-blue-500" />
              <h2 className="text-xl font-bold">Create Your Nostr Key</h2>
              <p className="text-muted-foreground text-sm">
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
                      After creating your key, you will be shown your private
                      key for backup. Keep your password safe!
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
                disabled={isGenerating}
                className="flex-1"
              >
                {isGenerating ? "Creating..." : "Create Key"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </>
        )}

        {step === "backup" && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <CheckCircle className="h-12 w-12 mx-auto text-green-500" />
              <h2 className="text-2xl font-bold">Backup Your Key</h2>
              <p className="text-muted-foreground">
                Save your private key somewhere safe. You'll need it to restore
                your account if you lose access.
              </p>
            </div>

            {/* Private key display */}
            {privateKey && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="privateKey">Private Key (nsec format)</Label>
                  <div className="relative">
                    <Input
                      id="privateKey"
                      type={showPrivateKey ? "text" : "password"}
                      value={privateKey.nsec}
                      readOnly
                      className="pr-10 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPrivateKey(!showPrivateKey)}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    >
                      {showPrivateKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleCopyKey}
                    className="flex-1"
                  >
                    {copySuccess ? (
                      <>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="mr-2 h-4 w-4" />
                        Copy Key
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDownloadKey}
                    className="flex-1"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download Backup
                  </Button>
                </div>
              </div>
            )}

            {/* Security warning */}
            <div className="p-4 bg-amber-50 dark:bg-amber-950 border-2 border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-start gap-3">
                <Key className="h-5 w-5 text-amber-600 mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium text-amber-600 mb-1">
                    Keep This Safe
                  </div>
                  <div className="text-amber-600">
                    Anyone with access to your private key can control your
                    Nostr identity. Never share it with anyone and store it
                    securely.
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-start space-x-2 p-3 border rounded">
              <input
                id="backupConfirm"
                type="checkbox"
                className="mt-1"
                checked={backupChecked}
                onChange={(e) => setBackupChecked(e.target.checked)}
              />
              <Label htmlFor="backupConfirm" className="text-sm">
                I have safely backed up my private key and understand that I
                cannot recover it if I lose it.
              </Label>
            </div>
            <div className="flex space-x-3">
              <Button
                variant="outline"
                onClick={() => setStep("input")}
                className="flex-1"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={async () => {
                  if (!backupChecked) return;
                  await markOnboardingComplete();
                  onComplete();
                }}
                disabled={!backupChecked}
                className="flex-1"
              >
                Finish
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useKeyManager } from "../../authentication/hooks/useKeyManager";
import { useOnboarding } from "../hooks/useOnboarding";
import {
  importKey as rpcImportKey,
  unlockVault,
  parsePrivateKey,
  evaluatePasswordStrength,
} from "@/infrastructure/messaging/client";
import {
  FileKey,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  CheckCircle,
  Key,
  Upload,
  Eye,
  EyeOff,
} from "lucide-react";
import { SealMark } from "@/components/common/SealMark";

interface OnboardingImportKeyProps {
  onBack: () => void;
  onComplete: () => void;
}

type ImportStep = "import" | "password" | "success";

export function OnboardingImportKey({
  onBack,
  onComplete,
}: OnboardingImportKeyProps) {
  const { isLoading } = useKeyManager();
  const { markOnboardingComplete } = useOnboarding();
  const [currentStep, setCurrentStep] = useState<ImportStep>("import");

  // Import state - Use refs to avoid storing secret in React state
  const privateKeyRef = useRef<HTMLInputElement>(null);
  const privateKeyValueRef = useRef<string | null>(null);
  const [keyName, setKeyName] = useState("");
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [importError, setImportError] = useState("");
  const [parsedKey, setParsedKey] = useState<Uint8Array | null>(null);

  // Password state
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const validateImport = async () => {
    const keyInput = privateKeyRef.current?.value.trim();
    if (!keyInput) {
      setImportError("Private key is required");
      return false;
    }

    if (!keyName.trim()) {
      setImportError("Key name is required");
      return false;
    }

    try {
      const parsed = await parsePrivateKey(keyInput);
      // Convert array back to Uint8Array since RPC returns arrays
      const parsedKey = new Uint8Array(parsed);
      setParsedKey(parsedKey);
      privateKeyValueRef.current = keyInput;
      setImportError("");
      return true;
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Invalid private key format"
      );
      return false;
    }
  };

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
      if (strength.score < 3) {
        // Use score instead of meetsMinimum property
        setPasswordError("Password does not meet minimum requirements");
        return false;
      }
    } catch (error) {
      setPasswordError("Could not validate password strength");
      return false;
    }

    setPasswordError("");
    return true;
  };

  const handleImportKey = async () => {
    if (!(await validateImport())) return;
    setCurrentStep("password");
  };

  const handleSetPassword = async () => {
    if (!(await validatePassword()) || !parsedKey) return;

    const keyInput = privateKeyValueRef.current;
    if (!keyInput) {
      setPasswordError("Private key is no longer available");
      return;
    }

    try {
      await rpcImportKey(keyInput, password, keyName.trim());
      await unlockVault(password);

      // Clear the private key from the input for security
      if (privateKeyRef.current) {
        privateKeyRef.current.value = "";
      }
      privateKeyValueRef.current = null;
      setParsedKey(null);

      setCurrentStep("success");
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : "Failed to import key"
      );
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;

        // Try to parse as JSON first (exported key file)
        try {
          const keyData = JSON.parse(content);
          if (keyData.privateKey) {
            if (privateKeyRef.current) {
              privateKeyRef.current.value = keyData.privateKey;
            }
            if (keyData.name && !keyName) {
              setKeyName(keyData.name);
            }
          } else {
            if (privateKeyRef.current) {
              privateKeyRef.current.value = content.trim();
            }
          }
        } catch {
          // Not JSON, treat as raw key
          if (privateKeyRef.current) {
            privateKeyRef.current.value = content.trim();
          }
        }
      } catch (error) {
        setImportError("Failed to read file");
      }
    };
    reader.readAsText(file);

    // Clear the input so the same file can be selected again
    event.target.value = "";
  };

  const renderImportStep = () => (
    <div className="space-y-6">
      <div className="screen-header text-center">
        <SealMark icon={FileKey} size="lg" className="mx-auto mb-3" />
        <h2 className="screen-title">Import Your Key</h2>
        <p className="screen-description">
          Import an existing Nostr private key (nsec format)
        </p>
      </div>

      <div className="ink-card space-y-4 p-4">
        <div>
          <Label htmlFor="keyName">Key Name</Label>
          <Input
            id="keyName"
            placeholder="My Imported Key"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="privateKey" className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            Private Key (nsec)
          </Label>
          <div className="relative">
            <Input
              id="privateKey"
              ref={privateKeyRef}
            type={showPrivateKey ? "text" : "password"}
            placeholder="nsec1..."
            className={importError ? "border-destructive pr-16" : "pr-16"}
            />
            <div className="absolute right-1 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowPrivateKey(!showPrivateKey)}
                className="p-1 text-muted-foreground hover:text-foreground"
              >
                {showPrivateKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* File upload option */}
        <div className="rounded-[10px] border border-dashed border-border bg-muted/40 p-4">
          <div className="text-center space-y-2">
            <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Or upload a key file
            </div>
            <Label
              htmlFor="file-upload"
              className="inline-flex cursor-pointer items-center rounded-lg border border-input bg-card px-3 py-2 text-sm font-semibold hover:bg-accent hover:text-accent-foreground"
            >
              Choose File
            </Label>
            <input
              id="file-upload"
              type="file"
              accept=".json,.txt,.key"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Key format help */}
        <div className="rounded-[10px] bg-muted/60 p-3">
          <div className="text-sm">
            <div className="font-medium mb-1">Supported formats:</div>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>nsec1... (bech32 format)</li>
              <li>Hex private key (64 characters)</li>
              <li>Exported JSON key file</li>
            </ul>
          </div>
        </div>

        {/* Security warning */}
        <div className="rounded-[10px] bg-[var(--ink-amber-soft)] p-3 text-[var(--ink-amber)]">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4" />
            <div className="font-medium text-sm">
              Security Notice
            </div>
          </div>
          <div className="text-xs">
            Only import keys you trust. Malicious keys could compromise your
            Nostr identity.
          </div>
        </div>
      </div>

      {importError && (
        <div className="seal-chip seal-chip-danger flex">
          <AlertTriangle className="h-4 w-4" />
          {importError}
        </div>
      )}

      <div className="flex space-x-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={handleImportKey}
          disabled={isLoading}
          className="flex-1"
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const renderPasswordStep = () => (
    <div className="space-y-6">
      <div className="screen-header text-center">
        <SealMark icon={Key} size="lg" className="mx-auto mb-3" />
        <h2 className="screen-title">Secure Your Key</h2>
        <p className="screen-description">
          Create a strong password to encrypt your imported key
        </p>
      </div>

      <div className="ink-card space-y-4 p-4">
        {parsedKey && (
          <div className="seal-chip seal-chip-success flex w-full items-start rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-4 w-4" />
              <div className="font-medium text-sm">
                Key Validated
              </div>
            </div>
            <div className="text-xs">
              Private key "{keyName}" is ready for import
            </div>
          </div>
        )}

        <PasswordInput
          label="Master Password"
          placeholder="Enter a strong password"
          value={password}
          onChange={setPassword}
          confirmValue={confirmPassword}
          onConfirmChange={setConfirmPassword}
          showStrengthMeter={true}
          error={passwordError}
          disabled={isLoading}
        />
      </div>

      <div className="flex space-x-3">
        <Button
          variant="outline"
          onClick={() => setCurrentStep("import")}
          disabled={isLoading}
          className="flex-1"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={handleSetPassword}
          disabled={isLoading}
          className="flex-1"
        >
          {isLoading ? "Importing..." : "Import Key"}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const renderSuccessStep = () => (
    <div className="space-y-6">
      <div className="screen-header text-center">
        <SealMark
          icon={CheckCircle}
          tone="success"
          size="lg"
          className="mx-auto mb-3"
        />
        <h2 className="screen-title">Import Successful</h2>
        <p className="screen-description">
          Your Nostr key has been securely imported and encrypted
        </p>
      </div>

      <div className="rounded-[10px] bg-[var(--ink-mint-soft)] p-4 text-[var(--ink-mint)]">
        <div className="space-y-2">
          <div className="font-semibold">
            "{keyName}" is ready to use
          </div>
          <div className="text-sm">
            Your key is now encrypted and stored securely on this device
          </div>
        </div>
      </div>

      <Button
        onClick={async () => {
          await markOnboardingComplete();
          onComplete();
        }}
        className="w-full"
        size="lg"
      >
        Get Started
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            {["import", "password", "success"].map((step, index) => (
              <div
                key={step}
                className={`flex h-8 w-8 items-center justify-center text-sm font-semibold ${
                  currentStep === step
                    ? "seal bg-primary text-primary-foreground"
                    : ["import", "password", "success"].indexOf(currentStep) >
                      index
                    ? "seal bg-[var(--ink-mint-soft)] text-[var(--ink-mint)]"
                    : "seal bg-muted text-muted-foreground"
                }`}
              >
                {index + 1}
              </div>
            ))}
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-all duration-300"
              style={{
                width: `${
                  (["import", "password", "success"].indexOf(currentStep) + 1) *
                  33.33
                }%`,
              }}
            />
          </div>
        </div>

        {/* Step content */}
        {currentStep === "import" && renderImportStep()}
        {currentStep === "password" && renderPasswordStep()}
        {currentStep === "success" && renderSuccessStep()}
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useKeyManager } from "@/hooks/useKeyManager";
import { 
  evaluatePasswordStrength, 
  generateKeyPair,
  publicKeyToHex,
  publicKeyToBech32,
  privateKeyToBech32
} from "@/lib/crypto";
import { 
  Key, 
  ArrowLeft, 
  ArrowRight, 
  Copy, 
  Download, 
  Eye, 
  EyeOff,
  CheckCircle,
  AlertTriangle,
  Shield,
  Fingerprint
} from "lucide-react";

interface OnboardingCreateKeyProps {
  onBack: () => void;
  onComplete: () => void;
}

type CreateStep = "password" | "generate" | "backup" | "verify";

export function OnboardingCreateKey({ onBack, onComplete }: OnboardingCreateKeyProps) {
  const { generateKey, isLoading } = useKeyManager();
  const [currentStep, setCurrentStep] = useState<CreateStep>("password");
  
  // Password setup state
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [keyName, setKeyName] = useState("");
  const [passwordError, setPasswordError] = useState("");
  
  // Key generation state
  const [generatedKey, setGeneratedKey] = useState<{
    privateKey: string;
    publicKey: string;
    nsec: string;
    npub: string;
  } | null>(null);
  
  // Backup verification state
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [verificationWords, setVerificationWords] = useState<string[]>([]);
  const [userVerificationInput, setUserVerificationInput] = useState("");
  const [verificationError, setVerificationError] = useState("");

  // Check biometric availability
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  useEffect(() => {
    // Check if biometric authentication is available
    if ('credentials' in navigator && 'create' in navigator.credentials) {
      setBiometricAvailable(true);
    }
  }, []);

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
    
    try {
      // Generate the key pair first
      const keyPair = await generateKeyPair();
      const publicKeyHex = publicKeyToHex(keyPair.publicKey);
      const npub = publicKeyToBech32(keyPair.publicKey);
      const nsec = privateKeyToBech32(keyPair.privateKey);
      
      // Store the generated key data for display
      const keyData = {
        privateKey: Array.from(keyPair.privateKey).map(b => b.toString(16).padStart(2, '0')).join(''),
        publicKey: publicKeyHex,
        nsec,
        npub
      };
      setGeneratedKey(keyData);
      
      // Extract random words from nsec for verification
      const nsecWords = nsec.slice(5).match(/.{1,4}/g) || [];
      const randomWords = nsecWords.slice(0, 3);
      setVerificationWords(randomWords);
      
      // Save the key using the key manager (this encrypts and stores it)
      await generateKey(password, keyName.trim());
      
      setCurrentStep("generate");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Failed to generate key");
    }
  };

  const handleCopyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  const handleDownloadKey = () => {
    if (!generatedKey) return;
    
    const keyData = {
      name: keyName,
      privateKey: generatedKey.nsec,
      publicKey: generatedKey.npub,
      created: new Date().toISOString()
    };
    
    const dataStr = JSON.stringify(keyData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `ostrilo-key-${keyName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleVerifyBackup = () => {
    if (!verificationWords.length) return;
    
    const expectedInput = verificationWords.join('').toLowerCase();
    const userInput = userVerificationInput.toLowerCase().replace(/\s/g, '');
    
    if (userInput === expectedInput) {
      setVerificationError("");
      onComplete();
    } else {
      setVerificationError("Verification failed. Please check your backup and try again.");
    }
  };

  const renderPasswordStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <Key className="h-12 w-12 mx-auto text-blue-500" />
        <h2 className="text-2xl font-bold">Set Up Security</h2>
        <p className="text-muted-foreground">
          Create a strong password to protect your private key
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

        {biometricAvailable && (
          <div className="flex items-center space-x-2 p-3 border rounded-lg">
            <Fingerprint className="h-5 w-5 text-blue-500" />
            <div className="flex-1">
              <div className="font-medium">Enable Biometric Unlock</div>
              <div className="text-sm text-muted-foreground">
                Use fingerprint or face recognition for quick access
              </div>
            </div>
            <input
              type="checkbox"
              checked={biometricEnabled}
              onChange={(e) => setBiometricEnabled(e.target.checked)}
              className="rounded"
            />
          </div>
        )}
      </div>

      <div className="flex space-x-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={handleGenerateKey} disabled={isLoading} className="flex-1">
          Generate Key
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const renderGenerateStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <CheckCircle className="h-12 w-12 mx-auto text-green-500" />
        <h2 className="text-2xl font-bold">Key Generated!</h2>
        <p className="text-muted-foreground">
          Your Nostr identity has been created successfully
        </p>
      </div>

      {generatedKey && (
        <div className="space-y-4">
          <div className="p-4 bg-muted rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <Label className="font-semibold">Public Key (npub)</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopyToClipboard(generatedKey.npub)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <div className="font-mono text-sm break-all bg-background p-2 rounded border">
              {generatedKey.npub}
            </div>
          </div>

          <div className="p-4 border-2 border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              <Label className="font-semibold text-orange-600">
                Private Key (nsec) - Keep Secret!
              </Label>
            </div>
            <div className="text-sm text-orange-600 mb-3">
              This key gives full access to your Nostr identity. Never share it!
            </div>
            <div className="flex items-center space-x-2">
              <div className="flex-1 font-mono text-sm break-all bg-background p-2 rounded border">
                {showPrivateKey ? generatedKey.nsec : "•".repeat(63)}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPrivateKey(!showPrivateKey)}
              >
                {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              {showPrivateKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyToClipboard(generatedKey.nsec)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex space-x-3">
        <Button
          variant="outline"
          onClick={handleDownloadKey}
          className="flex-1"
        >
          <Download className="mr-2 h-4 w-4" />
          Download Backup
        </Button>
        <Button onClick={() => setCurrentStep("backup")} className="flex-1">
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const renderBackupStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <Shield className="h-12 w-12 mx-auto text-amber-500" />
        <h2 className="text-2xl font-bold">Backup Your Key</h2>
        <p className="text-muted-foreground">
          Ensure you can recover your identity if needed
        </p>
      </div>

      <div className="space-y-4">
        <div className="p-4 border-2 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 rounded-lg">
          <h3 className="font-semibold mb-2">Important Security Steps:</h3>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              Save your private key in a secure location
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              Consider using a password manager
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              Never share your private key with anyone
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              Store backups in multiple safe locations
            </li>
          </ul>
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="backup-confirm"
            checked={backupConfirmed}
            onChange={(e) => setBackupConfirmed(e.target.checked)}
            className="rounded"
          />
          <Label htmlFor="backup-confirm" className="text-sm">
            I have safely backed up my private key and understand the risks
          </Label>
        </div>
      </div>

      <div className="flex space-x-3">
        <Button
          variant="outline"
          onClick={() => setCurrentStep("generate")}
          className="flex-1"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={() => setCurrentStep("verify")}
          disabled={!backupConfirmed}
          className="flex-1"
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const renderVerifyStep = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <CheckCircle className="h-12 w-12 mx-auto text-green-500" />
        <h2 className="text-2xl font-bold">Verify Your Backup</h2>
        <p className="text-muted-foreground">
          Enter these characters from your private key to confirm you have it saved
        </p>
      </div>

      <div className="space-y-4">
        <div className="p-4 bg-muted rounded-lg text-center">
          <Label className="text-sm text-muted-foreground">
            Enter characters: {verificationWords.join(' • ')}
          </Label>
          <div className="text-xs text-muted-foreground mt-1">
            (from your nsec private key, without spaces)
          </div>
        </div>

        <div>
          <Label htmlFor="verification">Verification Input</Label>
          <Input
            id="verification"
            placeholder="Enter the characters shown above"
            value={userVerificationInput}
            onChange={(e) => setUserVerificationInput(e.target.value)}
            className={verificationError ? "border-red-500" : ""}
          />
          {verificationError && (
            <div className="text-sm text-red-600 mt-1">{verificationError}</div>
          )}
        </div>
      </div>

      <div className="flex space-x-3">
        <Button
          variant="outline"
          onClick={() => setCurrentStep("backup")}
          className="flex-1"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={handleVerifyBackup} className="flex-1">
          Complete Setup
          <CheckCircle className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-md">
        {/* Progress indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {["password", "generate", "backup", "verify"].map((step, index) => (
              <div
                key={step}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  currentStep === step
                    ? "bg-blue-500 text-white"
                    : ["password", "generate", "backup", "verify"].indexOf(currentStep) > index
                    ? "bg-green-500 text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {index + 1}
              </div>
            ))}
          </div>
          <div className="h-2 bg-muted rounded-full">
            <div
              className="h-2 bg-blue-500 rounded-full transition-all duration-300"
              style={{
                width: `${
                  (["password", "generate", "backup", "verify"].indexOf(currentStep) + 1) * 25
                }%`,
              }}
            />
          </div>
        </div>

        {/* Step content */}
        {currentStep === "password" && renderPasswordStep()}
        {currentStep === "generate" && renderGenerateStep()}
        {currentStep === "backup" && renderBackupStep()}
        {currentStep === "verify" && renderVerifyStep()}
      </div>
    </div>
  );
}

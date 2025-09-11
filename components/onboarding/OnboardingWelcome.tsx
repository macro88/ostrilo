import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Key, Shield, Zap, ArrowRight, FileKey, Download } from "lucide-react";

interface OnboardingWelcomeProps {
  onCreateKey: () => void;
  onImportKey: () => void;
}

export function OnboardingWelcome({
  onCreateKey,
  onImportKey,
}: OnboardingWelcomeProps) {
  const [selectedOption, setSelectedOption] = useState<
    "create" | "import" | null
  >(null);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 space-y-8">
      {/* Mascot and welcome text */}
      <div className="text-center space-y-4">
        <div className="w-24 h-24 mx-auto mb-6">
          <img
            src="/assets/ostrilo_mascot_front.svg"
            alt="Ostrilo Mascot"
            className="w-full h-full"
          />
        </div>

        <h1 className="text-3xl font-bold text-foreground">
          Welcome to Ostrilo
        </h1>

        <p className="text-lg text-muted-foreground max-w-md">
          Your secure Nostr signing companion. Let's set up your cryptographic
          identity.
        </p>
      </div>

      {/* Features highlight */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl">
        <div className="text-center space-y-2 p-4">
          <Shield className="h-8 w-8 mx-auto text-blue-500" />
          <h3 className="font-semibold">Secure</h3>
          <p className="text-sm text-muted-foreground">
            Military-grade encryption with local key storage
          </p>
        </div>

        <div className="text-center space-y-2 p-4">
          <Zap className="h-8 w-8 mx-auto text-yellow-500" />
          <h3 className="font-semibold">Fast</h3>
          <p className="text-sm text-muted-foreground">
            Instant signing with optimized cryptography
          </p>
        </div>

        <div className="text-center space-y-2 p-4">
          <Key className="h-8 w-8 mx-auto text-green-500" />
          <h3 className="font-semibold">Private</h3>
          <p className="text-sm text-muted-foreground">
            Your keys stay on your device, always
          </p>
        </div>
      </div>

      {/* Action selection */}
      <div className="w-full max-w-md space-y-4">
        <h2 className="text-xl font-semibold text-center mb-6">
          How would you like to get started?
        </h2>

        {/* Create new key option */}
        <div
          className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
            selectedOption === "create"
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
              : "border-border hover:border-blue-300"
          }`}
          onClick={() => setSelectedOption("create")}
        >
          <div className="flex items-center space-x-3">
            <Key className="h-6 w-6 text-blue-500" />
            <div className="flex-1">
              <h3 className="font-semibold">Create New Key</h3>
              <p className="text-sm text-muted-foreground">
                Generate a fresh cryptographic identity
              </p>
            </div>
            <div
              className={`w-4 h-4 border-2 rounded-full ${
                selectedOption === "create"
                  ? "border-blue-500 bg-blue-500"
                  : "border-muted-foreground"
              }`}
            />
          </div>
        </div>

        {/* Import existing key option */}
        <div
          className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
            selectedOption === "import"
              ? "border-green-500 bg-green-50 dark:bg-green-950"
              : "border-border hover:border-green-300"
          }`}
          onClick={() => setSelectedOption("import")}
        >
          <div className="flex items-center space-x-3">
            <FileKey className="h-6 w-6 text-green-500" />
            <div className="flex-1">
              <h3 className="font-semibold">Import Existing Key</h3>
              <p className="text-sm text-muted-foreground">
                Use your existing nsec private key
              </p>
            </div>
            <div
              className={`w-4 h-4 border-2 rounded-full ${
                selectedOption === "import"
                  ? "border-green-500 bg-green-500"
                  : "border-muted-foreground"
              }`}
            />
          </div>
        </div>

        {/* Continue button */}
        <div className="pt-4">
          <Button
            onClick={() => {
              if (selectedOption === "create") {
                onCreateKey();
              } else if (selectedOption === "import") {
                onImportKey();
              }
            }}
            disabled={!selectedOption}
            className="w-full"
            size="lg"
          >
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Security notice */}
      <div className="text-center text-xs text-muted-foreground max-w-md">
        <Shield className="h-4 w-4 inline mr-1" />
        Your private keys are encrypted and stored locally on your device.
        Ostrilo never has access to your keys or personal data.
      </div>
    </div>
  );
}

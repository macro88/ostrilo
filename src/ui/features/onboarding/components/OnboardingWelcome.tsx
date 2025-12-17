import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Key, Shield, Zap, ArrowRight, FileKey, Download } from "lucide-react";
import { AppLogo } from "@/components/common/app-logo";
import { Logo } from "@/ui/components/logo/Logo";

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
    <div className="flex flex-col items-center justify-center min-h-screen px-4 space-y-4">
      {/* Mascot and welcome text */}
      <div className="text-center space-y-2">
        <div className="w-32 h-32 mx-auto mb-4">
          <Logo size="max" />
        </div>

        <h1 className="text-2xl font-bold text-foreground">
          Welcome to Ostrilo
        </h1>

        <p className="text-base text-muted-foreground max-w-md">
          Your secure Nostr signing companion.
        </p>
      </div>
      {/* Action selection */}
      <div className="w-full max-w-md space-y-3">
        <h2 className="text-lg font-semibold text-center mb-4">
          How would you like to get started?
        </h2>

        {/* Create new key option */}
        <div
          className={`p-3 border-2 rounded-lg cursor-pointer transition-all ${
            selectedOption === "create"
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
              : "border-border hover:border-blue-300"
          }`}
          onClick={() => setSelectedOption("create")}
        >
          <div className="flex items-center space-x-3">
            <Key className="h-5 w-5 text-blue-500" />
            <div className="flex-1">
              <h3 className="font-semibold text-sm">Create New Key</h3>
              <p className="text-xs text-muted-foreground">
                Generate a fresh Nostr key
              </p>
            </div>
            <div
              className={`w-3 h-3 border-2 rounded-full ${
                selectedOption === "create"
                  ? "border-blue-500 bg-blue-500"
                  : "border-muted-foreground"
              }`}
            />
          </div>
        </div>

        {/* Import existing key option */}
        <div
          className={`p-3 border-2 rounded-lg cursor-pointer transition-all ${
            selectedOption === "import"
              ? "border-green-500 bg-green-50 dark:bg-green-950"
              : "border-border hover:border-green-300"
          }`}
          onClick={() => setSelectedOption("import")}
        >
          <div className="flex items-center space-x-3">
            <FileKey className="h-5 w-5 text-green-500" />
            <div className="flex-1">
              <h3 className="font-semibold text-sm">Import Existing Key</h3>
              <p className="text-xs text-muted-foreground">
                Use your existing nsec private key
              </p>
            </div>
            <div
              className={`w-3 h-3 border-2 rounded-full ${
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

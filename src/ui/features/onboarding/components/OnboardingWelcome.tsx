import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Key, Shield, ArrowRight, FileKey } from "lucide-react";
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
    <div className="flex min-h-screen flex-col items-center justify-center space-y-5 px-4 py-6">
      <div className="screen-header w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-32 w-32 items-center justify-center rounded-full bg-accent p-3 shadow-sm">
          <Logo size="max" />
        </div>

        <h1 className="text-2xl font-bold text-foreground">
          Welcome to Ostrilo
        </h1>

        <p className="screen-description">
          Your local signing buddy. Keys stay with you.
        </p>
      </div>
      <div className="w-full max-w-md space-y-3">
        <h2 className="text-center text-lg font-semibold">
          How would you like to get started?
        </h2>

        <button
          type="button"
          className={`w-full p-4 text-left transition-all ${
            selectedOption === "create"
              ? "plush-card border-primary bg-accent"
              : "plush-card hover:border-primary/50"
          }`}
          onClick={() => setSelectedOption("create")}
          aria-pressed={selectedOption === "create"}
        >
          <div className="flex items-center space-x-3">
            <div className="icon-bubble">
              <Key className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-sm">Create New Key</h3>
              <p className="text-xs text-muted-foreground">
                Generate a fresh Nostr key
              </p>
            </div>
            <div
              className={`h-4 w-4 rounded-full border-2 ${
                selectedOption === "create"
                  ? "border-primary bg-primary"
                  : "border-muted-foreground"
              }`}
            />
          </div>
        </button>

        <button
          type="button"
          className={`w-full p-4 text-left transition-all ${
            selectedOption === "import"
              ? "plush-card border-primary bg-accent"
              : "plush-card hover:border-primary/50"
          }`}
          onClick={() => setSelectedOption("import")}
          aria-pressed={selectedOption === "import"}
        >
          <div className="flex items-center space-x-3">
            <div className="icon-bubble">
              <FileKey className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-sm">Import Existing Key</h3>
              <p className="text-xs text-muted-foreground">
                Use your existing nsec private key
              </p>
            </div>
            <div
              className={`h-4 w-4 rounded-full border-2 ${
                selectedOption === "import"
                  ? "border-primary bg-primary"
                  : "border-muted-foreground"
              }`}
            />
          </div>
        </button>

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
            className="btn-plush w-full"
            size="lg"
          >
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="max-w-md text-center text-xs text-muted-foreground">
        <Shield className="h-4 w-4 inline mr-1" />
        Your private keys are encrypted and stored locally on your device.
        Ostrilo never has access to your keys or personal data.
      </div>
    </div>
  );
}

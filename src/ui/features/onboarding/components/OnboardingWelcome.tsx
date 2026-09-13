import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Key, Shield, ArrowRight, FileKey } from "lucide-react";
import { Logo } from "@/ui/components/logo/Logo";
import { SealMark } from "@/components/common/SealMark";

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
      <div className="w-full max-w-md text-center">
        {/* Static, not `mode="model"`. This screen shares a document — and
            therefore a JavaScript realm — with the create-key step that reveals
            an nsec and with the lock screen that holds the master password.
            Instantiating three.js here leaves a 892 KB third-party WebGL engine
            resident in that realm for the rest of the document's life.
            `Logo` enforces the same rule structurally; this is the honest
            declaration of intent next to it. The 3D hero returns on
            `welcome.html`, which has no key or password input at all. */}
        <div className="mx-auto mb-4 h-28 w-28">
          <Logo size="max" mode="static" />
        </div>

        <h1 className="text-2xl font-bold text-foreground">
          Welcome to Ostrilo
        </h1>

        <p className="screen-description">
          Your keys stay in this browser. Sites ask before anything is signed.
        </p>
      </div>
      <div className="w-full max-w-md space-y-3">
        <h2 className="text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Choose how to start
        </h2>

        <button
          type="button"
          className={`w-full p-4 text-left transition-all ${
            selectedOption === "create"
              ? "ink-card border-primary bg-secondary"
              : "ink-card hover:border-primary/50"
          }`}
          onClick={() => setSelectedOption("create")}
          aria-pressed={selectedOption === "create"}
        >
          <div className="flex items-center space-x-3">
            <SealMark icon={Key} />
            <div className="flex-1">
              <h3 className="font-semibold text-sm">Create New Key</h3>
              <p className="text-xs text-muted-foreground">
                Generate a fresh Nostr key
              </p>
            </div>
            <div
              className={`seal h-4 w-4 border-2 ${
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
              ? "ink-card border-primary bg-secondary"
              : "ink-card hover:border-primary/50"
          }`}
          onClick={() => setSelectedOption("import")}
          aria-pressed={selectedOption === "import"}
        >
          <div className="flex items-center space-x-3">
            <SealMark icon={FileKey} />
            <div className="flex-1">
              <h3 className="font-semibold text-sm">Import Existing Key</h3>
              <p className="text-xs text-muted-foreground">
                Use your existing nsec private key
              </p>
            </div>
            <div
              className={`seal h-4 w-4 border-2 ${
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
            className="w-full"
            size="lg"
          >
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="max-w-md text-center text-xs text-muted-foreground">
        <Shield className="h-4 w-4 inline mr-1" />
        Private keys are encrypted locally. Ostrilo never sees them.
      </div>
    </div>
  );
}

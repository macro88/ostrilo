import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateKey as rpcGenerateKey } from "@/infrastructure/messaging/client";
import { ArrowLeft, Loader2 } from "lucide-react";

interface CreateKeyFormProps {
  onBack: () => void;
  onSuccess: () => void;
}

/**
 * Simplified key creation form for adding keys to an already-unlocked vault.
 * Unlike OnboardingCreateKey, this doesn't ask for a password - it uses
 * the vault's existing password automatically.
 */
export function CreateKeyForm({ onBack, onSuccess }: CreateKeyFormProps) {
  const [keyName, setKeyName] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!keyName.trim()) {
      setError("Key name is required");
      return;
    }

    setIsGenerating(true);
    setError("");

    try {
      // Generate key using vault's existing password
      // The background service will use the current unlocked session's password
      await rpcGenerateKey("", keyName.trim());
      onSuccess();
    } catch (error) {
      console.error("Failed to generate key:", error);
      setError(
        error instanceof Error ? error.message : "Failed to generate key"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <form onSubmit={handleGenerateKey} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="keyName">Key Name (Optional)</Label>
        <Input
          id="keyName"
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
          placeholder="e.g., Personal, Work, Gaming"
          disabled={isGenerating}
          maxLength={50}
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Give this key a memorable name to identify it later
        </p>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={isGenerating}
          className="flex-1"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button type="submit" disabled={isGenerating} className="flex-1">
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            "Create Key"
          )}
        </Button>
      </div>

      <div className="p-3 bg-muted/50 rounded-lg border border-border">
        <p className="text-xs text-muted-foreground">
          <strong>Note:</strong> The new key will be encrypted with your vault's
          existing password. You can export and backup the private key from the
          Settings page after creation.
        </p>
      </div>
    </form>
  );
}

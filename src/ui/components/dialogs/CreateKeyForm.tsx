import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useKeyManagerContext } from "@/ui/state/KeyManagerContext";
import { ArrowLeft, Loader2 } from "lucide-react";

interface CreateKeyFormProps {
  onBack: () => void;
  onSuccess: () => void;
}

/**
 * Simplified key creation form for adding keys to a vault.
 * Requires password re-entry for security (zero-retention password handling).
 */
export function CreateKeyForm({ onBack, onSuccess }: CreateKeyFormProps) {
  const { generateKey } = useKeyManagerContext();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [keyName, setKeyName] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();

    const password = passwordRef.current?.value;
    if (!password) {
      setError("Password is required");
      return;
    }

    if (!keyName.trim()) {
      setError("Key name is required");
      return;
    }

    setIsGenerating(true);
    setError("");

    try {
      await generateKey(password, keyName.trim());
      // Clear password from input
      if (passwordRef.current) {
        passwordRef.current.value = "";
      }
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
        <Label htmlFor="password">Vault Password</Label>
        <Input
          ref={passwordRef}
          id="password"
          type="password"
          placeholder="Enter your vault password"
          disabled={isGenerating}
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Re-enter your password to encrypt the new key
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="keyName">Key Name</Label>
        <Input
          id="keyName"
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
          placeholder="e.g., Personal or Work"
          disabled={isGenerating}
          maxLength={50}
        />
        <p className="text-xs text-muted-foreground">
          Give this key a memorable name to identify it later
        </p>
      </div>

      {error && (
        <div className="ink-card p-4 bg-[var(--ink-red-soft)] text-[var(--ink-red)]">
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
    </form>
  );
}

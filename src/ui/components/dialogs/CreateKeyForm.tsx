import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NO_AUTOFILL_PROPS } from "@/components/ui/password-input";
import { useKeyManagerContext } from "@/ui/state/KeyManagerContext";
import { KeyFormActions } from "./KeyFormActions";

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
          {...NO_AUTOFILL_PROPS}
        />
        <p className="text-[11.5px] text-muted-foreground">
          Re-entered to encrypt the new key.
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
        <p className="text-[11.5px] text-muted-foreground">
          A label only you see, to tell your keys apart.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-[10px] bg-[var(--ink-red-soft)] px-3 py-2.5 text-[13px] text-[var(--ink-red)]"
        >
          {error}
        </div>
      )}

      <KeyFormActions
        onBack={onBack}
        pending={isGenerating}
        submitLabel="Create Key"
        pendingLabel="Creating..."
      />
    </form>
  );
}

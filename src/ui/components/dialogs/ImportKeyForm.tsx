import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  importKey as rpcImportKey,
  parsePrivateKey,
} from "@/infrastructure/messaging/client";
import { ArrowLeft, Loader2, Eye, EyeOff } from "lucide-react";

interface ImportKeyFormProps {
  onBack: () => void;
  onSuccess: () => void;
}

/**
 * Simplified key import form for adding keys to an already-unlocked vault.
 * Unlike OnboardingImportKey, this doesn't ask for a password - it uses
 * the vault's existing password automatically.
 */
export function ImportKeyForm({ onBack, onSuccess }: ImportKeyFormProps) {
  const privateKeyRef = useRef<HTMLInputElement>(null);
  const [keyName, setKeyName] = useState("");
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState("");

  const handleImportKey = async (e: React.FormEvent) => {
    e.preventDefault();

    const keyInput = privateKeyRef.current?.value.trim();
    if (!keyInput) {
      setError("Private key is required");
      return;
    }

    if (!keyName.trim()) {
      setError("Key name is required");
      return;
    }

    setIsImporting(true);
    setError("");

    try {
      // Validate the key format first
      await parsePrivateKey(keyInput);

      // Import key using vault's existing password
      // The background service will use the current unlocked session's password
      await rpcImportKey(keyInput, "", keyName.trim());

      // Clear the private key from the input for security
      if (privateKeyRef.current) {
        privateKeyRef.current.value = "";
      }

      onSuccess();
    } catch (error) {
      console.error("Failed to import key:", error);
      setError(error instanceof Error ? error.message : "Failed to import key");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <form onSubmit={handleImportKey} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="privateKey">Private Key (nsec or hex)</Label>
        <div className="relative">
          <Input
            ref={privateKeyRef}
            id="privateKey"
            type={showPrivateKey ? "text" : "password"}
            placeholder="nsec1... or hex format"
            disabled={isImporting}
            autoComplete="off"
            autoFocus
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPrivateKey(!showPrivateKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showPrivateKey ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Enter your existing Nostr private key in nsec1 or hex format
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="keyName">Key Name (Optional)</Label>
        <Input
          id="keyName"
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
          placeholder="e.g., Personal, Work, Gaming"
          disabled={isImporting}
          maxLength={50}
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
          disabled={isImporting}
          className="flex-1"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button type="submit" disabled={isImporting} className="flex-1">
          {isImporting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Importing...
            </>
          ) : (
            "Import Key"
          )}
        </Button>
      </div>

      <div className="p-3 bg-muted/50 rounded-lg border border-border">
        <p className="text-xs text-muted-foreground">
          <strong>Note:</strong> The imported key will be encrypted with your
          vault's existing password. Make sure you trust the source of this
          private key.
        </p>
      </div>
    </form>
  );
}

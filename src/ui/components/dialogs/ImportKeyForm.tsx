import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parsePrivateKey } from "@/infrastructure/messaging/client";
import { useKeyManagerContext } from "@/ui/state/KeyManagerContext";
import { ArrowLeft, Loader2, Eye, EyeOff } from "lucide-react";

interface ImportKeyFormProps {
  onBack: () => void;
  onSuccess: () => void;
}

/**
 * Simplified key import form for adding keys to a vault.
 * Requires password re-entry for security (zero-retention password handling).
 */
export function ImportKeyForm({ onBack, onSuccess }: ImportKeyFormProps) {
  const { importKey } = useKeyManagerContext();
  const privateKeyRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
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

    const password = passwordRef.current?.value;
    if (!password) {
      setError("Password is required");
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

      // Import key with password
      await importKey(keyInput, password, keyName.trim());

      // Clear the private key and password from the inputs for security
      if (privateKeyRef.current) {
        privateKeyRef.current.value = "";
      }
      if (passwordRef.current) {
        passwordRef.current.value = "";
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
        <Label htmlFor="password">Vault Password</Label>
        <Input
          ref={passwordRef}
          id="password"
          type="password"
          placeholder="Enter your vault password"
          disabled={isImporting}
        />
        <p className="text-xs text-muted-foreground">
          Re-enter your password to encrypt the imported key
        </p>
      </div>

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
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            tabIndex={-1}
            aria-label={showPrivateKey ? "Hide private key" : "Show private key"}
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
        <div className="plush-card status-danger">
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
        <Button type="submit" disabled={isImporting} className="btn-plush flex-1">
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

      <div className="rounded-2xl border border-border bg-muted/50 p-3">
        <p className="text-xs text-muted-foreground">
          <strong>Note:</strong> The imported key will be encrypted with your
          vault's existing password. Make sure you trust the source of this
          private key.
        </p>
      </div>
    </form>
  );
}

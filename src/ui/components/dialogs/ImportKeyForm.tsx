import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NO_AUTOFILL_PROPS } from "@/components/ui/password-input";
import { SealMark } from "@/components/common/SealMark";
import { parsePrivateKey } from "@/infrastructure/messaging/client";
import { useKeyManagerContext } from "@/ui/state/KeyManagerContext";
import { Eye, EyeOff, ShieldAlert } from "lucide-react";
import { KeyFormActions } from "./KeyFormActions";

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
          {...NO_AUTOFILL_PROPS}
        />
        <p className="text-[11.5px] text-muted-foreground">
          Re-entered to encrypt the imported key.
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
            autoFocus
            className="pr-10 font-mono"
            {...NO_AUTOFILL_PROPS}
          />
          <button
            type="button"
            onClick={() => setShowPrivateKey(!showPrivateKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
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
      </div>

      <div className="space-y-2">
        <Label htmlFor="keyName">Key Name</Label>
        <Input
          id="keyName"
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
          placeholder="e.g., Personal or Work"
          disabled={isImporting}
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
        pending={isImporting}
        submitLabel="Import Key"
        pendingLabel="Importing..."
      />

      {/* Soft amber panel with a seal icon, no border (DESIGN_RULES §7). */}
      <div className="flex items-start gap-2.5 rounded-[10px] bg-[var(--ink-amber-soft)] p-3 text-xs text-[var(--ink-amber)]">
        <SealMark icon={ShieldAlert} tone="warning" size="sm" className="mt-px" />
        <p>
          Encrypted with your existing vault password. Only import a key from a
          source you trust.
        </p>
      </div>
    </form>
  );
}

import { Copy, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { KeySelector } from "./KeySelector";
import { Logo } from "../logo/Logo";

interface HeaderProps {
  onAddKey?: () => void;
}

export function Header({ onAddKey }: HeaderProps) {
  const [copied, setCopied] = useState(false);
  const { lock, selectedUnlockedKey } = useKeyManager();

  const handleCopyKey = async () => {
    if (selectedUnlockedKey?.publicKeyBech32) {
      await navigator.clipboard.writeText(selectedUnlockedKey.publicKeyBech32);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="flex items-center justify-between px-3 py-3 bg-background border-b border-border w-full max-w-full">
      {/* Left side - Logo */}
      {/* <img src={mascotLogo} alt="Ostrilo Mascot" className="w-6 h-6 shrink-0" /> */}
      <Logo size="max" />

      {/* Center - Wallet name */}
      <h1 className="text-lg font-semibold text-foreground truncate mx-2">
        Ostrilo Signer
      </h1>

      {/* Right side - Key selector and actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => lock()}
          aria-label="Lock extension"
        >
          <Lock className="w-4 h-4" />
        </Button>

        {/* Key Selector - replaces old avatar + key display */}
        <KeySelector onAddKey={onAddKey} />


      </div>
    </header>
  );
}

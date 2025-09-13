import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import mascotLogo from "@/assets/ostrilo_mascot_front.svg";
import { useKeyManager } from "@/ui/hooks/useKeyManager";

interface HeaderProps {
  selectedKey?: string;
  avatar?: string;
}

export function Header({ selectedKey, avatar }: HeaderProps) {
  const [copied, setCopied] = useState(false);
  const { lock } = useKeyManager();
  const handleCopyKey = async () => {
    if (selectedKey) {
      await navigator.clipboard.writeText(selectedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const truncatedKey = selectedKey
    ? `${selectedKey.slice(0, 8)}...${selectedKey.slice(-4)}`
    : "No key selected";

  return (
    <header className="flex items-center justify-between p-4 bg-background border-b border-border">
      {/* Left side - Menu/hamburger placeholder */}

      <img src={mascotLogo} alt="Ostrilo Mascot" className="w-6 h-6" />

      {/* Center - Wallet name */}
      <h1
        className="text-lg font-semibold text-foreground"
        onClick={() => lock()}
      >
        Ostrilo Signer
      </h1>

      {/* Right side - Avatar and key */}
      <div className="flex items-center gap-2">
        {/* Avatar placeholder */}
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          {avatar ? (
            <img src={avatar} alt="Avatar" className="w-8 h-8 rounded-full" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-xs text-primary font-semibold">
                {selectedKey ? selectedKey.slice(0, 1).toUpperCase() : "?"}
              </span>
            </div>
          )}
        </div>

        {/* Copy key button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopyKey}
          className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
          disabled={!selectedKey}
        >
          <span className="mr-1">{truncatedKey}</span>
          <Copy className="w-3 h-3" />
        </Button>
      </div>
    </header>
  );
}

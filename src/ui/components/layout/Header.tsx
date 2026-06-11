import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { KeySelector } from "./KeySelector";
import { Logo } from "../logo/Logo";

interface HeaderProps {
  onAddKey?: () => void;
}

export function Header({ onAddKey }: HeaderProps) {
  const { lock } = useKeyManager();

  return (
    <header className="flex w-full max-w-full items-center justify-between gap-3 border-b border-border bg-card/95 px-3 py-3 shadow-sm backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent p-1 shadow-sm">
          <Logo size="max" />
        </div>

        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold leading-tight text-foreground">
            Ostrilo
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            Local Nostr signer
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
          onClick={() => lock()}
          aria-label="Lock extension"
        >
          <Lock className="w-4 h-4" />
        </Button>
        <KeySelector onAddKey={onAddKey} />
      </div>
    </header>
  );
}

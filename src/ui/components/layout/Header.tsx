import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { useAppSettings } from "@/hooks/useAppSettings";
import { SealMark } from "@/components/common/SealMark";
import { KeySelector } from "./KeySelector";
import { Logo } from "../logo/Logo";

interface HeaderProps {
  onAddKey?: () => void;
}

export function Header({ onAddKey }: HeaderProps) {
  const { lock } = useKeyManager();
  const { settings } = useAppSettings();
  const lockLabel =
    settings.autoLockMinutes === 0
      ? "Unlocked"
      : `Unlocked · ${settings.autoLockMinutes}m`;

  return (
    <header className="flex w-full max-w-full items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Logo size="lg" />

        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold leading-tight text-foreground">
            Ostrilo
          </h1>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="seal-chip seal-chip-success hidden sm:inline-flex">
          <SealMark size="sm" tone="success" />
          {lockLabel}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
          onClick={() => lock()}
          aria-label="Lock extension"
        >
          <Lock className="w-4 h-4" />
        </Button>
        <KeySelector onAddKey={onAddKey} compact />
      </div>
    </header>
  );
}

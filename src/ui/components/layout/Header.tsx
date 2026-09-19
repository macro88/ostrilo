import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { AutoLockCountdown } from "@/components/common/AutoLockCountdown";
import { KeySelector } from "./KeySelector";

interface HeaderProps {
  onAddKey?: () => void;
}

/**
 * The header is the account, not the brand.
 *
 * Working screens show neither the mascot nor the wordmark: the user already
 * knows which extension they opened, and the 56px at the top of a 600px popup
 * is better spent on the one fact every screen depends on - which key is
 * about to sign. The key selector is that fact and the way to change it, so
 * it sits where a wallet puts its account switcher. The lock is the only tool
 * on the right.
 */
export function Header({ onAddKey }: HeaderProps) {
  const { lock } = useKeyManager();

  return (
    // The bar is chrome and stays full-bleed; its contents are not. Home holds
    // its column to a measure at side-panel width, and a header whose account
    // sat at the document's 16px inset while the key card began 46px further
    // in left the two disagreeing down the same edge. The inner box carries
    // the measure so both start together. `@container` rather than a viewport
    // query: it reads the header's own width, so it holds wherever the bar is
    // mounted rather than assuming a document size.
    <header className="@container flex h-14 w-full shrink-0 border-b border-border bg-card">
      <div className="mx-auto flex w-full items-center justify-between gap-2 px-2 @min-[460px]:max-w-[428px]">
        <KeySelector onAddKey={onAddKey} />
        {/*
          The ring is drawn around the lock button's own 44px footprint rather
          than taking a slot beside it - the header is the surface with the
          least room, and the key selector is what it is for. The button stays
          a distinct control: the ring renders no interactive element, and the
          reading gives way to the button at the centre.

          The tooltip no longer repeats the configured timeout. The ring is now
          the thing that says how long is left, so the button's title says only
          what the button does; two elements stating the same fact in 44px is
          how header chrome gets noisy.
        */}
        <AutoLockCountdown size="sm">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => lock()}
            aria-label="Lock extension"
            title="Lock now"
          >
            <Lock className="size-5" />
          </Button>
        </AutoLockCountdown>
      </div>
    </header>
  );
}

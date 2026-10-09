import { X } from "lucide-react";

interface BackupBannerProps {
  onBackUp: () => void;
  onDismiss: () => void;
}

/**
 * A reminder, not an alarm: a hairline card in Home's own grammar, no amber
 * and no seal, so it reads as less urgent than a warning panel. One action and
 * a dismiss that lasts for the browser session.
 */
export function BackupBanner({ onBackUp, onDismiss }: BackupBannerProps) {
  return (
    <section
      className="ink-card flex shrink-0 items-center gap-1 py-1 pl-4 pr-1"
      aria-label="Backup reminder"
    >
      <p className="min-w-0 flex-1 text-[13px] font-medium text-foreground">
        This key has no backup
      </p>
      <button
        type="button"
        onClick={onBackUp}
        className="h-11 shrink-0 rounded-lg px-3 text-[13px] font-semibold text-[var(--ink-violet)] transition-colors duration-150 hover:bg-muted"
      >
        Back up
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss backup reminder"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  );
}

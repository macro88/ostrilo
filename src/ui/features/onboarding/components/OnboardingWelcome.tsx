import { ChevronRight } from "lucide-react";
import { Logo } from "@/ui/components/logo/Logo";

interface OnboardingWelcomeProps {
  onCreateKey: () => void;
  onImportKey: () => void;
}

/**
 * Two ways in, each one tap: a two-way choice needs no confirmation step.
 *
 * The notch sits on "Create New Key" - the path a first-run user almost always
 * takes, and therefore the screen's single primary action (DESIGN_RULES §5) -
 * while "Import Existing Key" is a hairline row.
 */
export function OnboardingWelcome({
  onCreateKey,
  onImportKey,
}: OnboardingWelcomeProps) {
  return (
    <div className="flex min-h-screen flex-col p-4">
      {/* One centred group: hero, heading, sentence, the two rows. The
          bottom padding lifts it a touch above true centre. */}
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center pb-6 text-center">
        <div className="h-28 w-28">
          <Logo size="max" alt="" />
        </div>

        <h1 className="mt-5 text-[22px] font-bold leading-tight tracking-[-0.01em] text-foreground">
          Welcome to Ostrilo
        </h1>

        <p className="screen-description mx-auto mt-2 max-w-[300px]">
          Your keys stay in this browser. Sites ask before anything is signed.
        </p>

        <div
          className="mt-6 w-full space-y-2.5 text-left"
          role="group"
          aria-label="Choose how to start"
        >
          <button
            type="button"
            onClick={onCreateKey}
            className="notch flex w-full items-center gap-3 bg-primary px-5 py-3.5 text-left text-primary-foreground transition-[filter,transform] duration-150 hover:brightness-110 active:translate-y-px"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold leading-tight">
                Create New Key
              </span>
              <span className="mt-1 block text-xs font-medium text-primary-foreground/75">
                A new key, generated on this device
              </span>
            </span>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-primary-foreground/75"
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            onClick={onImportKey}
            className="ink-card flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-muted"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold leading-tight text-foreground">
                Import Existing Key
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Paste an nsec or open a backup file
              </span>
            </span>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-[var(--ink-3)]"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </div>
  );
}

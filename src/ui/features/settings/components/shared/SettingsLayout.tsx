import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Layout for one options tab: a title with at most one sentence, then
 * `.section-label`s over grouped `.ink-card`s of `.ink-row`s. Section labels
 * replace card headers, and nothing gets an icon plate (DESIGN_RULES §4, §6, §7).
 *
 * Tabs import this by path rather than through `shared/index.ts`. The tab
 * tests mock that barrel to stand in for the components that talk to the
 * background; layout is not one of those and should render for real.
 */

interface SettingsTabHeaderProps {
  title: string;
  /** One sentence at most. Leave it out when the section labels say enough. */
  lede?: string;
  /** The screen's single primary action, if it has one. */
  action?: ReactNode;
}

export function SettingsTabHeader({
  title,
  lede,
  action,
}: SettingsTabHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-[52ch]">
        <h2 className="text-xl font-bold leading-tight tracking-[-0.01em] text-foreground">
          {title}
        </h2>
        {lede && (
          <p className="mt-1 text-sm leading-snug text-muted-foreground text-pretty">
            {lede}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

interface SettingsSectionProps {
  label: string;
  /** One line under the card, for the sentence that applies to the whole group. */
  note?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function SettingsSection({
  label,
  note,
  className,
  children,
}: SettingsSectionProps) {
  return (
    <section className={cn("mt-7", className)}>
      <h3 className="section-label mb-2 px-0.5">{label}</h3>
      {children}
      {note && (
        <p className="mt-2 px-0.5 text-[13px] leading-snug text-muted-foreground text-pretty">
          {note}
        </p>
      )}
    </section>
  );
}

interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** Right-aligned value or control (DESIGN_RULES §7). */
  control?: ReactNode;
  className?: string;
}

export function SettingsRow({
  label,
  description,
  control,
  className,
}: SettingsRowProps) {
  return (
    <div className={cn("ink-row", className)}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-snug text-foreground">
          {label}
        </div>
        {description && (
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      {control && (
        <div className="flex shrink-0 items-center gap-3">{control}</div>
      )}
    </div>
  );
}

export function SettingsLoading() {
  return (
    <p className="py-10 text-center text-sm text-muted-foreground">
      Loading settings...
    </p>
  );
}

/**
 * A select at the right edge of a row: borderless value plus chevron
 * (DESIGN_RULES §7, "Selects"). Pass to `SelectTrigger` with `size="sm"`.
 */
export const rowSelectTriggerClassName =
  "-mr-1.5 h-8 w-auto gap-1 border-0 bg-transparent px-1.5 text-sm font-medium text-muted-foreground shadow-none hover:text-foreground";

interface SettingsLinkRowProps {
  /** The tab the row opens, as a hash: OptionsApp reads its tab from there. */
  href: `#${string}`;
  label: ReactNode;
  description?: ReactNode;
  /** The live value, right-aligned before the chevron (DESIGN_RULES §7). */
  value?: ReactNode;
  /** A leading seal mark, when the row stands for an identity. */
  leading?: ReactNode;
}

/**
 * A row that opens another tab, in the settings-list idiom: label, current
 * value, chevron. A plain hash link, so it works with the keyboard, the back
 * button and a middle click, and needs no access to the tab state.
 */
export function SettingsLinkRow({
  href,
  label,
  description,
  value,
  leading,
}: SettingsLinkRowProps) {
  return (
    <a
      href={href}
      className="ink-row text-foreground no-underline transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[var(--ink-violet-soft)]"
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-snug">
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {value !== undefined && (
        <span className="shrink-0 text-sm font-medium text-muted-foreground tabular-nums">
          {value}
        </span>
      )}
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </a>
  );
}

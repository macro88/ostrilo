import { useEffect, useMemo, useState, type Ref } from "react";
import { evaluatePasswordStrength } from "@/infrastructure/messaging/client";
import type { PasswordVerdict as PasswordStrength } from "@/domain/utils/password-policy";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AlertTriangle, Eye, EyeOff, Check, X } from "lucide-react";

// The verdict shape is declared ONCE, in the domain policy module. This file
// used to redeclare it, which is how a UI ended up gating on its own idea of
// what "strong enough" meant.

/**
 * Attributes that keep a field out of the browser's credential machinery and
 * out of third-party password managers.
 *
 * None of this is enforcement. `autoComplete="off"` is advisory and managers
 * routinely ignore it; the `data-*` entries are vendor conventions (1Password,
 * LastPass, Bitwarden) with no specification behind them. They are layered
 * because each one costs nothing and each one independently reduces the chance
 * that a master password or an nsec is captured into a vault the user did not
 * intend, or sent to a spell-check service.
 */
export const NO_AUTOFILL_PROPS = {
  autoComplete: "off" as const,
  spellCheck: false as const,
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
};

/**
 * How long to wait after the last keystroke before asking the background for a
 * verdict.
 *
 * Every call hands the master password across the RPC boundary, where
 * structured clone makes a copy in both realms that neither side can reach in
 * order to clear it. Evaluating per keystroke meant a 20-character password
 * crossed that boundary 20 times. A debounce does not remove the copies, but it
 * turns dozens into a handful, and the meter still feels live.
 */
const STRENGTH_DEBOUNCE_MS = 250;

/** Field label: 13px medium ink, sitting 6px above its input. */
const FIELD_LABEL_CLASS = "mb-1.5 text-[13px]";

/** Popup inputs are 44px tall (DESIGN_RULES §11 hit targets) and 13px type. */
const FIELD_INPUT_CLASS = "h-11 pr-11 text-sm";

interface PasswordInputProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  showStrengthMeter?: boolean;
  confirmValue?: string;
  onConfirmChange?: (value: string) => void;
  error?: string;
  disabled?: boolean;
  /**
   * Distinguishes two password inputs rendered in the same document, which is
   * what the backup passphrase prompt needs: duplicate `id` attributes break
   * label association, so `getByLabelText` finds the wrong field and a user
   * clicking a label focuses the wrong one.
   */
  idPrefix?: string;
  confirmLabel?: string;
  confirmPlaceholder?: string;
  /**
   * Off by default, so every existing caller is unchanged. The lock screen is
   * the one surface where the field is the only thing on the page worth
   * touching, and focusing it there is not a security decision.
   */
  autoFocus?: boolean;
  /**
   * A handle on the password `<input>` itself.
   *
   * The component owns the element, so without this a caller has nothing to
   * clear when the surface's document outlives the attempt - clearing the
   * controlled value leaves the DOM node's own `value` behind.
   */
  inputRef?: Ref<HTMLInputElement>;
  /**
   * Keeps the label for assistive technology and label-based selectors but
   * takes it off the screen. For surfaces where the heading already says what
   * the single field is for, a second line saying it again is noise.
   */
  labelHidden?: boolean;
  /**
   * Marks the field invalid without rendering a message, for callers that
   * announce the failure themselves (the lock screen owns its `role="alert"`).
   */
  invalid?: boolean;
}

function getStrengthColor(score: number) {
  switch (score) {
    case 0:
    case 1:
      return "bg-destructive";
    case 2:
      return "bg-[var(--ink-amber)]";
    case 3:
      return "bg-primary";
    case 4:
      return "bg-[var(--ink-mint)]";
    default:
      return "bg-muted";
  }
}

function getStrengthLabel(score: number) {
  switch (score) {
    case 0:
    case 1:
      return "Very Weak";
    case 2:
      return "Weak";
    case 3:
      return "Good";
    case 4:
      return "Strong";
    default:
      return "";
  }
}

function strengthTextClass(score: number) {
  if (score >= 3) return "text-[var(--ink-mint)]";
  if (score >= 2) return "text-[var(--ink-amber)]";
  return "text-destructive";
}

/**
 * Debounced strength verdict for `value`, or `null` while there is nothing
 * worth showing.
 *
 * Returns `null` on any failure rather than a guess: a UI that invented its own
 * predicate from `score` is exactly how "Aa1!" was once accepted as a vault
 * password. `acceptable` is the background's to decide.
 */
function useDebouncedStrength(
  value: string,
  enabled: boolean
): PasswordStrength | null {
  const [strength, setStrength] = useState<PasswordStrength | null>(null);

  useEffect(() => {
    if (!enabled) {
      // aislop-ignore-next-line react/set-state-in-effect -- clears the verdict when the meter is switched off; deriving it per render would flash a stale verdict on the next keystroke
      setStrength(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      evaluatePasswordStrength(value)
        .then((result) => {
          if (!cancelled) setStrength(result);
        })
        .catch(() => {
          if (!cancelled) setStrength(null);
        });
    }, STRENGTH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, value]);

  return enabled ? strength : null;
}

/**
 * Show/hide, drawn as a full-height 44px strip on the right edge of the field
 * so the eye is a real hit target and not a 16px glyph.
 */
function RevealToggle({
  shown,
  onToggle,
  disabled,
  label,
}: {
  shown: boolean;
  onToggle: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      disabled={disabled}
      aria-label={shown ? `Hide ${label}` : `Show ${label}`}
    >
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

/**
 * Four 4px bars and a one-word verdict on one line. The requirement list only
 * appears while something is still unmet, so a good password costs one line.
 */
function PasswordStrengthMeter({ strength }: { strength: PasswordStrength }) {
  const unmet = strength.requirements.filter((req) => !req.passes);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {[0, 1, 2, 3].map((level) => (
            <div
              key={level}
              className={`h-1 flex-1 rounded-sm ${
                level < strength.score
                  ? getStrengthColor(strength.score)
                  : "bg-muted"
              }`}
            />
          ))}
        </div>
        <span
          className={`text-xs font-semibold ${strengthTextClass(strength.score)}`}
        >
          {getStrengthLabel(strength.score)}
        </span>
      </div>

      {unmet.length > 0 && (
        <ul className="space-y-1">
          {unmet.map((req) => (
            <li
              key={req.label}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <X className="h-3 w-3 shrink-0 text-destructive" />
              <span>{req.label}</span>
            </li>
          ))}
        </ul>
      )}
      {unmet.length === 0 && strength.requirements.length > 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Check className="h-3 w-3 shrink-0 text-[var(--ink-mint)]" />
          Meets every requirement
        </p>
      )}
    </div>
  );
}

/**
 * A field message that assistive technology hears when it appears.
 *
 * `alert` is for a refusal the user caused by submitting, and interrupts. The
 * confirmation mismatch is `status` instead: it is true from the first
 * keystroke of the confirmation until the last, and an assertive announcement
 * on every one of those would talk over the typing.
 */
function ErrorLine({
  id,
  message,
  live,
}: {
  id: string;
  message: string;
  live: "alert" | "status";
}) {
  return (
    <p
      id={id}
      role={live}
      className="flex items-start gap-1.5 text-xs font-medium text-destructive"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  labelHidden?: boolean;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  /** The id of the message that explains `invalid`, when one is on screen. */
  errorId?: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** What the reveal toggle names: "password" or "confirmation password". */
  toggleLabel: string;
}

/**
 * One labelled, maskable field. The password and its confirmation are the
 * same control twice, so the reveal state and the label association live here
 * once rather than being spelled out in both places.
 */
function PasswordField({
  id,
  label,
  labelHidden = false,
  placeholder,
  value,
  onChange,
  disabled,
  invalid,
  errorId,
  autoFocus = false,
  inputRef,
  toggleLabel,
}: PasswordFieldProps) {
  const [shown, setShown] = useState(false);

  return (
    <div>
      <Label
        htmlFor={id}
        className={cn(FIELD_LABEL_CLASS, labelHidden && "sr-only")}
      >
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          ref={inputRef}
          type={shown ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          // aislop-ignore-next-line jsx-a11y/no-autofocus -- opt-in prop, off by default; only the lock screen sets it, where this field is the one thing on the page to use
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          aria-errormessage={invalid ? errorId : undefined}
          className={FIELD_INPUT_CLASS}
          {...NO_AUTOFILL_PROPS}
        />
        <RevealToggle
          shown={shown}
          onToggle={() => setShown(!shown)}
          disabled={disabled}
          label={toggleLabel}
        />
      </div>
    </div>
  );
}

export function PasswordInput({
  label,
  placeholder = "Enter password",
  value,
  onChange,
  showStrengthMeter = false,
  confirmValue,
  onConfirmChange,
  error,
  disabled = false,
  idPrefix = "",
  confirmLabel = "Confirm Password",
  confirmPlaceholder = "Confirm your password",
  autoFocus = false,
  inputRef,
  labelHidden = false,
  invalid = false,
}: PasswordInputProps) {
  const shouldShowStrength = showStrengthMeter && value.length > 0;
  const strength = useDebouncedStrength(value, shouldShowStrength);

  const passwordId = idPrefix ? `${idPrefix}-password` : "password";
  const confirmId = idPrefix ? `${idPrefix}-confirm-password` : "confirm-password";
  const errorId = `${passwordId}-error`;
  const confirmErrorId = `${confirmId}-error`;

  const confirmError = useMemo(() => {
    if (confirmValue === undefined) return "";
    if (confirmValue.length > 0 && confirmValue !== value) {
      return "Passwords do not match";
    }
    return "";
  }, [confirmValue, value]);

  return (
    <div className="space-y-4">
      <div>
        <PasswordField
          id={passwordId}
          label={label}
          labelHidden={labelHidden}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          invalid={Boolean(error) || invalid}
          errorId={error ? errorId : undefined}
          // aislop-ignore-next-line jsx-a11y/no-autofocus -- forwards the same opt-in prop, off by default
          autoFocus={autoFocus}
          inputRef={inputRef}
          toggleLabel="password"
        />
        {showStrengthMeter && strength && (
          <div className="mt-2.5">
            <PasswordStrengthMeter strength={strength} />
          </div>
        )}
      </div>

      {confirmValue !== undefined && onConfirmChange && (
        <PasswordField
          id={confirmId}
          label={confirmLabel}
          placeholder={confirmPlaceholder}
          value={confirmValue}
          onChange={onConfirmChange}
          disabled={disabled}
          invalid={Boolean(confirmError)}
          errorId={confirmError ? confirmErrorId : undefined}
          toggleLabel="confirmation password"
        />
      )}

      {error && <ErrorLine id={errorId} message={error} live="alert" />}
      {confirmError && (
        <ErrorLine id={confirmErrorId} message={confirmError} live="status" />
      )}
    </div>
  );
}

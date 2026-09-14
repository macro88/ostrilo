import { useEffect, useMemo, useState, type Ref } from "react";
import { evaluatePasswordStrength } from "@/infrastructure/messaging/client";
import type { PasswordVerdict as PasswordStrength } from "@/domain/utils/password-policy";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Shield, Check, X } from "lucide-react";

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
      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
      disabled={disabled}
      aria-label={shown ? `Hide ${label}` : `Show ${label}`}
    >
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

function PasswordStrengthMeter({ strength }: { strength: PasswordStrength }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Password Strength</span>
        <span
          className={`text-sm font-medium ${strengthTextClass(strength.score)}`}
        >
          {getStrengthLabel(strength.score)}
        </span>
      </div>

      <div className="flex gap-1">
        {[0, 1, 2, 3].map((level) => (
          <div
            key={level}
            className={`h-2 flex-1 rounded-sm ${
              level < strength.score
                ? getStrengthColor(strength.score)
                : "bg-muted"
            }`}
          />
        ))}
      </div>

      {strength.requirements.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Requirements:</div>
          {strength.requirements.map((req) => (
            <div key={req.label} className="flex items-center gap-2 text-xs">
              {req.passes ? (
                <Check className="h-3 w-3 text-[var(--ink-mint)]" />
              ) : (
                <X className="h-3 w-3 text-destructive" />
              )}
              <span
                className={
                  req.passes ? "text-foreground" : "text-muted-foreground"
                }
              >
                {req.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorChip({ message }: { message: string }) {
  return (
    <div className="seal-chip seal-chip-danger flex">
      <X className="h-4 w-4" />
      {message}
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
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const shouldShowStrength = showStrengthMeter && value.length > 0;
  const strength = useDebouncedStrength(value, shouldShowStrength);

  const passwordId = idPrefix ? `${idPrefix}-password` : "password";
  const confirmId = idPrefix ? `${idPrefix}-confirm-password` : "confirm-password";

  const confirmError = useMemo(() => {
    if (confirmValue === undefined) return "";
    if (confirmValue.length > 0 && confirmValue !== value) {
      return "Passwords do not match";
    }
    return "";
  }, [confirmValue, value]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={passwordId} className="flex items-center gap-2">
          <Shield className="h-4 w-4" />
          {label}
        </Label>
        <div className="relative">
          <Input
            id={passwordId}
            ref={inputRef}
            type={showPassword ? "text" : "password"}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            autoFocus={autoFocus}
            className={error ? "border-destructive" : ""}
            {...NO_AUTOFILL_PROPS}
          />
          <RevealToggle
            shown={showPassword}
            onToggle={() => setShowPassword(!showPassword)}
            disabled={disabled}
            label="password"
          />
        </div>
      </div>

      {showStrengthMeter && strength && (
        <PasswordStrengthMeter strength={strength} />
      )}

      {confirmValue !== undefined && onConfirmChange && (
        <div className="space-y-2">
          <Label htmlFor={confirmId}>{confirmLabel}</Label>
          <div className="relative">
            <Input
              id={confirmId}
              type={showConfirmPassword ? "text" : "password"}
              placeholder={confirmPlaceholder}
              value={confirmValue}
              onChange={(e) => onConfirmChange(e.target.value)}
              disabled={disabled}
              className={confirmError ? "border-destructive" : ""}
              {...NO_AUTOFILL_PROPS}
            />
            <RevealToggle
              shown={showConfirmPassword}
              onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
              disabled={disabled}
              label="confirmation password"
            />
          </div>
        </div>
      )}

      {error && <ErrorChip message={error} />}
      {confirmError && <ErrorChip message={confirmError} />}
    </div>
  );
}

import { useEffect, useState, useMemo } from "react";
import { evaluatePasswordStrength } from "@/infrastructure/messaging/client";
import type { PasswordVerdict as PasswordStrength } from "@/domain/utils/password-policy";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Shield, Check, X } from "lucide-react";

// The verdict shape is declared ONCE, in the domain policy module. This file
// used to redeclare it, which is how a UI ended up gating on its own idea of
// what "strong enough" meant.

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
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const shouldShowStrength = showStrengthMeter && value.length > 0;

  useEffect(() => {
    if (!shouldShowStrength) {
      return;
    }

    let cancelled = false;

    evaluatePasswordStrength(value)
      .then((result) => {
        if (!cancelled) {
          setStrength(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStrength(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shouldShowStrength, value]);

  const confirmError = useMemo(() => {
    if (confirmValue === undefined) return "";
    if (confirmValue.length > 0 && confirmValue !== value) {
      return "Passwords do not match";
    }
    return "";
  }, [confirmValue, value]);

  const displayedStrength = shouldShowStrength ? strength : null;

  return (
    <div className="space-y-3">
      {/* Main password field */}
      <div className="space-y-2">
        <Label htmlFor="password" className="flex items-center gap-2">
          <Shield className="h-4 w-4" />
          {label}
        </Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={error ? "border-destructive" : ""}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
            disabled={disabled}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Strength meter */}
      {showStrengthMeter && displayedStrength && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Password Strength
            </span>
            <span
              className={`text-sm font-medium ${
                displayedStrength.score >= 3
                  ? "text-[var(--ink-mint)]"
                  : displayedStrength.score >= 2
                  ? "text-[var(--ink-amber)]"
                  : "text-destructive"
              }`}
            >
              {getStrengthLabel(displayedStrength.score)}
            </span>
          </div>

          {/* Strength bars */}
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((level) => (
              <div
                key={level}
                className={`h-2 flex-1 rounded-sm ${
                  level < displayedStrength.score
                    ? getStrengthColor(displayedStrength.score)
                    : "bg-muted"
                }`}
              />
            ))}
          </div>

          {/* Requirements checklist */}
          {displayedStrength.requirements.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Requirements:</div>
              {displayedStrength.requirements.map((req) => (
                <div
                  key={req.label}
                  className="flex items-center gap-2 text-xs"
                >
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
      )}

      {/* Confirm password field */}
      {confirmValue !== undefined && onConfirmChange && (
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm Password</Label>
          <div className="relative">
            <Input
              id="confirm-password"
              type={showConfirmPassword ? "text" : "password"}
              placeholder="Confirm your password"
              value={confirmValue}
              onChange={(e) => onConfirmChange(e.target.value)}
              disabled={disabled}
              className={confirmError ? "border-destructive" : ""}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={disabled}
              aria-label={
                showConfirmPassword
                  ? "Hide confirmation password"
                  : "Show confirmation password"
              }
            >
              {showConfirmPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Error messages */}
      {error && (
        <div className="seal-chip seal-chip-danger flex">
          <X className="h-4 w-4" />
          {error}
        </div>
      )}

      {confirmError && (
        <div className="seal-chip seal-chip-danger flex">
          <X className="h-4 w-4" />
          {confirmError}
        </div>
      )}
    </div>
  );
}

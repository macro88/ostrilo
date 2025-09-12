import { useMemo, useState } from "react";
import { evaluatePasswordStrength, PasswordStrength } from "@/lib/crypto";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Shield, Check, X } from "lucide-react";

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
  const strength: PasswordStrength | null = useMemo(() => {
    if (!showStrengthMeter || value.length === 0) return null;
    return evaluatePasswordStrength(value);
  }, [showStrengthMeter, value]);

  const confirmError = useMemo(() => {
    if (confirmValue === undefined) return "";
    if (confirmValue.length > 0 && confirmValue !== value) {
      return "Passwords do not match";
    }
    return "";
  }, [confirmValue, value]);

  const getStrengthColor = (score: number) => {
    switch (score) {
      case 0:
      case 1:
        return "bg-red-500";
      case 2:
        return "bg-yellow-500";
      case 3:
        return "bg-blue-500";
      case 4:
        return "bg-green-500";
      default:
        return "bg-gray-300";
    }
  };

  const getStrengthLabel = (score: number) => {
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
  };

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
            className={error ? "border-red-500" : ""}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
            disabled={disabled}
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
      {showStrengthMeter && strength && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Password Strength
            </span>
            <span
              className={`text-sm font-medium ${
                strength.score >= 3
                  ? "text-green-600"
                  : strength.score >= 2
                  ? "text-yellow-600"
                  : "text-red-600"
              }`}
            >
              {getStrengthLabel(strength.score)}
            </span>
          </div>

          {/* Strength bars */}
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

          {/* Requirements checklist */}
          {strength.feedback.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Requirements:</div>
              {strength.feedback.map((requirement, index) => (
                <div key={index} className="flex items-center gap-2 text-xs">
                  <X className="h-3 w-3 text-red-500" />
                  <span className="text-muted-foreground">{requirement}</span>
                </div>
              ))}
              {/* Show met requirements */}
              {strength.score > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <Check className="h-3 w-3 text-green-500" />
                  <span className="text-muted-foreground">
                    {strength.score >= 2
                      ? "Length and complexity"
                      : "Minimum length"}
                  </span>
                </div>
              )}
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
              className={confirmError ? "border-red-500" : ""}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={disabled}
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
        <div className="text-sm text-red-600 flex items-center gap-2">
          <X className="h-4 w-4" />
          {error}
        </div>
      )}

      {confirmError && (
        <div className="text-sm text-red-600 flex items-center gap-2">
          <X className="h-4 w-4" />
          {confirmError}
        </div>
      )}

      {/* Success indicator */}
      {showStrengthMeter && strength?.meetsMinimum && !error && (
        <div className="text-sm text-green-600 flex items-center gap-2">
          <Check className="h-4 w-4" />
          Password meets security requirements
        </div>
      )}
    </div>
  );
}

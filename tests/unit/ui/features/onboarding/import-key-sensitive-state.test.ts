import { describe, expect, it } from "vitest";
import {
  importKeyReducer,
  initialImportKeyState,
  type ImportKeyState,
} from "@/ui/features/onboarding/components/OnboardingImportKey";

/**
 * The import flow had no clear action at all. Its twin `OnboardingCreateKey`
 * has had `clearSensitiveState` since `secure-key-backup-flow`; this one held
 * `password` and `confirmPassword` in reducer state and rendered its success
 * step with both still held, the component still mounted.
 *
 * These assert **non-retention**: that the reducer stops holding a reference to
 * the entered text. They do not assert erasure. A JavaScript string is
 * immutable, so nothing here - or anywhere else in this codebase - erases one;
 * the engine keeps whatever copies it made. See
 * `openspec/changes/restore-security-test-assurance/specs/security-test-assurance/spec.md:70-80`.
 */

const populated: ImportKeyState = {
  ...initialImportKeyState,
  currentStep: "password",
  keyName: "Recovered identity",
  password: "correct horse battery staple",
  confirmPassword: "correct horse battery staple",
  passwordError: "Failed to import key",
  hasParsedKey: true,
};

describe("import-key sensitive state", () => {
  it("no longer holds the password or its confirmation", () => {
    const next = importKeyReducer(populated, { type: "clearSensitiveState" });

    expect(next.password).toBe("");
    expect(next.confirmPassword).toBe("");
  });

  it("returns a new state object rather than mutating the old one", () => {
    const next = importKeyReducer(populated, { type: "clearSensitiveState" });

    expect(next).not.toBe(populated);
    // The caller's own object is untouched; what matters is that the reducer
    // hands back a state that no longer references the entered text.
    expect(next.password).not.toBe(populated.password);
  });

  it("leaves the non-sensitive fields alone", () => {
    const next = importKeyReducer(populated, { type: "clearSensitiveState" });

    expect(next.keyName).toBe("Recovered identity");
    expect(next.currentStep).toBe("password");
    expect(next.passwordError).toBe("Failed to import key");
  });
});

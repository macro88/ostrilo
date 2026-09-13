import { describe, expect, it } from "vitest";
import {
  createKeyReducer,
  initialCreateKeyState,
  type CreateKeyState,
} from "@/ui/features/onboarding/components/OnboardingCreateKey";

/**
 * `clearSensitiveState` used to reset three display booleans and nothing else.
 * `handleFinish` dispatched exactly this action, so the master password and its
 * confirmation survived in reducer state - and therefore in the React tree -
 * after onboarding completed.
 *
 * These are regression assertions, not behaviour documentation: if any
 * expectation here is deleted, the password is retained again and nothing else
 * in the suite notices.
 */

const populated: CreateKeyState = {
  ...initialCreateKeyState,
  password: "correct horse battery staple",
  confirmPassword: "correct horse battery staple",
  keyName: "Everyday identity",
  step: "backup",
  hasRevealedPrivateKey: true,
  showPrivateKey: true,
  showTranscription: true,
  verified: true,
  revealError: "Failed to reveal key",
  revealNonce: 3,
};

describe("create-key sensitive state", () => {
  it("clears the password and its confirmation", () => {
    const next = createKeyReducer(populated, { type: "clearSensitiveState" });

    expect(next.password).toBe("");
    expect(next.confirmPassword).toBe("");
  });

  it("clears every flag that depends on a revealed key", () => {
    const next = createKeyReducer(populated, { type: "clearSensitiveState" });

    expect(next.hasRevealedPrivateKey).toBe(false);
    expect(next.showPrivateKey).toBe(false);
    expect(next.showTranscription).toBe(false);
    expect(next.revealError).toBe("");
  });

  it("withdraws verification, so Finish cannot stay enabled for a dropped key", () => {
    const next = createKeyReducer(populated, { type: "clearSensitiveState" });

    expect(next.verified).toBe(false);
  });

  it("keeps non-sensitive flow state so the user does not lose their place", () => {
    const next = createKeyReducer(populated, { type: "clearSensitiveState" });

    expect(next.keyName).toBe("Everyday identity");
    expect(next.step).toBe("backup");
  });

  it("never holds key material in reducer state in the first place", () => {
    const revealed = createKeyReducer(populated, {
      type: "privateKeyRevealed",
    });

    // The reveal records that it happened and bumps a nonce. Nothing else.
    expect(JSON.stringify(revealed)).not.toMatch(/nsec1/);
    expect(revealed.hasRevealedPrivateKey).toBe(true);
    expect(revealed.revealNonce).toBe(populated.revealNonce + 1);
    expect(Object.keys(revealed)).toEqual(Object.keys(initialCreateKeyState));
  });

  it("starts with an empty password and no verification", () => {
    expect(initialCreateKeyState.password).toBe("");
    expect(initialCreateKeyState.confirmPassword).toBe("");
    expect(initialCreateKeyState.verified).toBe(false);
  });
});

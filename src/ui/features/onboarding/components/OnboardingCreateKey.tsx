import { describeViolation } from "@/domain/utils/password-policy";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useKeyManager } from "../../authentication/hooks/useKeyManager";
import {
  generateKey as rpcGenerateKey,
  unlockVault,
  evaluatePasswordStrength,
  revealKey,
} from "@/infrastructure/messaging/client";
import { useOnboarding } from "../hooks/useOnboarding";
import { OnboardingCreateKeyBackupStep } from "./OnboardingCreateKeyBackupStep";
import { OnboardingCreateKeyInputStep } from "./OnboardingCreateKeyInputStep";
import { OnboardingStepDots } from "./OnboardingStepDots";
import { VERIFICATION_SUFFIX_LENGTH } from "./backup/BackupVerification";
import {
  CLIPBOARD_CLEAR_MS,
  useExpiringClipboard,
} from "../backup/useExpiringClipboard";
import type { KeyBackupPayload } from "../backup/key-backup-envelope";

interface OnboardingCreateKeyProps {
  onBack: () => void;
  onComplete: () => void;
}

export interface CreateKeyState {
  password: string;
  confirmPassword: string;
  keyName: string;
  passwordError: string;
  revealError: string;
  isGenerating: boolean;
  /** A statement of understanding, not the gate. Verification is the gate. */
  acknowledged: boolean;
  step: "input" | "backup";
  showPrivateKey: boolean;
  hasRevealedPrivateKey: boolean;
  /** Bumped per reveal so the display re-reads the ref it is fed from. */
  revealNonce: number;
  showTranscription: boolean;
  backupFileSaved: boolean;
  verified: boolean;
}

export type CreateKeyAction =
  | { type: "setPassword"; value: string }
  | { type: "setConfirmPassword"; value: string }
  | { type: "setKeyName"; value: string }
  | { type: "setPasswordError"; value: string }
  | { type: "setRevealError"; value: string }
  | { type: "setGenerating"; value: boolean }
  | { type: "setAcknowledged"; value: boolean }
  | { type: "setStep"; value: CreateKeyState["step"] }
  | { type: "togglePrivateKey" }
  | { type: "toggleTranscription" }
  | { type: "privateKeyRevealed" }
  | { type: "setBackupFileSaved" }
  | { type: "setVerified" }
  | { type: "clearSensitiveState" };

export const initialCreateKeyState: CreateKeyState = {
  password: "",
  confirmPassword: "",
  keyName: "",
  passwordError: "",
  revealError: "",
  isGenerating: false,
  acknowledged: false,
  step: "input",
  showPrivateKey: false,
  hasRevealedPrivateKey: false,
  revealNonce: 0,
  showTranscription: false,
  backupFileSaved: false,
  verified: false,
};

export function createKeyReducer(
  state: CreateKeyState,
  action: CreateKeyAction
): CreateKeyState {
  switch (action.type) {
    case "setPassword":
      return { ...state, password: action.value };
    case "setConfirmPassword":
      return { ...state, confirmPassword: action.value };
    case "setKeyName":
      return { ...state, keyName: action.value };
    case "setPasswordError":
      return { ...state, passwordError: action.value };
    case "setRevealError":
      return { ...state, revealError: action.value };
    case "setGenerating":
      return { ...state, isGenerating: action.value };
    case "setAcknowledged":
      return { ...state, acknowledged: action.value };
    case "setStep":
      return { ...state, step: action.value };
    case "togglePrivateKey":
      return { ...state, showPrivateKey: !state.showPrivateKey };
    case "toggleTranscription":
      return { ...state, showTranscription: !state.showTranscription };
    case "privateKeyRevealed":
      return {
        ...state,
        hasRevealedPrivateKey: true,
        showPrivateKey: false,
        revealError: "",
        revealNonce: state.revealNonce + 1,
      };
    case "setBackupFileSaved":
      return { ...state, backupFileSaved: true };
    case "setVerified":
      return { ...state, verified: true };
    /**
     * This used to reset three display booleans and stop. `password` and
     * `confirmPassword` were left untouched, so `handleFinish` - which dispatched
     * exactly this action - left the master password sitting in reducer state,
     * and therefore in the React tree, for as long as the document lived after
     * onboarding finished.
     *
     * Everything downstream of a reveal goes with them: a cleared key must not
     * leave a satisfied verification behind, or Finish would stay enabled for a
     * key the flow can no longer show.
     */
    case "clearSensitiveState":
      return {
        ...state,
        password: "",
        confirmPassword: "",
        hasRevealedPrivateKey: false,
        showPrivateKey: false,
        showTranscription: false,
        verified: false,
        revealError: "",
      };
  }
}

export function OnboardingCreateKey({
  onBack,
  onComplete,
}: OnboardingCreateKeyProps) {
  const { isLoading } = useKeyManager();
  const [state, dispatch] = useReducer(createKeyReducer, initialCreateKeyState);
  const { markOnboardingComplete } = useOnboarding();
  const clipboard = useExpiringClipboard();

  // Use refs for ephemeral sensitive data (not useState)
  const privateKeyRef = useRef<{ nsec: string; hex: string } | null>(null);
  const passwordBackupRef = useRef<string>("");

  /**
   * The single teardown. Every exit from the flow runs it: finishing, stepping
   * back off the backup step, a failed reveal, and unmount. Previously only
   * `handleFinish` did, so closing the popup mid-flow left both refs populated.
   */
  const dropKeyMaterial = useCallback(() => {
    privateKeyRef.current = null;
    passwordBackupRef.current = "";
  }, []);

  useEffect(() => dropKeyMaterial, [dropKeyMaterial]);

  const getNsec = useCallback(() => privateKeyRef.current?.nsec ?? null, []);

  const getBackupPayload = useCallback(
    (): KeyBackupPayload | null => {
      const key = privateKeyRef.current;
      if (!key) return null;
      return { nsec: key.nsec, hex: key.hex, name: state.keyName.trim() };
    },
    [state.keyName]
  );

  const verifySuffix = useCallback((value: string) => {
    const nsec = privateKeyRef.current?.nsec;
    if (!nsec || value.length !== VERIFICATION_SUFFIX_LENGTH) return false;
    return (
      nsec.slice(-VERIFICATION_SUFFIX_LENGTH).toLowerCase() ===
      value.toLowerCase()
    );
  }, []);

  const verifyNsec = useCallback((nsec: string) => {
    const current = privateKeyRef.current?.nsec;
    return Boolean(current) && current === nsec;
  }, []);

  const validatePassword = async () => {
    if (!state.password) {
      dispatch({ type: "setPasswordError", value: "Password is required" });
      return false;
    }

    if (state.password !== state.confirmPassword) {
      dispatch({ type: "setPasswordError", value: "Passwords do not match" });
      return false;
    }

    try {
      // The verdict comes from the background, which has the blocklist, so
      // `acceptable` is authoritative. This used to be `strength.score < 3`,
      // re-implementing half of the domain predicate and dropping its length
      // term - which is why "Aa1!" was accepted as a vault password.
      const strength = await evaluatePasswordStrength(state.password);
      if (!strength.acceptable) {
        dispatch({
          type: "setPasswordError",
          value:
            strength.violations.length > 0
              ? describeViolation(strength.violations[0])
              : "Password does not meet the policy.",
        });
        return false;
      }
    } catch {
      dispatch({
        type: "setPasswordError",
        value: "Could not validate password strength",
      });
      return false;
    }

    if (!state.keyName.trim()) {
      dispatch({ type: "setPasswordError", value: "Key name is required" });
      return false;
    }

    dispatch({ type: "setPasswordError", value: "" });
    return true;
  };

  const handleGenerateKey = async () => {
    if (!(await validatePassword())) return;

    dispatch({ type: "setGenerating", value: true });
    try {
      // Generate key in background and set as selected if first
      await rpcGenerateKey(state.password, state.keyName.trim());
      // Immediately unlock session so user can proceed
      await unlockVault(state.password);
      // Store password in ref for backup step (not in state)
      passwordBackupRef.current = state.password;
      dispatch({ type: "setStep", value: "backup" });
    } catch (error) {
      dispatch({
        type: "setPasswordError",
        value: error instanceof Error ? error.message : "Failed to generate key",
      });
    } finally {
      dispatch({ type: "setGenerating", value: false });
    }
  };

  const handleRevealKey = async () => {
    if (!passwordBackupRef.current) {
      dispatch({ type: "setRevealError", value: "Password not available" });
      return;
    }

    try {
      // `revealKey` re-derives the KEK from this password and the record salt
      // and verifies it by decrypting. An unlocked session is not enough.
      const revealed = await revealKey(passwordBackupRef.current);
      privateKeyRef.current = revealed;
      dispatch({ type: "privateKeyRevealed" });
    } catch (error) {
      // Fail closed: a half-completed reveal must not leave stale material, and
      // the message comes from the RPC layer, which never echoes key bytes.
      privateKeyRef.current = null;
      dispatch({
        type: "setRevealError",
        value: error instanceof Error ? error.message : "Failed to reveal key",
      });
    }
  };

  const handleCopyKey = async () => {
    const nsec = privateKeyRef.current?.nsec;
    if (!nsec) return;
    const copied = await clipboard.copy(nsec);
    if (!copied && !state.showTranscription) {
      // The Clipboard API rejects when the document is not focused or the API
      // is unavailable. The old code logged and moved on, leaving the user with
      // no key and no explanation.
      dispatch({ type: "toggleTranscription" });
    }
  };

  const handleBackToInput = () => {
    void clipboard.clearNow();
    dropKeyMaterial();
    dispatch({ type: "clearSensitiveState" });
    dispatch({ type: "setStep", value: "input" });
  };

  const handleFinish = async () => {
    if (!state.verified) return;
    await clipboard.clearNow();
    dropKeyMaterial();
    dispatch({ type: "clearSensitiveState" });
    await markOnboardingComplete();
    onComplete();
  };

  return (
    <div className="flex min-h-screen flex-col p-4">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        {/* Welcome · this step · backup. The dots are the only chrome above
            the title; there is no icon plate and no back arrow up here, Back
            lives in the action row where the rules put it. */}
        <OnboardingStepDots
          count={3}
          active={state.step === "input" ? 1 : 2}
          className="mb-5"
        />

        {state.step === "input" && (
          <OnboardingCreateKeyInputStep
            keyName={state.keyName}
            password={state.password}
            confirmPassword={state.confirmPassword}
            passwordError={state.passwordError}
            isGenerating={state.isGenerating || isLoading}
            onBack={onBack}
            onKeyNameChange={(value) =>
              dispatch({ type: "setKeyName", value })
            }
            onPasswordChange={(value) =>
              dispatch({ type: "setPassword", value })
            }
            onConfirmPasswordChange={(value) =>
              dispatch({ type: "setConfirmPassword", value })
            }
            onGenerate={handleGenerateKey}
          />
        )}

        {state.step === "backup" && (
          <OnboardingCreateKeyBackupStep
            getNsec={getNsec}
            getBackupPayload={getBackupPayload}
            revealNonce={state.revealNonce}
            showPrivateKey={state.showPrivateKey}
            hasRevealedPrivateKey={state.hasRevealedPrivateKey}
            showTranscription={state.showTranscription}
            clipboardStatus={clipboard.status}
            clipboardSecondsRemaining={clipboard.secondsRemaining}
            clipboardWindowSeconds={Math.round(CLIPBOARD_CLEAR_MS / 1000)}
            backupFileSaved={state.backupFileSaved}
            verified={state.verified}
            acknowledged={state.acknowledged}
            revealError={state.revealError}
            onReveal={handleRevealKey}
            onToggleShowPrivateKey={() => dispatch({ type: "togglePrivateKey" })}
            onToggleTranscription={() =>
              dispatch({ type: "toggleTranscription" })
            }
            onCopy={handleCopyKey}
            onClearClipboard={() => void clipboard.clearNow()}
            onBackupFileSaved={() => dispatch({ type: "setBackupFileSaved" })}
            onVerifySuffix={verifySuffix}
            onVerifyNsec={verifyNsec}
            onVerified={() => dispatch({ type: "setVerified" })}
            onAcknowledgedChange={(value) =>
              dispatch({ type: "setAcknowledged", value })
            }
            onBack={handleBackToInput}
            onFinish={handleFinish}
          />
        )}
      </div>
    </div>
  );
}

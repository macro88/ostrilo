import { useReducer, useRef } from "react";
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

interface OnboardingCreateKeyProps {
  onBack: () => void;
  onComplete: () => void;
}

interface CreateKeyState {
  password: string;
  confirmPassword: string;
  keyName: string;
  passwordError: string;
  isGenerating: boolean;
  backupChecked: boolean;
  step: "input" | "backup";
  showPrivateKey: boolean;
  hasRevealedPrivateKey: boolean;
  copySuccess: boolean;
}

type CreateKeyAction =
  | { type: "setPassword"; value: string }
  | { type: "setConfirmPassword"; value: string }
  | { type: "setKeyName"; value: string }
  | { type: "setPasswordError"; value: string }
  | { type: "setGenerating"; value: boolean }
  | { type: "setBackupChecked"; value: boolean }
  | { type: "setStep"; value: CreateKeyState["step"] }
  | { type: "togglePrivateKey" }
  | { type: "privateKeyRevealed" }
  | { type: "setCopySuccess"; value: boolean }
  | { type: "clearSensitiveState" };

const initialCreateKeyState: CreateKeyState = {
  password: "",
  confirmPassword: "",
  keyName: "",
  passwordError: "",
  isGenerating: false,
  backupChecked: false,
  step: "input",
  showPrivateKey: false,
  hasRevealedPrivateKey: false,
  copySuccess: false,
};

function createKeyReducer(
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
    case "setGenerating":
      return { ...state, isGenerating: action.value };
    case "setBackupChecked":
      return { ...state, backupChecked: action.value };
    case "setStep":
      return { ...state, step: action.value };
    case "togglePrivateKey":
      return { ...state, showPrivateKey: !state.showPrivateKey };
    case "privateKeyRevealed":
      return {
        ...state,
        hasRevealedPrivateKey: true,
        showPrivateKey: false,
      };
    case "setCopySuccess":
      return { ...state, copySuccess: action.value };
    case "clearSensitiveState":
      return {
        ...state,
        hasRevealedPrivateKey: false,
        showPrivateKey: false,
        copySuccess: false,
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

  // Use refs for ephemeral sensitive data (not useState)
  const privateKeyRef = useRef<{ nsec: string; hex: string } | null>(null);
  const passwordBackupRef = useRef<string>("");

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
      const strength = await evaluatePasswordStrength(state.password);
      // Use score instead of meetsMinimum property - score of 3+ is recommended for strong passwords
      if (strength.score < 3) {
        dispatch({
          type: "setPasswordError",
          value: "Password does not meet minimum requirements",
        });
        return false;
      }
    } catch (error) {
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
      dispatch({ type: "setPasswordError", value: "Password not available" });
      return;
    }

    try {
      // Reveal key with password verification - stored ephemerally in ref
      const revealed = await revealKey(passwordBackupRef.current);
      privateKeyRef.current = revealed;
      dispatch({ type: "privateKeyRevealed" });
    } catch (error) {
      dispatch({
        type: "setPasswordError",
        value: error instanceof Error ? error.message : "Failed to reveal key",
      });
    }
  };

  const handleCopyKey = async () => {
    const privateKey = privateKeyRef.current;
    if (!privateKey) return;
    try {
      await navigator.clipboard.writeText(privateKey.nsec);
      dispatch({ type: "setCopySuccess", value: true });
      window.setTimeout(
        () => dispatch({ type: "setCopySuccess", value: false }),
        2000
      );
    } catch (error) {
      console.error("Failed to copy key:", error);
    }
  };

  const handleDownloadKey = () => {
    const privateKey = privateKeyRef.current;
    if (!privateKey) return;
    const keyData = {
      name: state.keyName,
      privateKey: privateKey.nsec,
      privateKeyHex: privateKey.hex,
      createdAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(keyData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ostrilo-key-${state.keyName.replace(
      /\s+/g,
      "-"
    )}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFinish = async () => {
    if (!state.backupChecked) return;
    // Clear sensitive data from refs
    privateKeyRef.current = null;
    passwordBackupRef.current = "";
    dispatch({ type: "clearSensitiveState" });
    await markOnboardingComplete();
    onComplete();
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
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
            keyName={state.keyName}
            privateKey={privateKeyRef.current}
            showPrivateKey={state.showPrivateKey}
            hasRevealedPrivateKey={state.hasRevealedPrivateKey}
            copySuccess={state.copySuccess}
            backupChecked={state.backupChecked}
            onReveal={handleRevealKey}
            onToggleShowPrivateKey={() => dispatch({ type: "togglePrivateKey" })}
            onCopy={handleCopyKey}
            onDownload={handleDownloadKey}
            onBack={() => dispatch({ type: "setStep", value: "input" })}
            onBackupCheckedChange={(value) =>
              dispatch({ type: "setBackupChecked", value })
            }
            onFinish={handleFinish}
          />
        )}
      </div>
    </div>
  );
}

import { useCallback, useLayoutEffect, useReducer, useRef } from "react";
import { useEncryptedBackupImport } from "../backup/useEncryptedBackupImport";
import type { KeyBackupPayload } from "@/ui/features/backup/key-backup-envelope";
import { useKeyManager } from "../../authentication/hooks/useKeyManager";
import {
  importKey as rpcImportKey,
  unlockVault,
  parsePrivateKey,
} from "@/infrastructure/messaging/client";
import { OnboardingImportKeyStep } from "./OnboardingImportKeyStep";
import { OnboardingImportPasswordStep } from "./OnboardingImportPasswordStep";
import { OnboardingImportSuccessStep } from "./OnboardingImportSuccessStep";
import { OnboardingStepDots } from "./OnboardingStepDots";
import { newPasswordProblem } from "../validate-new-password";
import { userFacingError } from "@/ui/lib/user-facing-error";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";

interface OnboardingImportKeyProps {
  onBack: () => void;
  onComplete: () => void;
}

type ImportStep = "import" | "password" | "success";

export interface ImportKeyState {
  currentStep: ImportStep;
  keyName: string;
  showPrivateKey: boolean;
  importError: string;
  password: string;
  confirmPassword: string;
  passwordError: string;
  hasParsedKey: boolean;
}

export type ImportKeyAction =
  | { type: "setStep"; value: ImportStep }
  | { type: "setKeyName"; value: string }
  | { type: "togglePrivateKey" }
  | { type: "setImportError"; value: string }
  | { type: "setPassword"; value: string }
  | { type: "setConfirmPassword"; value: string }
  | { type: "setPasswordError"; value: string }
  | { type: "setHasParsedKey"; value: boolean }

  /**
   * Drops the master password and its confirmation from reducer state.
   *
   * Mirrors `clearSensitiveState` in `OnboardingCreateKey.tsx:125-135`. This
   * flow had no such action at all, so the success step rendered with both
   * values still held, for as long as the document lived.
   */
  | { type: "clearSensitiveState" };

const importSteps: ImportStep[] = ["import", "password", "success"];

export const initialImportKeyState: ImportKeyState = {
  currentStep: "import",
  keyName: "",
  showPrivateKey: false,
  importError: "",
  password: "",
  confirmPassword: "",
  passwordError: "",
  hasParsedKey: false,
};

export function importKeyReducer(
  state: ImportKeyState,
  action: ImportKeyAction
): ImportKeyState {
  switch (action.type) {
    case "setStep":
      return { ...state, currentStep: action.value };
    case "setKeyName":
      return { ...state, keyName: action.value };
    case "togglePrivateKey":
      return { ...state, showPrivateKey: !state.showPrivateKey };
    case "setImportError":
      return { ...state, importError: action.value };
    case "setPassword":
      return { ...state, password: action.value };
    case "setConfirmPassword":
      return { ...state, confirmPassword: action.value };
    case "setPasswordError":
      return { ...state, passwordError: action.value };
    case "setHasParsedKey":
      return { ...state, hasParsedKey: action.value };
    case "clearSensitiveState":
      return { ...state, password: "", confirmPassword: "" };
  }
}

interface ImportFileDeps {
  privateKeyInput: HTMLInputElement | null;
  /** Returns true when the file was an encrypted Ostrilo backup and was held. */
  offerFile: (content: string, fileName: string) => boolean;
  keyName: string;
  dispatch: (action: ImportKeyAction) => void;
}

/**
 * Routes a selected file into the private-key input.
 *
 * Lives outside the component because it needs none of its state, only the
 * four things named above.
 */
function readSelectedKeyFile(
  event: React.ChangeEvent<HTMLInputElement>,
  deps: ImportFileDeps
) {
  const file = event.target.files?.[0];
  if (!file) return;
  const fileName = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;

      // An Ostrilo encrypted backup is not readable without its passphrase, so
      // it cannot be dropped straight into the key field the way the old
      // plaintext export could. Hold the ciphertext and ask.
      if (deps.offerFile(content, fileName)) {
        deps.dispatch({ type: "setImportError", value: "" });
        return;
      }

      try {
        const keyData = JSON.parse(content);
        // Reads the plaintext export this build no longer writes. Files that
        // already exist on disk still have to be importable; the requirement is
        // that nothing produces another one.
        if (keyData.privateKey) {
          if (deps.privateKeyInput) {
            deps.privateKeyInput.value = keyData.privateKey;
          }
          if (keyData.name && !deps.keyName) {
            deps.dispatch({ type: "setKeyName", value: keyData.name });
          }
        } else if (deps.privateKeyInput) {
          deps.privateKeyInput.value = content.trim();
        }
      } catch {
        // Not JSON, treat as raw key
        if (deps.privateKeyInput) {
          deps.privateKeyInput.value = content.trim();
        }
      }
    } catch {
      deps.dispatch({ type: "setImportError", value: "Failed to read file" });
    }
  };
  reader.readAsText(file);

  // Clear the input so the same file can be selected again
  event.target.value = "";
}

export function OnboardingImportKey({
  onBack,
  onComplete,
}: OnboardingImportKeyProps) {
  const { isLoading } = useKeyManager();
  const [state, dispatch] = useReducer(
    importKeyReducer,
    initialImportKeyState
  );

  // Import state - Use refs to avoid storing secret in React state
  const privateKeyRef = useRef<HTMLInputElement>(null);
  const privateKeyValueRef = useRef<string | null>(null);
  // Holds only whether the input validated. The private key bytes are never
  // sent to the UI: crypto.parsePrivateKey returns a verdict.
  const parsedKeyRef = useRef<boolean>(false);

  /**
   * The single teardown, matching `dropKeyMaterial` in
   * `OnboardingCreateKey.tsx:157-162`. The file previously had no `useEffect`
   * at all, so leaving the flow mid-way left the password in reducer state and
   * the nsec in both the input element and a ref.
   *
   * What this does: it overwrites a DOM property and drops two references. It
   * does not erase the strings - a JavaScript string is immutable, and the
   * engine keeps whatever copies it made.
   */
  const dropSensitiveState = useCallback(() => {
    // Refs first. On the unmount path the dispatch below is discarded by React,
    // and these are what would otherwise still be reachable.
    if (privateKeyRef.current) {
      privateKeyRef.current.value = "";
    }
    privateKeyValueRef.current = null;
    parsedKeyRef.current = false;
    dispatch({ type: "clearSensitiveState" });
  }, []);

  // A layout effect, not a passive one: React detaches `privateKeyRef` before
  // passive cleanups run, so a passive teardown would find it already null and
  // leave the nsec in the input element.
  useLayoutEffect(() => dropSensitiveState, [dropSensitiveState]);

  /**
   * A key recovered from an encrypted backup lands in the same input a typed
   * nsec does, so it takes the same path: validated, then re-encrypted under
   * the master password the user chooses on the next step.
   */
  const handleRecoveredBackup = useCallback(
    (payload: KeyBackupPayload) => {
      if (privateKeyRef.current) {
        privateKeyRef.current.value = payload.nsec;
      }
      if (payload.name && !state.keyName) {
        dispatch({ type: "setKeyName", value: payload.name });
      }
    },
    [state.keyName]
  );

  const backupImport = useEncryptedBackupImport(handleRecoveredBackup);

  const validateImport = async () => {
    const keyInput = privateKeyRef.current?.value.trim();
    if (!keyInput) {
      dispatch({ type: "setImportError", value: "Private key is required" });
      return false;
    }

    if (!state.keyName.trim()) {
      dispatch({ type: "setImportError", value: "Key name is required" });
      return false;
    }

    try {
      await parsePrivateKey(keyInput);
      parsedKeyRef.current = true;
      privateKeyValueRef.current = keyInput;
      dispatch({ type: "setImportError", value: "" });
      dispatch({ type: "setHasParsedKey", value: true });
      return true;
    } catch (error) {
      dispatch({
        type: "setImportError",
        value:
          userFacingError(error, "That is not a valid private key. Paste an nsec1 key or 64 hex characters."),
      });
      dispatch({ type: "setHasParsedKey", value: false });
      return false;
    }
  };

  const validatePassword = async () => {
    const problem = await newPasswordProblem(
      state.password,
      state.confirmPassword
    );
    dispatch({ type: "setPasswordError", value: problem });
    return problem === "";
  };

  const handleImportKey = async () => {
    if (!(await validateImport())) return;
    dispatch({ type: "setStep", value: "password" });
  };

  const handleSetPassword = async () => {
    if (!(await validatePassword()) || !parsedKeyRef.current) return;

    const keyInput = privateKeyValueRef.current;
    if (!keyInput) {
      dispatch({
        type: "setPasswordError",
        value: "Private key is no longer available",
      });
      return;
    }

    try {
      await rpcImportKey(keyInput, state.password, state.keyName.trim());
      await unlockVault(state.password);

      // Before the success step renders, not after: the component stays mounted
      // behind it, and it used to stay mounted holding the master password.
      dropSensitiveState();
      dispatch({ type: "setHasParsedKey", value: false });
      dispatch({ type: "setStep", value: "success" });
    } catch (error) {
      // The password goes, the key does not: `dropSensitiveState` would also
      // drop `privateKeyValueRef`, and `handleSetPassword` bails with "Private
      // key is no longer available" without it - so a failed import could not
      // be retried from this step. The user retypes the password, as they do
      // after a failed unlock.
      dispatch({ type: "clearSensitiveState" });
      dispatch({
        type: "setPasswordError",
        value: userFacingError(error, "Could not import the key. Try again.", {
          [RPC_ERROR_CODES.INVALID_KEY_INPUT]: "That is not a valid private key. Paste an nsec1 key or 64 hex characters.",
          [RPC_ERROR_CODES.KEY_ALREADY_EXISTS]: "This key is already in your vault.",
          [RPC_ERROR_CODES.INVALID_PASSWORD]: "That password was not accepted. Use at least 12 characters, and avoid common passwords and patterns.",
        }),
      });
    }
  };

  const currentStepIndex = importSteps.indexOf(state.currentStep);

  return (
    <div className="flex min-h-screen flex-col p-4">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        {/* Welcome · key · password. The success screen keeps the last dot
            lit: it is the end of the same three steps, not a fourth. */}
        <OnboardingStepDots
          count={importSteps.length}
          active={Math.min(currentStepIndex + 1, importSteps.length - 1)}
          className="mb-5"
        />

        {state.currentStep === "import" && (
          <OnboardingImportKeyStep
            keyName={state.keyName}
            showPrivateKey={state.showPrivateKey}
            importError={state.importError}
            isLoading={isLoading}
            privateKeyRef={privateKeyRef}
            backupFileName={backupImport.fileName}
            backupPassphrase={backupImport.passphrase}
            backupError={backupImport.error}
            backupBusy={backupImport.busy}
            onBack={onBack}
            onKeyNameChange={(value) =>
              dispatch({ type: "setKeyName", value })
            }
            onTogglePrivateKey={() => dispatch({ type: "togglePrivateKey" })}
            onFileUpload={(event) =>
              readSelectedKeyFile(event, {
                privateKeyInput: privateKeyRef.current,
                offerFile: backupImport.offerFile,
                keyName: state.keyName,
                dispatch,
              })
            }
            onBackupPassphraseChange={backupImport.setPassphrase}
            onUnlockBackup={() => void backupImport.unlock()}
            onCancelBackup={backupImport.cancel}
            onContinue={handleImportKey}
          />
        )}

        {state.currentStep === "password" && (
          <OnboardingImportPasswordStep
            keyName={state.keyName}
            password={state.password}
            confirmPassword={state.confirmPassword}
            passwordError={state.passwordError}
            hasParsedKey={state.hasParsedKey}
            isLoading={isLoading}
            onBack={() => dispatch({ type: "setStep", value: "import" })}
            onPasswordChange={(value) =>
              dispatch({ type: "setPassword", value })
            }
            onConfirmPasswordChange={(value) =>
              dispatch({ type: "setConfirmPassword", value })
            }
            onImport={handleSetPassword}
          />
        )}

        {state.currentStep === "success" && (
          <OnboardingImportSuccessStep
            keyName={state.keyName}
            onStart={onComplete}
          />
        )}
      </div>
    </div>
  );
}

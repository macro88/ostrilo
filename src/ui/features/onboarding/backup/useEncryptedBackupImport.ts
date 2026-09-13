import { useCallback, useEffect, useRef, useState } from "react";
import {
  BACKUP_DECRYPT_FAILURE_MESSAGE,
  KeyBackupError,
  openKeyBackup,
  parseKeyBackupEnvelope,
  type KeyBackupEnvelopeV1,
  type KeyBackupPayload,
} from "./key-backup-envelope";

export interface EncryptedBackupImport {
  /** Name of the pending backup file, or "" when none is selected. */
  fileName: string;
  passphrase: string;
  error: string;
  busy: boolean;
  setPassphrase: (value: string) => void;
  /**
   * `true` when the text was an Ostrilo encrypted backup and has been taken
   * over by this hook. `false` means the caller should handle it as before.
   */
  offerFile: (content: string, fileName: string) => boolean;
  unlock: () => Promise<void>;
  cancel: () => void;
}

/**
 * The read side of the encrypted backup format.
 *
 * Never ship an export format nothing can read: an encrypted backup that the
 * import path does not understand is a file the user believes is a recovery and
 * is not. The recovered key is handed to `onRecovered` and dropped here; it is
 * the caller's existing import path that re-encrypts it under the master
 * password the user is choosing, so this hook writes plaintext nowhere.
 */
export function useEncryptedBackupImport(
  onRecovered: (payload: KeyBackupPayload) => void
): EncryptedBackupImport {
  const [fileName, setFileName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const envelopeRef = useRef<KeyBackupEnvelopeV1 | null>(null);

  useEffect(() => {
    return () => {
      envelopeRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    envelopeRef.current = null;
    setFileName("");
    setPassphrase("");
    setError("");
  }, []);

  const offerFile = useCallback((content: string, name: string) => {
    const envelope = parseKeyBackupEnvelope(content);
    if (!envelope) return false;
    envelopeRef.current = envelope;
    setFileName(name);
    setPassphrase("");
    setError("");
    return true;
  }, []);

  const unlock = useCallback(async () => {
    const envelope = envelopeRef.current;
    if (!envelope) return;

    setBusy(true);
    try {
      const payload = await openKeyBackup(envelope, passphrase);
      onRecovered(payload);
      // The caller has copied what it needs into the key input by now.
      payload.nsec = "";
      payload.hex = "";
      envelopeRef.current = null;
      setFileName("");
      setPassphrase("");
      setError("");
    } catch (caught) {
      // Fails closed. The message names neither the key nor the passphrase,
      // because AES-GCM cannot tell a wrong passphrase from a tampered file and
      // a message that claimed to would be telling an attacker holding the file
      // which guess was closest.
      setError(
        caught instanceof KeyBackupError
          ? caught.message
          : BACKUP_DECRYPT_FAILURE_MESSAGE
      );
    } finally {
      setBusy(false);
    }
  }, [onRecovered, passphrase]);

  return {
    fileName,
    passphrase,
    error,
    busy,
    setPassphrase,
    offerFile,
    unlock,
    cancel,
  };
}

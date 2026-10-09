import { useCallback, useEffect, useRef, useState } from "react";
import { revealKey } from "@/infrastructure/messaging/client";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import type { useReauth } from "@/ui/hooks/useReauth";
import type { KeyBackupPayload } from "../key-backup-envelope";

export interface BackupTarget {
  id: string;
  label: string;
}

/**
 * Backing up one key from Settings: password, reveal, then the dialog that
 * writes and checks the file.
 *
 * The revealed key lives in a ref and nowhere else, as in onboarding. The
 * dialog is handed an accessor, never the value: a prop would be retained in
 * the element's `memoizedProps` for as long as the fiber lives, which outlasts
 * the ref.
 *
 * The ref is emptied on every way out: close, a finished backup, the vault
 * locking, and unmount.
 */
export function useKeyBackup(reauth: ReturnType<typeof useReauth>) {
  const { isLocked } = useKeyManager();
  const keyRef = useRef<KeyBackupPayload | null>(null);
  const [target, setTarget] = useState<BackupTarget | null>(null);
  // Latched for the attempt: an unlock after the lock does not bring the
  // dropped key back, so the dialog must keep saying the flow was stopped.
  const [lockedAttempt, setLockedAttempt] = useState(false);
  if (target !== null && isLocked && !lockedAttempt) setLockedAttempt(true);

  const release = useCallback(() => {
    keyRef.current = null;
  }, []);

  useEffect(() => release, [release]);

  // A locked vault must not leave a revealed key behind. The dialog reads
  // `lockedMidBackup` to say why the flow stopped.
  useEffect(() => {
    if (isLocked) release();
  }, [isLocked, release]);

  const start = useCallback(
    async (next: BackupTarget) => {
      release();
      setLockedAttempt(false);
      try {
        await reauth.request(
          {
            action: `Back up “${next.label}”.`,
            consequence:
              "Your password lets Ostrilo seal this key into a file you keep. The key is shown to no one.",
          },
          async (password) => {
            // Re-verified against the vault record; an unlocked session alone
            // is not enough to release a key.
            const revealed = await revealKey(password, next.id);
            keyRef.current = { ...revealed, name: next.label };
          }
        );
      } catch {
        // Cancelled. Nothing was revealed.
        return;
      }
      setTarget(next);
    },
    [reauth, release]
  );

  const close = useCallback(() => {
    release();
    setTarget(null);
    setLockedAttempt(false);
  }, [release]);

  const getPayload = useCallback(() => keyRef.current, []);

  return {
    target,
    start,
    close,
    release,
    getPayload,
    lockedMidBackup: target !== null && lockedAttempt,
  };
}

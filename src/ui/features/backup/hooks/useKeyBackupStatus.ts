import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyBackupStatus, KeyBackupStatusRow } from "@/domain/backup/status";
import {
  listBackupStatuses,
  subscribeKeyBackupChanged,
} from "@/infrastructure/messaging/client";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";

export interface KeyBackupStatuses {
  /**
   * `pending` for a key made here with no verified backup, `verified` once one
   * is, and `unknown` for a key with no record: one that predates tracking, or
   * an import. `unknown` deliberately shows no banner and no marker.
   */
  statusOf: (keyId: string | undefined) => KeyBackupStatus;
  /** Re-reads after a write made from this surface; other surfaces broadcast. */
  refresh: () => void;
}

/**
 * The backup status of the vault's keys, read from the background.
 *
 * Re-read when the vault unlocks, when the set of keys changes (a new key
 * arrives `pending`), and when another page verifies a backup. Until the first
 * read lands, and whenever a read fails, every key is `unknown`: the failure
 * mode is silence, never a banner about a backup that may well exist.
 */
export function useKeyBackupStatuses(): KeyBackupStatuses {
  const { isLocked, keys } = useKeyManager();
  const keySignature = keys.map((key) => key.id).join("\u0000");
  const [rows, setRows] = useState<KeyBackupStatusRow[]>([]);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => subscribeKeyBackupChanged(refresh), [refresh]);

  useEffect(() => {
    // Lock-gated in the background; a locked surface has nothing to show.
    if (isLocked) return;
    let cancelled = false;
    listBackupStatuses()
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch(() => {
        // Keep what was last read. A failed read must not invent a status.
      });
    return () => {
      cancelled = true;
    };
  }, [isLocked, keySignature, version]);

  const byKey = useMemo(
    () => new Map(rows.map((row) => [row.keyId, row.state])),
    [rows]
  );
  const statusOf = useCallback(
    (keyId: string | undefined): KeyBackupStatus =>
      (keyId && byKey.get(keyId)) || "unknown",
    [byKey]
  );

  return useMemo(() => ({ statusOf, refresh }), [statusOf, refresh]);
}

/** The status of one key. For a screen that cares about a single key. */
export function useKeyBackupStatus(keyId: string | undefined): KeyBackupStatus {
  return useKeyBackupStatuses().statusOf(keyId);
}

/**
 * Whether the user holds a backup of a key.
 *
 * Deliberately three-valued at the point of use. A key with no record is
 * `unknown`, not `pending`: every key that existed before backup status was
 * tracked has none, and most of them were backed up in onboarding. Calling
 * them pending would nag users about backups they already made.
 */
export type KeyBackupState = "pending" | "verified";

export type KeyBackupStatus = "pending" | "verified" | "unknown";

export interface KeyBackupEntry {
  state: KeyBackupState;
  /** Epoch ms when the key entered this state. */
  at: number;
}

/** One key's status as it crosses the RPC boundary. */
export interface KeyBackupStatusRow extends KeyBackupEntry {
  keyId: string;
}

/**
 * The stored record. Non-secret and held outside the vault envelope: it says
 * which keys were backed up, never anything about the keys themselves.
 */
export interface KeyBackupRecordV1 {
  __version: "keyBackup.v1";
  keys: Record<string, KeyBackupEntry>;
}

export const KEY_BACKUP_RECORD_VERSION = "keyBackup.v1" as const;

const KEY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isKeyBackupState(value: unknown): value is KeyBackupState {
  return value === "pending" || value === "verified";
}

function isEntry(value: unknown): value is KeyBackupEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as { state?: unknown; at?: unknown };
  return (
    isKeyBackupState(entry.state) &&
    typeof entry.at === "number" &&
    Number.isFinite(entry.at)
  );
}

/**
 * Reads whatever storage returned as a set of entries.
 *
 * Storage is not trusted: a malformed record, or a malformed entry inside a
 * good one, is dropped rather than thrown on. The cost of a dropped entry is a
 * key shown as `unknown`, which is the safe direction - no banner, and the
 * Back up action stays available. Entry keys must look like key ids, which
 * keeps an odd key such as `__proto__` out of the result.
 */
export function parseKeyBackupRecord(raw: unknown): Map<string, KeyBackupEntry> {
  const entries = new Map<string, KeyBackupEntry>();
  if (typeof raw !== "object" || raw === null) return entries;
  const record = raw as { __version?: unknown; keys?: unknown };
  if (record.__version !== KEY_BACKUP_RECORD_VERSION) return entries;
  if (typeof record.keys !== "object" || record.keys === null) return entries;
  for (const [keyId, value] of Object.entries(record.keys)) {
    if (KEY_ID_PATTERN.test(keyId) && isEntry(value)) {
      entries.set(keyId, { state: value.state, at: value.at });
    }
  }
  return entries;
}

export function serializeKeyBackupRecord(
  entries: ReadonlyMap<string, KeyBackupEntry>
): KeyBackupRecordV1 {
  return {
    __version: KEY_BACKUP_RECORD_VERSION,
    keys: Object.fromEntries(entries),
  };
}

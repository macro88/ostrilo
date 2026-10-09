import type { StoragePort } from "@/application/ports/storage";
import {
  parseKeyBackupRecord,
  serializeKeyBackupRecord,
  type KeyBackupEntry,
  type KeyBackupStatusRow,
} from "@/domain/backup/status";
import { BROADCAST_EVENTS } from "@/infrastructure/messaging/events";
import { SerialLock } from "@/domain/utils/serial-lock";

export const KEY_BACKUP_STORAGE = "keyBackupStatus";

/**
 * Owns the per-key backup status record.
 *
 * It lives in its own `storage.local` item rather than in the vault envelope or
 * the key records: it is not secret, it changes without the vault password, and
 * it must be writable while the key records are not being rewritten. The vault
 * calls `markPending` when it generates a key and `remove` when it deletes one;
 * the UI can only ever record `verified`, through `backup.markVerified`.
 *
 * Imports get no record. The user already holds the secret, so there is nothing
 * to nag about, and a key with no record is reported as unknown.
 */
export class KeyBackupStatusService {
  /** Read-modify-write of one item: serialised so two writes cannot lose one. */
  private lock = new SerialLock();

  constructor(
    private storage: StoragePort,
    private now: () => number = () => Date.now()
  ) {}

  private async read(): Promise<Map<string, KeyBackupEntry>> {
    return parseKeyBackupRecord(
      await this.storage.get<unknown>(KEY_BACKUP_STORAGE)
    );
  }

  private async write(entries: Map<string, KeyBackupEntry>): Promise<void> {
    await this.storage.set(KEY_BACKUP_STORAGE, serializeKeyBackupRecord(entries));
  }

  /** Every key that has a record. A key absent from the result is unknown. */
  async list(): Promise<KeyBackupStatusRow[]> {
    const entries = await this.read();
    return [...entries].map(([keyId, entry]) => ({ keyId, ...entry }));
  }

  /** The key was generated here and no backup has been verified yet. */
  async markPending(keyId: string): Promise<void> {
    await this.set(keyId, "pending");
  }

  /** A backup of this key was made and checked. Also covers keys with no record. */
  async markVerified(keyId: string): Promise<void> {
    await this.set(keyId, "verified");
    await this.broadcastChanged();
  }

  /** The key is gone; so is what was known about its backup. */
  async remove(keyId: string): Promise<void> {
    await this.lock.run(async () => {
      const entries = await this.read();
      if (entries.delete(keyId)) await this.write(entries);
    });
  }

  private async set(keyId: string, state: KeyBackupEntry["state"]): Promise<void> {
    await this.lock.run(async () => {
      const entries = await this.read();
      entries.set(keyId, { state, at: this.now() });
      await this.write(entries);
    });
  }

  /**
   * Tells every open surface to read the statuses again, so a Home banner
   * clears when a backup is verified on another page.
   */
  private async broadcastChanged(): Promise<void> {
    try {
      const { browser } = await import("wxt/browser");
      browser.runtime.sendMessage({
        __event: BROADCAST_EVENTS.KEY_BACKUP_CHANGED,
      });
    } catch {
      // No listener is the normal case; the write already happened.
    }
  }
}

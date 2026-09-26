import type { StorageSuite } from "@/application/ports/storage";

/**
 * The storage key of the settings item. Named here and nowhere else in `src/`:
 * `tests/security/settings-locality.test.ts` fails on a second owner.
 */
export const SETTINGS_STORAGE_KEY = "appSettings";

/**
 * The only owner of the `appSettings` item, and the only place its storage
 * area is decided: extension local storage.
 *
 * It used to live in `storage.sync`, which the browser copies to every
 * profile signed into the same account. Trust levels, per-kind rules,
 * disclosure consent and the security timeouts are all granted on this device
 * by entering this vault's password - and then took effect on every other
 * synced browser without it, including one holding a different vault. Relays,
 * the upload endpoint and activity retention travelled the same way, so a
 * remote value could redirect this device's traffic or trim its history.
 *
 * Synced storage is touched only to migrate out of it: `read()` copies a
 * pre-upgrade item into local when local has none, and `migrate()` removes
 * the synced copy once the local one reads back.
 */
export class SettingsStore {
  constructor(private storage: StorageSuite) {}

  /**
   * The stored settings, or undefined on a fresh install.
   *
   * Never deletes anything: this is on every settings consumer's path, and a
   * synced-storage failure here must not stop settings from loading. Two
   * concurrent first reads both copy the same value, so the copy is
   * idempotent.
   */
  async read<T = unknown>(): Promise<T | undefined> {
    const local = await this.storage.local.get<T>(SETTINGS_STORAGE_KEY);
    if (local !== undefined) return local;

    const synced = await this.storage.sync.get<T>(SETTINGS_STORAGE_KEY);
    if (synced === undefined) return undefined;
    await this.storage.local.set<T>(SETTINGS_STORAGE_KEY, synced);
    return synced;
  }

  async write<T>(next: T): Promise<void> {
    await this.storage.local.set<T>(SETTINGS_STORAGE_KEY, next);
  }

  /**
   * Completes the move off synced storage: copies if needed, then removes the
   * synced item - but only once the local copy has been read back, so a
   * failed copy can never be followed by a delete.
   *
   * Also sweeps a copy that an older version on another device wrote after
   * this one migrated. Run by the background at every worker start, so a
   * removal that failed is retried.
   */
  async migrate(): Promise<void> {
    await this.read();
    const local = await this.storage.local.get(SETTINGS_STORAGE_KEY);
    if (local === undefined) return;
    const synced = await this.storage.sync.get(SETTINGS_STORAGE_KEY);
    if (synced === undefined) return;
    await this.storage.sync.remove(SETTINGS_STORAGE_KEY);
  }
}

/** The shape of a `storage.onChanged` event's `changes` argument. */
type StorageChanges = Record<string, { newValue?: unknown } | undefined>;

/**
 * The new settings value when this storage event changed the settings item in
 * LOCAL storage, otherwise undefined.
 *
 * The area filter is load-bearing. An older version on another device can
 * still write the settings item into synced storage, and that write fires
 * `onChanged` here too; acting on it would rebuild the relay manager from a
 * relay list this device never chose.
 */
export function localSettingsChange(
  changes: StorageChanges,
  areaName: string
): unknown {
  if (areaName !== "local") return undefined;
  return changes[SETTINGS_STORAGE_KEY]?.newValue;
}

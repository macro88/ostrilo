import type { KeyBackupStatus } from "@/domain/backup/status";
import { createStorageSuite } from "@/infrastructure/storage/adapters";

/**
 * The banner asks about a key whose backup is `pending` and nothing else: a
 * `verified` key has one, and an `unknown` key (an import, or one that predates
 * tracking) is not nagged, because the user may well hold the secret already.
 * Dismissing hides it for this browser session only.
 */
export function isBackupBannerVisible(
  status: KeyBackupStatus,
  dismissed: boolean
): boolean {
  return status === "pending" && !dismissed;
}

/**
 * One item per key, so dismissing one key's banner cannot hide another's, and
 * two surfaces dismissing at once cannot overwrite each other's write.
 *
 * `storage.session` is cleared when the browser closes, which is exactly the
 * lifetime the owner asked for, and is readable only by extension pages.
 */
const dismissedKey = (keyId: string) => `backupBannerDismissed:${keyId}`;

export async function readBackupBannerDismissed(
  keyId: string
): Promise<boolean> {
  try {
    return (await createStorageSuite().session.get<boolean>(dismissedKey(keyId))) === true;
  } catch {
    // Unreadable means not dismissed: the reminder errs towards showing.
    return false;
  }
}

export async function dismissBackupBanner(keyId: string): Promise<void> {
  try {
    await createStorageSuite().session.set(dismissedKey(keyId), true);
  } catch {
    // The banner is already hidden in this view; it returns next time.
  }
}

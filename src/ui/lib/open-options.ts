import { browser } from "wxt/browser";

export type OptionsTab =
  | "general"
  | "keys"
  | "security"
  | "permissions"
  | "activity"
  | "relays"
  | "advanced";

export interface OptionsTabTarget {
  /** Keys & Identities only: start this key's backup as the page opens. */
  backupKeyId?: string;
}

/** The hash parameter that carries a key to back up. Read by `OptionsApp`. */
export const BACKUP_HASH_PARAM = "backup";

/**
 * Opens the full settings page in a tab of its own, on the given tab.
 *
 * `runtime.openOptionsPage()` cannot carry a hash, and `OptionsApp` reads its
 * tab from `location.hash`, so a deep link has to go through `tabs.create`.
 * Without a tab it opens on General, which is what `openOptionsPage()` did.
 *
 * A key id is an identifier, not a secret; the password-gated reveal still
 * runs before anything is backed up.
 */
export function openOptionsTab(
  tab?: OptionsTab,
  target: OptionsTabTarget = {}
): void {
  const params =
    tab && target.backupKeyId
      ? `?${new URLSearchParams({ [BACKUP_HASH_PARAM]: target.backupKeyId })}`
      : "";
  const hash = tab ? `#${tab}${params}` : "";
  void browser.tabs.create({
    url: browser.runtime.getURL(`/options.html${hash}`),
  });
}

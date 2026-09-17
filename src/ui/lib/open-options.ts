import { browser } from "wxt/browser";

export type OptionsTab =
  | "general"
  | "keys"
  | "security"
  | "permissions"
  | "activity"
  | "relays"
  | "advanced";

/**
 * Opens the full settings page in a tab of its own, on the given tab.
 *
 * `runtime.openOptionsPage()` cannot carry a hash, and `OptionsApp` reads its
 * tab from `location.hash`, so a deep link has to go through `tabs.create`.
 * Without a tab it opens on General, which is what `openOptionsPage()` did.
 */
export function openOptionsTab(tab?: OptionsTab): void {
  const hash = tab ? `#${tab}` : "";
  void browser.tabs.create({
    url: browser.runtime.getURL(`/options.html${hash}`),
  });
}

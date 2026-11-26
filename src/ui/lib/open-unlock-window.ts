import { browser } from "wxt/browser";

/**
 * Opens the window a biometric unlock runs in.
 *
 * A window of its own because the toolbar popup closes when it loses focus,
 * and on some platforms the authenticator's prompt takes it. The window holds
 * no key; it closes itself when the vault opens.
 */
export function openUnlockWindow(): void {
  void browser.windows.create({
    url: browser.runtime.getURL("/unlock.html"),
    type: "popup",
    width: 400,
    height: 560,
    focused: true,
  });
}

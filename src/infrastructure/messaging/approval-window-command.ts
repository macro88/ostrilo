import { browser } from "wxt/browser";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "./error-codes";
import { OPEN_APPROVAL_WINDOW_COMMAND } from "./events";
import { isTrustedExtensionSender } from "./sender-trust";

/**
 * The background's listener for the one extension command that lives outside
 * the RPC router: open, or focus, the approval window.
 *
 * It used to answer any runtime message, so a content script - and anything
 * running in its process - could raise a focused OS window on demand. Its only
 * caller is the Activity page, an extension page, so it now takes the same
 * sender check as the UI-only RPC namespaces. Anything else is ignored: no
 * window, and no result.
 */
export function createApprovalWindowCommandListener(
  openWindow: () => Promise<number | undefined>
) {
  const runtimeId = browser.runtime.id;
  const extensionOrigin = browser.runtime.getURL("/");

  return (message: unknown, sender: unknown) => {
    if (
      (message as { __command?: unknown } | null)?.__command !==
      OPEN_APPROVAL_WINDOW_COMMAND
    ) {
      return undefined;
    }
    if (!isTrustedExtensionSender(sender, runtimeId, extensionOrigin)) {
      return undefined;
    }
    return openWindow()
      .then((windowId) => ({ ok: true, windowId }))
      .catch((err: unknown) =>
        createRpcErrorResponse(RPC_ERROR_CODES.APPROVAL_FAILED, {
          details:
            err instanceof Error ? err.message : "Failed to open approval window",
          method: OPEN_APPROVAL_WINDOW_COMMAND,
        })
      );
  };
}

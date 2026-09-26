export const BROADCAST_EVENTS = {
  SWITCH_TO_ACTIVITY: "ostrilo.switchToActivity",
  QUEUE_UPDATED: "ostrilo.queue.updated",
  SETTINGS_CHANGED: "ostrilo.settings.changed",
  /**
   * The vault locked. Broadcast on every lock - manual, alarm, or the
   * deadline check - so an open surface swaps to the lock screen instead of
   * sitting there showing key labels and policy until someone reloads it.
   */
  VAULT_LOCKED: "ostrilo.vault.locked",
} as const;

/**
 * The `storage.sync` key holding whether the extension opens in the side panel.
 * The options page writes it and the background reapplies it on every service
 * worker start, so both must read this one constant.
 */
export const DOCKED_STORAGE_KEY = "isDocked";

/**
 * The extension-page command that opens or focuses the approval window. It is
 * handled outside the RPC router, and only for a verified extension-page
 * sender; see `approval-window-command.ts`.
 */
export const OPEN_APPROVAL_WINDOW_COMMAND = "ostrilo.openApprovalWindow";

export type BroadcastEventName =
  (typeof BROADCAST_EVENTS)[keyof typeof BROADCAST_EVENTS];

export type BroadcastEvent = {
  __event: BroadcastEventName;
};

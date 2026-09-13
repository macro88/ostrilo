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

export type BroadcastEventName =
  (typeof BROADCAST_EVENTS)[keyof typeof BROADCAST_EVENTS];

export type BroadcastEvent = {
  __event: BroadcastEventName;
};

export const BROADCAST_EVENTS = {
  SWITCH_TO_ACTIVITY: "ostrilo.switchToActivity",
  QUEUE_UPDATED: "ostrilo.queue.updated",
  SETTINGS_CHANGED: "ostrilo.settings.changed",
} as const;

export type BroadcastEventName =
  (typeof BROADCAST_EVENTS)[keyof typeof BROADCAST_EVENTS];

export type BroadcastEvent = {
  __event: BroadcastEventName;
};

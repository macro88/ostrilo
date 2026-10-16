import type { LockReason } from "@/domain/types";

/**
 * What the lock screen says about why the vault is locked.
 *
 * Chosen here, not taken from the background, so the background can never put
 * its own text on this screen. Each line states what happened and stops: the
 * password field is already the next step. `background_restarted` is the
 * honest account of a browser ending Ostrilo's background; it is also what
 * Firefox's event-page unload looks like from here.
 */
export function describeLockReason(
  reason: LockReason,
  inactivityMinutes?: number
): string {
  switch (reason) {
    case "manual":
      return "You locked Ostrilo.";
    case "inactivity":
      return typeof inactivityMinutes === "number" && inactivityMinutes > 0
        ? `Locked after ${inactivityMinutes} ${
            inactivityMinutes === 1 ? "minute" : "minutes"
          } without activity.`
        : "Locked after a period without activity.";
    case "background_restarted":
      return "Locked because the browser restarted Ostrilo's background.";
    case "state_unreadable":
      return "Locked because Ostrilo could not read its session state.";
    case "clock_rollback":
      return "Locked because the system clock moved backwards.";
    case "browser_restarted":
      return "Locked because the browser restarted.";
    case "extension_updated":
      return "Locked because Ostrilo was updated or reloaded.";
  }
}

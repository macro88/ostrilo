import { useCallback, useState } from "react";
import {
  getOwnAvatar,
  removeOwnAvatar,
  saveOwnAvatar,
} from "@/infrastructure/messaging/client";
import {
  AvatarCaptureError,
  avatarCaptureNote,
  captureAvatar,
} from "@/ui/lib/avatar-capture";

export type ProfilePictureStatus =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "saved" }
  | { kind: "failed"; note: string };

interface Tracked {
  pubkey: string;
  status: ProfilePictureStatus;
}

const SAVE_FAILED_NOTE = "Ostrilo couldn't save the copy. Try again.";

/**
 * Makes, replaces and removes the local copy of the user's own picture.
 *
 * `cache` is the only thing that loads a remote image anywhere in the
 * extension, and it runs only when the Profile page calls it: after a profile
 * save that has a picture, and from the Refresh picture control. It is never
 * called from an effect, a timer or a broadcast, so it cannot become a
 * background request.
 *
 * The result is tied to the key it was started for, not to whichever key is
 * selected when the image arrives, so switching identities mid-load cannot file
 * one identity's picture under another. The status follows the same rule: a
 * note about one key is not shown on another.
 */
export function useProfilePicture(pubkey: string | null) {
  const [tracked, setTracked] = useState<Tracked | null>(null);

  const cache = useCallback(
    async (sourceUrl: string) => {
      if (!pubkey) return;
      const set = (status: ProfilePictureStatus) => setTracked({ pubkey, status });
      set({ kind: "working" });

      try {
        const dataUrl = await captureAvatar(sourceUrl);
        await saveOwnAvatar({ pubkey, sourceUrl, dataUrl });
        set({ kind: "saved" });
      } catch (error) {
        set({
          kind: "failed",
          note:
            error instanceof AvatarCaptureError
              ? avatarCaptureNote(error.reason)
              : SAVE_FAILED_NOTE,
        });
        // A copy made from a picture the user has since replaced would keep
        // showing the old one. A copy of this same URL is kept: a failed
        // refresh is not evidence the earlier copy is wrong.
        await dropStaleCopy(pubkey, sourceUrl);
      }
    },
    [pubkey]
  );

  /** The profile no longer has a picture, so neither does the header. */
  const clear = useCallback(async () => {
    if (!pubkey) return;
    setTracked(null);
    try {
      await removeOwnAvatar(pubkey);
    } catch (error) {
      console.warn("Could not remove the local picture copy:", error);
    }
  }, [pubkey]);

  const status: ProfilePictureStatus =
    tracked && tracked.pubkey === pubkey ? tracked.status : { kind: "idle" };
  return { status, cache, clear };
}

async function dropStaleCopy(pubkey: string, sourceUrl: string): Promise<void> {
  try {
    const existing = await getOwnAvatar(pubkey);
    if (existing && existing.sourceUrl !== sourceUrl) {
      await removeOwnAvatar(pubkey);
    }
  } catch (error) {
    console.warn("Could not check the local picture copy:", error);
  }
}

import { useCallback, useRef, useState } from "react";
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
 *
 * Each `cache` or `clear` for a key supersedes the ones before it. A superseded
 * capture stops at its next step: it saves nothing, removes nothing and reports
 * nothing, so a slow earlier picture cannot overwrite a later one, and a
 * removed picture is not brought back by a capture that was already running.
 */
export function useProfilePicture(pubkey: string | null) {
  const [tracked, setTracked] = useState<Tracked | null>(null);
  const attempts = useRef(new Map<string, number>());
  const supersede = useCallback((key: string) => {
    const attempt = (attempts.current.get(key) ?? 0) + 1;
    attempts.current.set(key, attempt);
    return attempt;
  }, []);

  const cache = useCallback(
    async (sourceUrl: string) => {
      if (!pubkey) return;
      const attempt = supersede(pubkey);
      const isLatest = () => attempts.current.get(pubkey) === attempt;
      const set = (status: ProfilePictureStatus) => setTracked({ pubkey, status });
      set({ kind: "working" });

      try {
        const dataUrl = await captureAvatar(sourceUrl);
        if (!isLatest()) return;
        await saveOwnAvatar({ pubkey, sourceUrl, dataUrl });
        if (!isLatest()) return;
        set({ kind: "saved" });
      } catch (error) {
        if (!isLatest()) return;
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
        await dropStaleCopy(pubkey, sourceUrl, isLatest);
      }
    },
    [pubkey, supersede]
  );

  /** The profile no longer has a picture, so neither does the header. */
  const clear = useCallback(async () => {
    if (!pubkey) return;
    supersede(pubkey);
    setTracked(null);
    try {
      await removeOwnAvatar(pubkey);
    } catch (error) {
      console.warn("Could not remove the local picture copy:", error);
    }
  }, [pubkey, supersede]);

  const status: ProfilePictureStatus =
    tracked && tracked.pubkey === pubkey ? tracked.status : { kind: "idle" };
  return { status, cache, clear };
}

async function dropStaleCopy(
  pubkey: string,
  sourceUrl: string,
  isLatest: () => boolean
): Promise<void> {
  try {
    const existing = await getOwnAvatar(pubkey);
    if (isLatest() && existing && existing.sourceUrl !== sourceUrl) {
      await removeOwnAvatar(pubkey);
    }
  } catch (error) {
    console.warn("Could not check the local picture copy:", error);
  }
}

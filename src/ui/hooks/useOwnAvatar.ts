import { useCallback, useEffect, useState } from "react";
import { isAvatarDataUrl, type AvatarRow } from "@/domain/profile/avatar";
import { getOwnAvatar, subscribeAvatarChanged } from "@/infrastructure/messaging/client";

interface Read {
  pubkey: string;
  row: AvatarRow | null;
}

/**
 * The local copy of one public key's profile picture, read from the background.
 *
 * Only a copy that belongs to the key asked about is ever returned. The read
 * state remembers which key it was for, so when the selected key changes the
 * previous key's picture is not returned for the one frame before the new read
 * lands: the answer is the seal until the new key's own copy arrives.
 *
 * Re-read when another surface saves or removes a copy, so saving on the
 * Profile page changes the header without a reload. There is no network request
 * here; the copy is a stored `data:` URL.
 */
export function useOwnAvatar(pubkey: string | null): AvatarRow | null {
  const [read, setRead] = useState<Read | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => subscribeAvatarChanged(refresh), [refresh]);

  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;
    getOwnAvatar(pubkey)
      .then((row) => {
        if (!cancelled) setRead({ pubkey, row });
      })
      .catch(() => {
        // Locked, or unreadable storage: no copy, so the seal.
        if (!cancelled) setRead({ pubkey, row: null });
      });
    return () => {
      cancelled = true;
    };
  }, [pubkey, version]);

  const row = read?.pubkey === pubkey ? read.row : null;
  return row && row.pubkey === pubkey && isAvatarDataUrl(row.dataUrl) ? row : null;
}

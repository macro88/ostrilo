import type { StoragePort } from "@/application/ports/storage";
import {
  parseAvatarRecord,
  serializeAvatarRecord,
  type AvatarEntry,
  type AvatarRow,
} from "@/domain/profile/avatar";
import { BROADCAST_EVENTS } from "@/infrastructure/messaging/events";
import { SerialLock } from "@/domain/utils/serial-lock";

export const PROFILE_AVATAR_STORAGE = "profileAvatar";

/**
 * Owns the local copy of each key's profile picture.
 *
 * It lives in its own `storage.local` item: it is not secret, it is rewritten
 * without the vault password, and it must not share a write path with the key
 * records. The background never fetches the picture. The Profile page loads
 * the image once, shrinks it, and hands the encoded result here through a
 * validated UI-only RPC; this service only keeps what it is given.
 *
 * Keyed by public key, one entry per key. `save` is given the public keys the
 * vault holds and drops every entry for another key, so the record cannot grow
 * past the vault and a key deleted while storage was failing leaves nothing
 * behind for the next write to find.
 */
export class ProfileAvatarService {
  /** Read-modify-write of one item: serialised so two writes cannot lose one. */
  private lock = new SerialLock();

  constructor(
    private storage: StoragePort,
    private now: () => number = () => Date.now()
  ) {}

  private async read(): Promise<Map<string, AvatarEntry>> {
    return parseAvatarRecord(await this.storage.get<unknown>(PROFILE_AVATAR_STORAGE));
  }

  private async write(entries: Map<string, AvatarEntry>): Promise<void> {
    if (entries.size === 0) {
      await this.storage.remove(PROFILE_AVATAR_STORAGE);
      return;
    }
    await this.storage.set(PROFILE_AVATAR_STORAGE, serializeAvatarRecord(entries));
  }

  /** The copy for one public key, or null. */
  async get(pubkey: string): Promise<AvatarRow | null> {
    const entry = (await this.read()).get(pubkey);
    return entry ? { pubkey, ...entry } : null;
  }

  /**
   * Stores the copy for `pubkey`, replacing any earlier one, and drops entries
   * for public keys not in `vaultPubkeys`.
   */
  async save(
    pubkey: string,
    copy: { dataUrl: string; sourceUrl: string },
    vaultPubkeys: readonly string[]
  ): Promise<void> {
    await this.lock.run(async () => {
      const entries = await this.read();
      const allowed = new Set(vaultPubkeys);
      for (const key of entries.keys()) {
        if (!allowed.has(key)) entries.delete(key);
      }
      entries.set(pubkey, { ...copy, at: this.now() });
      await this.write(entries);
    });
    await this.broadcastChanged();
  }

  /** The copy for this public key is gone: cleared, or its key was deleted. */
  async remove(pubkey: string): Promise<void> {
    const removed = await this.lock.run(async () => {
      const entries = await this.read();
      if (!entries.delete(pubkey)) return false;
      await this.write(entries);
      return true;
    });
    if (removed) await this.broadcastChanged();
  }

  /**
   * Tells every open surface to read the copy again, so the header changes
   * when the Profile page saves one without either page holding the other's
   * state.
   */
  private async broadcastChanged(): Promise<void> {
    try {
      const { browser } = await import("wxt/browser");
      await browser.runtime
        .sendMessage({ __event: BROADCAST_EVENTS.PROFILE_AVATAR_CHANGED })
        .catch(() => undefined);
    } catch {
      // No listener is the normal case; the write already happened.
    }
  }
}

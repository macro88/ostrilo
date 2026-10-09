import { getLockState, listKeys } from "@/infrastructure/messaging/client";
import type { KeyListEntry } from "@/infrastructure/messaging/handlers/vault-rpc";
import type { LockStatePayload } from "@/infrastructure/messaging/rpc";

// Secure UI-only types - no plaintext private keys
export interface UIKeyInfo {
  id: string;
  label: string;
  publicKeyHex: string;
  publicKeyBech32: string;
  /**
   * The record could not be read: its public key is malformed, or the last
   * unlock could not open it. Surfaces have to render this as an error: the
   * previous code called a hex decoder that substituted zero bytes for
   * unparseable characters, so a corrupt record displayed a real, well-formed
   * npub for a key nobody holds, and the user had no way to tell it from their
   * own identity.
   */
  isUnreadable: boolean;
  createdAt: number;
  lastUsedAt: number;
  isSelected: boolean;
}

/** What one read of the vault established. */
export interface VaultSnapshot {
  lock: LockStatePayload;
  keys: UIKeyInfo[];
}

/**
 * Projects one stored record into the view model.
 *
 * The npub arrives already encoded from the background, so no bech32 code
 * runs in a React render: on a malformed record it would throw, and a context
 * provider has nowhere to put an exception.
 */
function toUIKeyInfo(key: KeyListEntry): UIKeyInfo {
  return {
    id: key.id,
    label: key.label || "Unnamed",
    publicKeyHex: key.pubkey,
    publicKeyBech32: key.npub ?? "",
    isUnreadable: key.npub === undefined || key.unreadable === true,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt || key.createdAt, // Use createdAt as fallback
    isSelected: key.isSelected || false,
  };
}

/**
 * A key as a locked vault describes it: the identifier and nothing else.
 *
 * Not "unreadable". A locked list is redacted on purpose by the router, and a
 * surface that rendered it as a damaged record would call a healthy vault
 * "Unnamed" with a public-key error.
 */
function toRedactedKeyInfo(id: string): UIKeyInfo {
  return {
    id,
    label: "",
    publicKeyHex: "",
    publicKeyBech32: "",
    isUnreadable: false,
    createdAt: 0,
    lastUsedAt: 0,
    isSelected: false,
  };
}

/** Drops every field of a held list that a locked vault would not disclose. */
export function redactKeys(keys: UIKeyInfo[]): UIKeyInfo[] {
  return keys.map((key) => toRedactedKeyInfo(key.id));
}

/**
 * A listing that arrived while locked has no field but `id`. A real stored
 * record always has more, even a damaged one.
 */
function isRedactedEntry(entry: KeyListEntry): boolean {
  return Object.keys(entry).every((field) => field === "id");
}

/** Reads of the pair that may straddle a lock, before the answer is called unstable. */
const MAX_SNAPSHOT_ATTEMPTS = 3;

/**
 * Reads the lock state and the key list together and returns them only if
 * they agree.
 *
 * The two are separate requests, so a lock or an unlock can fall between
 * them. A list read just before an unlock is redacted; paired with a lock
 * state read just after it, the UI would hold an unlocked session over
 * identifiers with no public keys. That pairing is detected and read again.
 * The opposite pairing - an unlocked list with a locked state - is redacted
 * here, because a locked UI holds no more than a locked list would give it.
 */
export async function readVaultSnapshot(): Promise<VaultSnapshot> {
  for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const [lock, entries] = await Promise.all([getLockState(), listKeys()]);
    if (lock.isLocked) {
      return { lock, keys: entries.map((entry) => toRedactedKeyInfo(entry.id)) };
    }
    if (!entries.some(isRedactedEntry)) {
      return { lock, keys: entries.map(toUIKeyInfo) };
    }
  }
  throw new Error("vault_snapshot_unstable");
}

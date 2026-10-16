import { isAllowedRemoteUrl } from "./types";

/**
 * The local copy of the user's own profile picture.
 *
 * Extension pages never load a relay-chosen image, so the header cannot show
 * the `picture` URL a profile publishes. What it shows instead is a small copy
 * the Profile page makes once, when the user saves the profile or presses
 * Refresh picture, and the background stores. Everything here is the policy
 * both sides apply to that copy: what the image is, how big it may be, and what
 * a stored record has to look like before it is trusted.
 */

/** Edge of the stored square, in pixels. Big enough for a 28px header slot at 3x. */
export const AVATAR_SIZE_PX = 96;

/** Largest source image accepted, per edge, as decoded by the browser. */
export const AVATAR_MAX_SOURCE_EDGE_PX = 4096;

/** How long the Profile page waits for the one image request. */
export const AVATAR_LOAD_TIMEOUT_MS = 10_000;

/** Ceiling on the stored `data:` URL, in characters (64 KiB). */
export const AVATAR_MAX_DATA_URL_CHARS = 64 * 1024;

const AVATAR_DATA_URL_PATTERN =
  /^data:image\/(webp|png);base64,[A-Za-z0-9+/]+={0,2}$/;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function decodePrefix(base64: string, bytes: number): number[] | null {
  // 4 base64 characters carry 3 bytes; take whole groups only.
  const chars = Math.ceil(bytes / 3) * 4;
  if (base64.length < chars) return null;
  try {
    const raw = atob(base64.slice(0, chars));
    return Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * True for an encoded avatar the extension will store and render.
 *
 * The declared type is checked against the bytes: a `data:image/png` URL whose
 * payload is not a PNG header, or a webp one that is not a RIFF/WEBP container,
 * is refused. Only these two raster types are accepted, so no SVG (script and
 * external references) and no other format ever reaches an `<img>` here.
 */
export function isAvatarDataUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > AVATAR_MAX_DATA_URL_CHARS) {
    return false;
  }
  const match = AVATAR_DATA_URL_PATTERN.exec(value);
  if (!match) return false;

  const base64 = value.slice(value.indexOf(",") + 1);
  const head = decodePrefix(base64, 12);
  if (!head) return false;

  if (match[1] === "png") {
    return PNG_SIGNATURE.every((byte, i) => head[i] === byte);
  }
  const text = String.fromCharCode(...head);
  return text.startsWith("RIFF") && text.slice(8, 12) === "WEBP";
}

/** The stored copy of one public key's picture. */
export interface AvatarEntry {
  /** `data:image/(webp|png);base64,...`, at most 64 KiB. */
  dataUrl: string;
  /** The `https:` picture URL this copy was made from. */
  sourceUrl: string;
  /** Epoch ms when the copy was made. */
  at: number;
}

/** The record's wire shape: one entry for a public key, or none. */
export interface AvatarRow extends AvatarEntry {
  pubkey: string;
}

export const AVATAR_RECORD_VERSION = "profileAvatar.v1" as const;

export interface AvatarRecordV1 {
  __version: typeof AVATAR_RECORD_VERSION;
  avatars: Record<string, AvatarEntry>;
}

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;

export function isPubkeyHex(value: unknown): value is string {
  return typeof value === "string" && PUBKEY_PATTERN.test(value);
}

function isEntry(value: unknown): value is AvatarEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<AvatarEntry>;
  return (
    isAvatarDataUrl(entry.dataUrl) &&
    isAllowedRemoteUrl(entry.sourceUrl) &&
    typeof entry.at === "number" &&
    Number.isFinite(entry.at)
  );
}

/**
 * Reads whatever storage returned as a set of entries.
 *
 * Storage is not trusted: a malformed record, or a malformed entry inside a
 * good one, is dropped. The cost of a dropped entry is the seal in the header,
 * which is the safe direction. Entry keys must be public-key hex, which keeps
 * an odd key such as `__proto__` out of the result.
 */
export function parseAvatarRecord(raw: unknown): Map<string, AvatarEntry> {
  const entries = new Map<string, AvatarEntry>();
  if (typeof raw !== "object" || raw === null) return entries;
  const record = raw as { __version?: unknown; avatars?: unknown };
  if (record.__version !== AVATAR_RECORD_VERSION) return entries;
  if (typeof record.avatars !== "object" || record.avatars === null) return entries;
  for (const [pubkey, value] of Object.entries(record.avatars)) {
    if (isPubkeyHex(pubkey) && isEntry(value)) {
      entries.set(pubkey, {
        dataUrl: value.dataUrl,
        sourceUrl: value.sourceUrl,
        at: value.at,
      });
    }
  }
  return entries;
}

export function serializeAvatarRecord(
  entries: ReadonlyMap<string, AvatarEntry>
): AvatarRecordV1 {
  return {
    __version: AVATAR_RECORD_VERSION,
    avatars: Object.fromEntries(entries),
  };
}

import {
  BLOSSOM_MAX_IMAGE_BYTES,
  PNG_CHUNK_WALK_MAX,
} from "./constants";

/**
 * Judges a file by its bytes, never by the label the browser gave it.
 *
 * This is the header inspection that runs before the consent dialog. It reads
 * a bounded few kilobytes through a slice reader, decodes nothing and hashes
 * nothing, and answers three questions: is it one of the four accepted types,
 * is it within the size limit, and could re-encoding it flatten an animation.
 * SVG is not accepted: it is a document that can carry script.
 */

export type ImageKind = "jpeg" | "png" | "gif" | "webp";

export type HeaderInspection =
  | { ok: true; kind: ImageKind; mime: string; animated: boolean }
  | {
      ok: false;
      reason: "empty" | "too-large" | "unsupported" | "uninspectable";
    };

export interface HeaderReader {
  readonly size: number;
  /** Bytes in `[start, end)`, shorter than asked at the end of the file. */
  read(start: number, end: number): Promise<Uint8Array>;
}

export function bufferHeaderReader(bytes: Uint8Array): HeaderReader {
  return {
    size: bytes.length,
    async read(start, end) {
      return bytes.slice(start, end);
    },
  };
}

const MIME: Record<ImageKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, expected: readonly number[], at = 0): boolean {
  return (
    bytes.length >= at + expected.length &&
    expected.every((value, index) => bytes[at + index] === value)
  );
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

function sniffKind(head: Uint8Array): ImageKind | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(head, PNG_SIGNATURE)) return "png";
  if (startsWith(head, ascii("GIF87a")) || startsWith(head, ascii("GIF89a"))) {
    return "gif";
  }
  if (startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8)) {
    return "webp";
  }
  return null;
}

function readU32be(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>>
    0
  );
}

/** The VP8X animation flag, or null when the header cannot be read. */
async function webpAnimated(reader: HeaderReader): Promise<boolean | null> {
  const bytes = await reader.read(12, 21);
  if (bytes.length < 4) return null;
  if (!startsWith(bytes, ascii("VP8X"))) return false;
  if (bytes.length < 9) return null;
  return (bytes[8] & 0x02) !== 0;
}

/**
 * Walks chunk headers, 8 bytes at a time, to the first image-data chunk.
 * `acTL` before it means animated. Reaching neither within the bound, or the
 * end of the file, is refused: "unchanged" would keep the file's metadata and
 * "re-encoded" might flatten an animation.
 */
async function pngAnimated(reader: HeaderReader): Promise<boolean | null> {
  let offset = PNG_SIGNATURE.length;

  for (let walked = 0; walked < PNG_CHUNK_WALK_MAX; walked += 1) {
    const header = await reader.read(offset, offset + 8);
    if (header.length < 8) return null;

    const type = String.fromCharCode(header[4], header[5], header[6], header[7]);
    if (type === "acTL") return true;
    if (type === "IDAT") return false;
    if (type === "IEND") return null;

    offset += 8 + readU32be(header, 0) + 4;
    if (offset >= reader.size) return null;
  }

  return null;
}

export async function inspectImageHeader(
  reader: HeaderReader
): Promise<HeaderInspection> {
  if (reader.size === 0) return { ok: false, reason: "empty" };
  if (reader.size > BLOSSOM_MAX_IMAGE_BYTES) {
    return { ok: false, reason: "too-large" };
  }

  const kind = sniffKind(await reader.read(0, 12));
  if (kind === null) return { ok: false, reason: "unsupported" };

  let animated: boolean | null;
  switch (kind) {
    case "gif":
      animated = true;
      break;
    case "webp":
      animated = await webpAnimated(reader);
      break;
    case "png":
      animated = await pngAnimated(reader);
      break;
    default:
      animated = false;
  }

  if (animated === null) return { ok: false, reason: "uninspectable" };
  return { ok: true, kind, mime: MIME[kind], animated };
}

/**
 * Makes a release archive byte-reproducible: every entry gets one fixed
 * timestamp, and entries are stored in name order.
 *
 * `wxt zip` writes archives with JSZip, which stamps each entry with the time
 * it is added and orders entries by a filesystem walk. Two builds of the same
 * commit unpacked to identical files, but the archives themselves differed, so
 * a rebuild could not be checked against a published archive by its digest.
 * The walk order can also differ between filesystems, which would defeat a
 * timestamp fix alone across machines.
 *
 * Runs from the `zip:*:done` hooks in wxt.config.ts. Only the zip container is
 * rewritten: each entry's compressed bytes, CRC and sizes are copied unchanged,
 * so what an archive unpacks to does not change.
 *
 * It handles the archives JSZip writes - no data descriptors, no ZIP64, no
 * archive comment, entries packed back to back - and throws on anything else
 * rather than guess at a layout it was not written for.
 */
import { readFile, writeFile } from "node:fs/promises";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const LOCAL_SIZE = 30;
const CENTRAL_SIZE = 46;
const END_SIZE = 22;
/** General-purpose flag bit 3: sizes follow the data instead of the header. */
const DATA_DESCRIPTOR_FLAG = 0x0008;

/**
 * 1980-02-01 00:00:00 as MS-DOS date and time fields. Not the zip epoch
 * itself: 1980-01-01 read as local time west of Greenwich converts to a 1979
 * UTC instant, which some tools reject.
 */
export const FIXED_DOS_DATE = (0 << 9) | (2 << 5) | 1;
export const FIXED_DOS_TIME = 0;

interface Entry {
  name: Buffer;
  local: Buffer;
  central: Buffer;
}

function fail(reason: string): never {
  throw new Error(`reproducible-zip: ${reason}`);
}

function readEntries(zip: Buffer): { entries: Entry[]; end: Buffer } {
  const endAt = zip.length - END_SIZE;
  if (endAt < 0 || zip.readUInt32LE(endAt) !== END_SIG) {
    fail("no end-of-central-directory record at the end (archive comment or not a zip)");
  }
  const count = zip.readUInt16LE(endAt + 10);
  const centralSize = zip.readUInt32LE(endAt + 12);
  const centralAt = zip.readUInt32LE(endAt + 16);
  if (count === 0xffff || centralAt === 0xffffffff) fail("ZIP64 archives are not supported");
  if (zip.readUInt16LE(endAt + 4) !== 0 || zip.readUInt16LE(endAt + 8) !== count) {
    fail("multi-disk archives are not supported");
  }

  const entries: Entry[] = [];
  let at = centralAt;
  let localBytes = 0;
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== CENTRAL_SIG) fail(`bad central directory entry ${i}`);
    if (zip.readUInt16LE(at + 8) & DATA_DESCRIPTOR_FLAG) fail("data descriptors are not supported");
    const nameLength = zip.readUInt16LE(at + 28);
    const centralLength =
      CENTRAL_SIZE + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const localAt = zip.readUInt32LE(at + 42);
    if (zip.readUInt32LE(localAt) !== LOCAL_SIG) fail(`bad local header for entry ${i}`);
    const localLength =
      LOCAL_SIZE +
      zip.readUInt16LE(localAt + 26) +
      zip.readUInt16LE(localAt + 28) +
      zip.readUInt32LE(at + 20);

    entries.push({
      name: Buffer.from(zip.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength)),
      local: Buffer.from(zip.subarray(localAt, localAt + localLength)),
      central: Buffer.from(zip.subarray(at, at + centralLength)),
    });
    at += centralLength;
    localBytes += localLength;
  }
  // Every byte before the central directory must belong to an entry, or this
  // rewrite would drop something it did not understand.
  if (at !== centralAt + centralSize || localBytes !== centralAt) {
    fail("entries are not packed back to back before the central directory");
  }
  return { entries, end: Buffer.from(zip.subarray(endAt)) };
}

/** Returns the archive with fixed timestamps and entries in name order. */
export function normalizeZip(zip: Buffer): Buffer {
  const { entries, end } = readEntries(zip);
  entries.sort((a, b) => Buffer.compare(a.name, b.name));

  const parts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    entry.local.writeUInt16LE(FIXED_DOS_TIME, 10);
    entry.local.writeUInt16LE(FIXED_DOS_DATE, 12);
    entry.central.writeUInt16LE(FIXED_DOS_TIME, 12);
    entry.central.writeUInt16LE(FIXED_DOS_DATE, 14);
    entry.central.writeUInt32LE(offset, 42);
    parts.push(entry.local);
    offset += entry.local.length;
  }
  parts.push(...entries.map((entry) => entry.central));
  // Only the central directory's position moves; its size and count do not.
  end.writeUInt32LE(offset, 16);
  parts.push(end);
  return Buffer.concat(parts);
}

export async function normalizeZipFile(path: string): Promise<void> {
  await writeFile(path, normalizeZip(await readFile(path)));
}

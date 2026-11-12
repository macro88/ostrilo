import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  FIXED_DOS_DATE,
  FIXED_DOS_TIME,
  normalizeZip,
} from "../../../scripts/reproducible-zip";

interface FixtureEntry {
  name: string;
  data: string;
  time: number;
  date: number;
}

/** Writes a stored (uncompressed) zip the way JSZip lays one out. */
function buildZip(entries: FixtureEntry[], options: { flags?: number; comment?: string } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(options.flags ?? 0, 6);
    local.writeUInt16LE(entry.time, 10);
    local.writeUInt16LE(entry.date, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(options.flags ?? 0, 8);
    central.writeUInt16LE(entry.time, 12);
    central.writeUInt16LE(entry.date, 14);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const comment = Buffer.from(options.comment ?? "");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, centralDirectory, end, comment]);
}

interface ReadEntry {
  name: string;
  data: string;
  crc: number;
  localTime: number;
  localDate: number;
  localOffset: number;
}

/**
 * Walks local headers front to back, then checks every central directory
 * record against them. This is a different path from the one
 * `normalizeZip` takes, which navigates only by the central directory.
 */
function readZip(zip: Buffer) {
  const entries: ReadEntry[] = [];
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const nameLength = zip.readUInt16LE(at + 26);
    const size = zip.readUInt32LE(at + 18);
    const dataAt = at + 30 + nameLength + zip.readUInt16LE(at + 28);
    entries.push({
      name: zip.toString("utf8", at + 30, at + 30 + nameLength),
      data: zip.toString("utf8", dataAt, dataAt + size),
      crc: zip.readUInt32LE(at + 14),
      localTime: zip.readUInt16LE(at + 10),
      localDate: zip.readUInt16LE(at + 12),
      localOffset: at,
    });
    at = dataAt + size;
  }
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  expect(zip.readUInt32LE(end + 16)).toBe(at);
  const central = entries.map((_, i) => {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const nameLength = zip.readUInt16LE(at + 28);
    const record = {
      name: zip.toString("utf8", at + 46, at + 46 + nameLength),
      time: zip.readUInt16LE(at + 12),
      date: zip.readUInt16LE(at + 14),
      crc: zip.readUInt32LE(at + 16),
      localOffset: zip.readUInt32LE(at + 42),
    };
    expect(record.name, `central record ${i}`).toBe(entries[i].name);
    at += 46 + nameLength;
    return record;
  });
  expect(at).toBe(end);
  return { entries, central };
}

const MAY_2026 = { time: (14 << 11) | (7 << 5) | 21, date: (46 << 9) | (5 << 5) | 3 };
const NOV_2026 = { time: (9 << 11) | (39 << 5) | 2, date: (46 << 9) | (11 << 5) | 12 };

const FILES: FixtureEntry[] = [
  { name: "manifest.json", data: '{"manifest_version":3}', ...MAY_2026 },
  { name: "chunks/", data: "", ...MAY_2026 },
  { name: "chunks/popup.js", data: "console.log(1)", ...NOV_2026 },
  { name: "background.js", data: "self.x = 1;", ...NOV_2026 },
];

describe("normalizeZip", () => {
  it("gives every entry one fixed timestamp in both headers", () => {
    const { entries, central } = readZip(normalizeZip(buildZip(FILES)));

    for (const entry of entries) {
      expect([entry.localTime, entry.localDate]).toEqual([FIXED_DOS_TIME, FIXED_DOS_DATE]);
    }
    for (const record of central) {
      expect([record.time, record.date]).toEqual([FIXED_DOS_TIME, FIXED_DOS_DATE]);
    }
  });

  it("orders entries by name and leaves each entry's contents and CRC alone", () => {
    const { entries, central } = readZip(normalizeZip(buildZip(FILES)));

    expect(entries.map((e) => e.name)).toEqual([
      "background.js",
      "chunks/",
      "chunks/popup.js",
      "manifest.json",
    ]);
    for (const entry of entries) {
      const original = FILES.find((f) => f.name === entry.name)!;
      expect(entry.data).toBe(original.data);
      expect(entry.crc).toBe(crc32(Buffer.from(original.data)));
    }
    expect(central.map((r) => r.localOffset)).toEqual(entries.map((e) => e.localOffset));
  });

  it("produces identical bytes from the same files written in another order at another time", () => {
    const first = buildZip(FILES);
    const second = buildZip(
      [...FILES].reverse().map((entry) => ({ ...entry, ...NOV_2026 }))
    );
    expect(first.equals(second)).toBe(false);

    expect(normalizeZip(first).equals(normalizeZip(second))).toBe(true);
  });

  it("is idempotent", () => {
    const once = normalizeZip(buildZip(FILES));

    expect(normalizeZip(once).equals(once)).toBe(true);
  });

  it("refuses an archive whose entries use data descriptors", () => {
    expect(() => normalizeZip(buildZip(FILES, { flags: 0x0008 }))).toThrow(
      /data descriptors/
    );
  });

  it("refuses an archive with a comment", () => {
    expect(() => normalizeZip(buildZip(FILES, { comment: "built by hand" }))).toThrow(
      /end-of-central-directory/
    );
  });

  it("refuses an archive with bytes it cannot account for", () => {
    const zip = buildZip(FILES);
    const padded = Buffer.concat([Buffer.alloc(4), zip]);
    // Shift every recorded offset past the padding so the archive is still
    // navigable, leaving four bytes before the first entry that belong to none.
    const end = padded.length - 22;
    padded.writeUInt32LE(padded.readUInt32LE(end + 16) + 4, end + 16);
    let at = padded.readUInt32LE(end + 16);
    for (let i = 0; i < FILES.length; i++) {
      padded.writeUInt32LE(padded.readUInt32LE(at + 42) + 4, at + 42);
      at += 46 + padded.readUInt16LE(at + 28);
    }

    expect(() => normalizeZip(padded)).toThrow(/packed back to back/);
  });
});

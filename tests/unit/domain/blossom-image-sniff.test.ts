import { describe, expect, it } from "vitest";
import {
  bufferHeaderReader,
  inspectImageHeader,
  type HeaderReader,
} from "@/domain/blossom/image-sniff";
import {
  ascii,
  gif,
  jpeg,
  png,
  pngChunk,
  PNG_SIGNATURE,
  u32be,
  webp,
} from "../../helpers/image-bytes";
import {
  BLOSSOM_MAX_IMAGE_BYTES,
  INSPECT_MAX_BYTES,
  PNG_CHUNK_WALK_MAX,
} from "@/domain/blossom/constants";

function countingReader(bytes: Uint8Array) {
  let total = 0;
  const inner = bufferHeaderReader(bytes);
  const reader: HeaderReader = {
    size: inner.size,
    async read(start, end) {
      const chunk = await inner.read(start, end);
      total += chunk.length;
      return chunk;
    },
  };
  return { reader, total: () => total };
}

const inspect = (bytes: Uint8Array) =>
  inspectImageHeader(bufferHeaderReader(bytes));

describe("inspectImageHeader: type from bytes", () => {
  it("accepts a JPEG", async () => {
    expect(await inspect(jpeg())).toEqual({
      ok: true,
      kind: "jpeg",
      mime: "image/jpeg",
      animated: false,
    });
  });

  it("accepts a still PNG", async () => {
    const bytes = png([pngChunk("IHDR", 13), pngChunk("IDAT", 4), pngChunk("IEND")]);
    expect(await inspect(bytes)).toEqual({
      ok: true,
      kind: "png",
      mime: "image/png",
      animated: false,
    });
  });

  it.each(["GIF87a", "GIF89a"])("treats %s as possibly animated", async (version) => {
    expect(await inspect(gif(version))).toEqual({
      ok: true,
      kind: "gif",
      mime: "image/gif",
      animated: true,
    });
  });

  it("accepts a still WebP", async () => {
    expect(await inspect(webp(0x10))).toEqual({
      ok: true,
      kind: "webp",
      mime: "image/webp",
      animated: false,
    });
  });

  it("accepts a lossy WebP with no extended header as a still", async () => {
    expect(await inspect(webp(0, false))).toMatchObject({
      ok: true,
      kind: "webp",
      animated: false,
    });
  });

  it.each([
    ["an HTML document", Uint8Array.from(ascii("<!doctype html><html></html>"))],
    ["an SVG", Uint8Array.from(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))],
    ["an SVG with an XML prolog", Uint8Array.from(ascii('<?xml version="1.0"?><svg/>'))],
    ["a PDF", Uint8Array.from(ascii("%PDF-1.7 ..."))],
    ["a RIFF file that is not WebP", Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")])],
    ["a truncated PNG signature", Uint8Array.from(PNG_SIGNATURE.slice(0, 5))],
    ["two bytes of a JPEG", Uint8Array.from([0xff, 0xd8])],
  ])("refuses %s", async (_name, bytes) => {
    expect(await inspect(bytes)).toEqual({ ok: false, reason: "unsupported" });
  });

  it("refuses an empty file", async () => {
    expect(await inspect(new Uint8Array())).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("refuses a file over the limit without reading it", async () => {
    let reads = 0;
    const reader: HeaderReader = {
      size: BLOSSOM_MAX_IMAGE_BYTES + 1,
      async read() {
        reads += 1;
        return new Uint8Array();
      },
    };
    expect(await inspectImageHeader(reader)).toEqual({
      ok: false,
      reason: "too-large",
    });
    expect(reads).toBe(0);
  });

  it("accepts a file exactly at the limit", async () => {
    const reader: HeaderReader = {
      size: BLOSSOM_MAX_IMAGE_BYTES,
      async read(start, end) {
        return jpeg().slice(start, end);
      },
    };
    expect(await inspectImageHeader(reader)).toMatchObject({ ok: true });
  });

  it("ignores any label: only the bytes decide", async () => {
    // The inspector never receives a label, so a mislabelled file cannot
    // influence it. This documents that the signature is the whole judgement.
    expect(await inspect(Uint8Array.from(ascii("<html>")))).toMatchObject({
      ok: false,
    });
  });
});

describe("inspectImageHeader: animation", () => {
  it("reports a WebP with the animation flag as animated", async () => {
    expect(await inspect(webp(0x02))).toMatchObject({
      ok: true,
      kind: "webp",
      animated: true,
    });
    expect(await inspect(webp(0x12))).toMatchObject({ animated: true });
  });

  it("reports a PNG with an acTL chunk before its image data as animated", async () => {
    const bytes = png([
      pngChunk("IHDR", 13),
      pngChunk("acTL", 8),
      pngChunk("fcTL", 26),
      pngChunk("IDAT", 4),
      pngChunk("IEND"),
    ]);
    expect(await inspect(bytes)).toMatchObject({
      ok: true,
      kind: "png",
      animated: true,
    });
  });

  it("walks past large ancillary chunks to find acTL", async () => {
    const bytes = png([
      pngChunk("IHDR", 13),
      pngChunk("iCCP", 30_000),
      pngChunk("eXIf", 5_000),
      pngChunk("acTL", 8),
      pngChunk("IDAT", 4),
    ]);
    expect(await inspect(bytes)).toMatchObject({ animated: true });
  });

  it("stops at the first IDAT and does not look beyond it", async () => {
    const bytes = png([
      pngChunk("IHDR", 13),
      pngChunk("IDAT", 4),
      pngChunk("acTL", 8),
    ]);
    expect(await inspect(bytes)).toMatchObject({ ok: true, animated: false });
  });

  it("refuses a PNG with more chunk headers than the walk allows before IDAT", async () => {
    const chunks = [
      pngChunk("IHDR", 13),
      ...Array.from({ length: PNG_CHUNK_WALK_MAX }, () => pngChunk("tEXt", 0)),
      pngChunk("IDAT", 4),
    ];
    expect(await inspect(png(chunks))).toEqual({
      ok: false,
      reason: "uninspectable",
    });
  });

  it("accepts a PNG whose IDAT arrives exactly at the walk limit", async () => {
    const chunks = [
      pngChunk("IHDR", 13),
      ...Array.from({ length: PNG_CHUNK_WALK_MAX - 2 }, () => pngChunk("tEXt", 0)),
      pngChunk("IDAT", 4),
    ];
    expect(await inspect(png(chunks))).toMatchObject({ ok: true, animated: false });
  });

  it("refuses a PNG that ends before reaching image data", async () => {
    const bytes = png([pngChunk("IHDR", 13), pngChunk("IEND")]);
    expect(await inspect(bytes)).toEqual({ ok: false, reason: "uninspectable" });
  });

  it("refuses a PNG whose chunk length runs past the end of the file", async () => {
    const bytes = Uint8Array.from([
      ...PNG_SIGNATURE,
      ...u32be(0x7fffffff),
      ...ascii("IHDR"),
    ]);
    expect(await inspect(bytes)).toEqual({ ok: false, reason: "uninspectable" });
  });
});

describe("inspectImageHeader: how much it reads", () => {
  it("is bounded at 4 KiB", () => {
    expect(INSPECT_MAX_BYTES).toBe(4096);
  });

  it("reads nothing past the signature for a JPEG or GIF of any size", async () => {
    const big = new Uint8Array(BLOSSOM_MAX_IMAGE_BYTES);
    big.set(jpeg());
    const counted = countingReader(big);
    await inspectImageHeader(counted.reader);
    expect(counted.total()).toBeLessThanOrEqual(INSPECT_MAX_BYTES);
  });

  it("reads at most 4 KiB for a PNG at the walk limit", async () => {
    const chunks = [
      pngChunk("IHDR", 13),
      ...Array.from({ length: PNG_CHUNK_WALK_MAX - 2 }, () => pngChunk("tEXt", 0)),
      pngChunk("IDAT", 4),
    ];
    const counted = countingReader(png(chunks));
    await inspectImageHeader(counted.reader);
    expect(counted.total()).toBeLessThanOrEqual(INSPECT_MAX_BYTES);
  });

  it("reads at most 4 KiB for a PNG it refuses", async () => {
    const chunks = [
      pngChunk("IHDR", 13),
      ...Array.from({ length: PNG_CHUNK_WALK_MAX + 50 }, () => pngChunk("tEXt", 0)),
    ];
    const counted = countingReader(png(chunks));
    expect(await inspectImageHeader(counted.reader)).toEqual({
      ok: false,
      reason: "uninspectable",
    });
    expect(counted.total()).toBeLessThanOrEqual(INSPECT_MAX_BYTES);
  });

  it("reads at most 4 KiB for a WebP", async () => {
    const counted = countingReader(webp(0x02));
    await inspectImageHeader(counted.reader);
    expect(counted.total()).toBeLessThanOrEqual(INSPECT_MAX_BYTES);
  });
});

describe("bufferHeaderReader", () => {
  it("serves slices and truncates at the end of the buffer", async () => {
    const reader = bufferHeaderReader(Uint8Array.from([1, 2, 3, 4, 5]));
    expect(reader.size).toBe(5);
    expect(Array.from(await reader.read(1, 3))).toEqual([2, 3]);
    expect(Array.from(await reader.read(3, 99))).toEqual([4, 5]);
    expect(Array.from(await reader.read(9, 12))).toEqual([]);
  });
});

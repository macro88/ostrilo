/** Minimal byte-accurate image headers for tests. None of them decodes. */

export const ascii = (text: string): number[] =>
  Array.from(text, (c) => c.charCodeAt(0));

export const u32be = (n: number): number[] => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];

export const u32le = (n: number): number[] => [
  n & 0xff,
  (n >>> 8) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 24) & 0xff,
];

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const pngChunk = (type: string, dataLength = 0): number[] => [
  ...u32be(dataLength),
  ...ascii(type),
  ...new Array(dataLength).fill(0),
  0,
  0,
  0,
  0,
];

export function png(chunks: number[][]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([...PNG_SIGNATURE, ...chunks.flat()]);
}

/** A PNG with the chunks a still image has, in the order a decoder expects. */
export const stillPng = (): Uint8Array<ArrayBuffer> =>
  png([pngChunk("IHDR", 13), pngChunk("IDAT", 4), pngChunk("IEND")]);

export const animatedPng = (): Uint8Array<ArrayBuffer> =>
  png([
    pngChunk("IHDR", 13),
    pngChunk("acTL", 8),
    pngChunk("fcTL", 26),
    pngChunk("IDAT", 4),
    pngChunk("IEND"),
  ]);

export function webp(flags: number, extended = true): Uint8Array<ArrayBuffer> {
  const body = extended
    ? [...ascii("VP8X"), ...u32le(10), flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    : [...ascii("VP8 "), ...u32le(10), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return Uint8Array.from([
    ...ascii("RIFF"),
    ...u32le(body.length + 4),
    ...ascii("WEBP"),
    ...body,
  ]);
}

export const jpeg = (): Uint8Array<ArrayBuffer> =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii("JFIF"), 0, 1, 1]);

/** A JPEG that carries an EXIF segment, marked by the ASCII text "Exif". */
export const jpegWithExif = (): Uint8Array<ArrayBuffer> =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    0,
    24,
    ...ascii("Exif"),
    0,
    0,
    ...ascii("GPS:51.5,-0.12"),
    0xff,
    0xd9,
  ]);

export const gif = (version = "GIF89a"): Uint8Array<ArrayBuffer> =>
  Uint8Array.from([...ascii(version), 1, 0, 1, 0, 0, 0, 0]);

export function containsAscii(bytes: Uint8Array, text: string): boolean {
  const needle = ascii(text);
  for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    if (needle.every((value, offset) => bytes[i + offset] === value)) return true;
  }
  return false;
}

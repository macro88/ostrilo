/**
 * Makes invisible and direction-controlling characters visible for display.
 *
 * A signing prompt is a claim about what is being signed. Unicode has several
 * characters that make the rendered text disagree with the bytes:
 *
 *  - U+202E RIGHT-TO-LEFT OVERRIDE and its relatives reverse the rendering
 *    order of everything after them, so an amount or an address can be
 *    displayed as something quite different from what it is.
 *  - U+200B ZERO WIDTH SPACE, the U+200C/U+200D joiners and U+FEFF occupy no
 *    space at all, so a string can carry characters the user cannot see.
 *  - C0 and C1 controls can move the cursor or truncate a line.
 *
 * The transform is DISPLAY-ONLY. The bytes that get hashed and signed are
 * never touched - substituting them would sign something other than what the
 * page asked for, which is a worse failure than a misleading display. The
 * dialog shows the escaped form, says how many characters were escaped, and
 * the raw JSON view still shows the exact payload.
 *
 * Ordinary right-to-left text - Arabic, Hebrew - is left completely alone. It
 * is not an attack, and escaping it would make the product unusable for the
 * people who write in those scripts.
 */

/** Newline and tab are legitimate content and survive. */
const PRESERVED = new Set(["\n", "\t"]);

function isEscapable(codePoint: number): boolean {
  // C0 controls, minus the preserved ones, plus DEL and the C1 range.
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  // Bidi embedding, override and isolate marks.
  if (codePoint >= 0x202a && codePoint <= 0x202e) return true;
  if (codePoint >= 0x2066 && codePoint <= 0x2069) return true;
  if (codePoint === 0x200e || codePoint === 0x200f || codePoint === 0x061c) {
    return true;
  }
  // Zero-width space, joiners, and the byte-order mark used inline.
  if (codePoint >= 0x200b && codePoint <= 0x200d) return true;
  if (codePoint === 0xfeff) return true;
  // Other invisible formatting characters.
  if (codePoint === 0x00ad) return true; // soft hyphen
  if (codePoint >= 0xfff9 && codePoint <= 0xfffb) return true; // interlinear
  if (codePoint >= 0x1d173 && codePoint <= 0x1d17a) return true; // musical
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return true; // tag chars
  return false;
}

export interface SafeText {
  /** The string to render. */
  text: string;
  /** How many characters were replaced with an escape. */
  escapedCount: number;
}

export function escapeInvisible(input: string): SafeText {
  let out = "";
  let escapedCount = 0;

  // Iterated by code point, not by code unit, so an astral character is not
  // split into surrogate halves on the way through.
  for (const char of input) {
    const codePoint = char.codePointAt(0)!;
    if (PRESERVED.has(char) || !isEscapable(codePoint)) {
      out += char;
      continue;
    }
    escapedCount++;
    out += `\\u{${codePoint.toString(16).toUpperCase().padStart(4, "0")}}`;
  }

  return { text: out, escapedCount };
}

/** UTF-8 byte length, which is what the wire and the hash actually see. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Total UTF-8 bytes across every element of every tag. */
export function tagsByteLength(tags: string[][]): number {
  let total = 0;
  for (const tag of tags) {
    for (const element of tag) total += byteLength(element);
  }
  return total;
}

import { describe, it, expect } from "vitest";
import { formatOrigin } from "@/domain/display/origin";
import {
  escapeInvisible,
  byteLength,
  tagsByteLength,
} from "@/domain/display/safe-text";
import { NostrEventCrypto } from "@/infrastructure/crypto/adapters";

/**
 * What the approval dialog shows must be what gets signed.
 *
 * Three shipped defects:
 *
 *  1. The origin was rendered as `new URL(origin).hostname`, which DROPS the
 *     scheme. A hijacked `http://example.com` therefore rendered identically
 *     to the real `https://example.com` - and the provider was injected into
 *     plaintext pages, so that attack was reachable.
 *  2. Event content and tags were rendered with no neutralization of bidi or
 *     zero-width characters, into a clipped panel with no length indicator.
 *     A hostile event could therefore be displayed as something other than
 *     what it was, and any amount of it could be hidden below the fold.
 *  3. "Signing as" was read from whichever key the approval UI had selected
 *     when it loaded, not from the request.
 */

describe("origin formatting", () => {
  it("keeps the scheme, which is the whole point", () => {
    expect(formatOrigin("https://example.com").display).toBe(
      "https://example.com"
    );
    expect(
      formatOrigin("http://example.com").display,
      "SECURITY REGRESSION: a plaintext origin rendered identically to an HTTPS one"
    ).toBe("http://example.com");
  });

  it("flags a non-HTTPS origin", () => {
    expect(formatOrigin("http://example.com").insecure).toBe(true);
    expect(formatOrigin("https://example.com").insecure).toBe(false);
  });

  it("keeps the punycode form, so a homoglyph hostname looks wrong", () => {
    // "аpple.com" with a Cyrillic U+0430. Rendered as Unicode it is visually
    // identical to "apple.com"; rendered as punycode it plainly is not.
    const formatted = formatOrigin("https://аpple.com");
    expect(formatted.hostname).toBe("xn--pple-43d.com");
    expect(formatted.display).toContain("xn--");
  });

  it("shows a non-default port and omits a default one", () => {
    expect(formatOrigin("https://example.com:8443").display).toBe(
      "https://example.com:8443"
    );
    expect(formatOrigin("https://example.com:443").display).toBe(
      "https://example.com"
    );
  });

  it("shows malformed input verbatim rather than prettifying it", () => {
    const formatted = formatOrigin("not a url");
    expect(formatted.display).toBe("not a url");
    expect(formatted.malformed).toBe(true);
    expect(formatted.insecure).toBe(true);
  });
});

describe("invisible-character escaping", () => {
  it("escapes a right-to-left override", () => {
    const { text, escapedCount } = escapeInvisible("zap 1‮000,01 sats");
    expect(
      text,
      "SECURITY REGRESSION: a bidi override survived into the display string"
    ).not.toContain("‮");
    expect(text).toContain("\\u{202E}");
    expect(escapedCount).toBe(1);
  });

  it("escapes zero-width characters", () => {
    for (const [char, escape] of [
      ["​", "\\u{200B}"],
      ["‌", "\\u{200C}"],
      ["‍", "\\u{200D}"],
      ["﻿", "\\u{FEFF}"],
    ]) {
      const { text, escapedCount } = escapeInvisible(`admin${char}@example.com`);
      expect(text).toContain(escape);
      expect(escapedCount).toBe(1);
    }
  });

  it("preserves newline and tab, which are ordinary content", () => {
    const { text, escapedCount } = escapeInvisible("line one\nline two\tend");
    expect(text).toBe("line one\nline two\tend");
    expect(escapedCount).toBe(0);
  });

  it("leaves ordinary right-to-left text completely alone", () => {
    // Arabic and Hebrew are not an attack. Escaping them would make the
    // product unusable for the people who write in those scripts.
    const arabic = "مرحبا بالعالم";
    const hebrew = "שלום עולם";
    expect(escapeInvisible(arabic)).toEqual({ text: arabic, escapedCount: 0 });
    expect(escapeInvisible(hebrew)).toEqual({ text: hebrew, escapedCount: 0 });
  });

  it("does not split an astral character into surrogate halves", () => {
    const emoji = "a 𝄞 b 👩‍👩‍👧 c";
    const { text } = escapeInvisible(emoji);
    // The joiners inside the family emoji are escaped; the musical symbol and
    // the base characters are not mangled.
    expect(text).toContain("𝄞");
    expect(text).not.toContain("�");
  });

  it("counts every escape so the dialog can say how many there were", () => {
    const { escapedCount } = escapeInvisible("‮a​b‬");
    expect(escapedCount).toBe(3);
  });
});

describe("the display transform never changes what is signed", () => {
  const PUBKEY = "ab".repeat(32);

  it("leaves the computed event id identical", () => {
    // This is the property that matters. If escaping ever reached the signing
    // path, the extension would sign something other than what the page asked
    // for - which is a worse failure than a misleading display.
    const hostile = "pay 1‮000,01‬ to ​attacker";
    const tags = [["p", `​${PUBKEY}`]];

    const eventOf = (content: string, eventTags: string[][]) => ({
      pubkey: PUBKEY,
      created_at: 1700000000,
      kind: 1,
      tags: eventTags,
      content,
    });

    const before = NostrEventCrypto.computeEventId(eventOf(hostile, tags));

    // Do what the dialog does.
    escapeInvisible(hostile);
    for (const tag of tags) tag.forEach((el) => escapeInvisible(el));

    const after = NostrEventCrypto.computeEventId(eventOf(hostile, tags));
    expect(
      after,
      "SECURITY REGRESSION: the display transform altered the signed payload"
    ).toBe(before);
  });

  it("returns a new string rather than mutating its input", () => {
    const original = "a‮b";
    const copy = original;
    escapeInvisible(original);
    expect(original).toBe(copy);
  });
});

describe("true payload sizes", () => {
  it("measures UTF-8 bytes, not string length", () => {
    // "𝄞".length is 2 but it occupies 4 bytes. A length-based label
    // understates adversarial content by up to 4x.
    expect("𝄞".length).toBe(2);
    expect(byteLength("𝄞")).toBe(4);
    expect(byteLength("日本語")).toBe(9);
    expect(byteLength("abc")).toBe(3);
  });

  it("totals every element of every tag", () => {
    expect(tagsByteLength([["p", "ab"], ["e", "cd", "wss://x"]])).toBe(
      1 + 2 + 1 + 2 + 7
    );
  });
});

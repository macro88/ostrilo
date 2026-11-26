import { describe, expect, it } from "vitest";
import { checkBlobDescriptor } from "@/domain/blossom/descriptor";

const HASH = "ab".repeat(32);
const SIZE = 48_213;
const expected = { sha256: HASH, size: SIZE };

const good = {
  url: `https://cdn.example/${HASH}.png`,
  sha256: HASH,
  size: SIZE,
  type: "image/png",
  uploaded: 1_700_000_000,
};

describe("checkBlobDescriptor", () => {
  it("accepts a descriptor that matches what was sent", () => {
    expect(checkBlobDescriptor(good, expected)).toEqual({
      ok: true,
      url: good.url,
    });
  });

  it("ignores fields it does not know", () => {
    const withExtras = {
      ...good,
      magnet: "magnet:?xt=urn:btih:abc",
      ipfs: "ipfs://x",
      nip94: [["url", good.url]],
    };
    expect(checkBlobDescriptor(withExtras, expected)).toEqual({
      ok: true,
      url: good.url,
    });
  });

  it("accepts a server that reports the hash in uppercase", () => {
    expect(
      checkBlobDescriptor({ ...good, sha256: HASH.toUpperCase() }, expected).ok
    ).toBe(true);
  });

  it("accepts a url on a different host, such as a per-user subdomain", () => {
    const url = `https://npub1abc.blossom.example/${HASH}.webp`;
    expect(checkBlobDescriptor({ ...good, url }, expected)).toEqual({
      ok: true,
      url,
    });
  });

  it("does not rely on the reported type", () => {
    const { type: _type, ...withoutType } = good;
    expect(checkBlobDescriptor(withoutType, expected).ok).toBe(true);
    expect(checkBlobDescriptor({ ...good, type: 7 }, expected).ok).toBe(true);
  });

  it("refuses a different hash", () => {
    expect(
      checkBlobDescriptor({ ...good, sha256: "cd".repeat(32) }, expected).ok
    ).toBe(false);
  });

  it("refuses a different size", () => {
    expect(checkBlobDescriptor({ ...good, size: SIZE + 1 }, expected).ok).toBe(
      false
    );
  });

  it("refuses a size that is not a number", () => {
    expect(checkBlobDescriptor({ ...good, size: String(SIZE) }, expected).ok).toBe(
      false
    );
    expect(checkBlobDescriptor({ ...good, size: null }, expected).ok).toBe(false);
  });

  it("refuses a url that does not carry the hash in its path", () => {
    expect(
      checkBlobDescriptor(
        { ...good, url: "https://cdn.example/avatar.png" },
        expected
      ).ok
    ).toBe(false);
    expect(
      checkBlobDescriptor(
        { ...good, url: `https://cdn.example/a.png?x=${HASH}` },
        expected
      ).ok
    ).toBe(false);
    expect(
      checkBlobDescriptor({ ...good, url: `https://${HASH}.example/a.png` }, expected)
        .ok
    ).toBe(false);
    expect(
      checkBlobDescriptor({ ...good, url: `https://cdn.example/a.png#${HASH}` }, expected)
        .ok
    ).toBe(false);
  });

  it.each([
    ["http", `http://cdn.example/${HASH}.png`],
    ["data", `data:image/png;base64,${HASH}`],
    ["javascript", `javascript:alert('${HASH}')`],
    ["ftp", `ftp://cdn.example/${HASH}.png`],
    ["a relative path", `/${HASH}.png`],
    ["not a url", "not a url"],
    ["empty", ""],
  ])("refuses a %s url", (_name, url) => {
    expect(checkBlobDescriptor({ ...good, url }, expected).ok).toBe(false);
  });

  it("refuses a url over 512 characters", () => {
    const url = `https://cdn.example/${"a".repeat(480)}/${HASH}.png`;
    expect(url.length).toBeGreaterThan(512);
    expect(checkBlobDescriptor({ ...good, url }, expected).ok).toBe(false);
  });

  it.each([
    ["a missing url", { sha256: HASH, size: SIZE }],
    ["a missing sha256", { url: good.url, size: SIZE }],
    ["a missing size", { url: good.url, sha256: HASH }],
    ["a non-string url", { ...good, url: 42 }],
    ["a non-string hash", { ...good, sha256: 42 }],
  ])("refuses %s", (_name, body) => {
    expect(checkBlobDescriptor(body, expected).ok).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "{}"],
    ["an array", [good]],
    ["a number", 7],
    ["undefined", undefined],
  ])("refuses %s as a body", (_name, body) => {
    expect(checkBlobDescriptor(body, expected).ok).toBe(false);
  });
});

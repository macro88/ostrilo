import { describe, expect, it } from "vitest";
import {
  AVATAR_MAX_DATA_URL_CHARS,
  isAvatarDataUrl,
  parseAvatarRecord,
  serializeAvatarRecord,
} from "@/domain/profile/avatar";
import { PNG_DATA_URL, SOURCE_URL, WEBP_DATA_URL } from "../../helpers/avatar-fixtures";

const PUBKEY = "a".repeat(64);

describe("isAvatarDataUrl", () => {
  it("accepts a png and a webp data URL", () => {
    expect(isAvatarDataUrl(PNG_DATA_URL)).toBe(true);
    expect(isAvatarDataUrl(WEBP_DATA_URL)).toBe(true);
  });

  it.each([
    ["an https URL", "https://images.example/a.png"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["an svg data URL", "data:image/svg+xml;base64,PHN2Zy8+"],
    ["a gif data URL", "data:image/gif;base64,R0lGODlhAQABAAAAACw="],
    ["a text data URL", "data:text/html;base64,PHNjcmlwdD4="],
    ["a non-base64 png data URL", "data:image/png,%89PNG"],
    ["a png data URL with a stray character", `${PNG_DATA_URL}!`],
    ["an empty payload", "data:image/png;base64,"],
    ["a non-string", 42],
    ["undefined", undefined],
  ])("refuses %s", (_name, value) => {
    expect(isAvatarDataUrl(value)).toBe(false);
  });

  it("refuses a png whose bytes are not a png", () => {
    const text = `data:image/png;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`;
    expect(isAvatarDataUrl(text)).toBe(false);
  });

  it("refuses a webp whose bytes are not a webp container", () => {
    expect(isAvatarDataUrl(PNG_DATA_URL.replace("image/png", "image/webp"))).toBe(false);
  });

  it("refuses a png declared as webp and a webp declared as png", () => {
    expect(isAvatarDataUrl(WEBP_DATA_URL.replace("image/webp", "image/png"))).toBe(false);
  });

  it("bounds the encoded size at 64 KiB", () => {
    const padding = (length: number) => "A".repeat(length - (length % 4));
    const header = PNG_DATA_URL.slice(0, PNG_DATA_URL.indexOf(",") + 1);
    const atLimit = header + PNG_DATA_URL.slice(header.length, header.length + 16) + padding(AVATAR_MAX_DATA_URL_CHARS - header.length - 16);
    expect(atLimit.length).toBeLessThanOrEqual(AVATAR_MAX_DATA_URL_CHARS);
    expect(isAvatarDataUrl(atLimit)).toBe(true);
    expect(isAvatarDataUrl(`${atLimit}AAAA`)).toBe(false);
  });
});

describe("parseAvatarRecord", () => {
  const entry = { dataUrl: PNG_DATA_URL, sourceUrl: SOURCE_URL, at: 5 };

  it("round-trips what it serialises", () => {
    const parsed = parseAvatarRecord(serializeAvatarRecord(new Map([[PUBKEY, entry]])));
    expect(parsed.get(PUBKEY)).toEqual(entry);
  });

  it.each([
    ["a string", "garbage"],
    ["null", null],
    ["a wrong version", { __version: "profileAvatar.v0", avatars: { [PUBKEY]: entry } }],
    ["no avatars", { __version: "profileAvatar.v1" }],
  ])("reads %s as no entries", (_name, raw) => {
    expect(parseAvatarRecord(raw).size).toBe(0);
  });

  it("drops an entry whose image, source or time is not valid, and keeps the rest", () => {
    const other = "b".repeat(64);
    const parsed = parseAvatarRecord({
      __version: "profileAvatar.v1",
      avatars: {
        [PUBKEY]: { ...entry, dataUrl: "https://relay.example/a.png" },
        [other]: entry,
        ["c".repeat(64)]: { ...entry, sourceUrl: "http://images.example/a.png" },
        ["d".repeat(64)]: { ...entry, at: "now" },
        "not-a-pubkey": entry,
        __proto__: entry,
      },
    });
    expect([...parsed.keys()]).toEqual([other]);
  });
});

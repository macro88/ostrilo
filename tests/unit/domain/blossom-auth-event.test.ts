import { describe, expect, it } from "vitest";
import {
  buildUploadAuthEvent,
  encodeAuthorizationHeader,
  encodeBase64UrlJson,
} from "@/domain/blossom/auth-event";
import {
  AUTH_BACKDATE_SECONDS,
  AUTH_TTL_SECONDS,
  UPLOAD_AUTH_CONTENT,
  UPLOAD_AUTH_KIND,
} from "@/domain/blossom/constants";

const HASH = "ab".repeat(32);
const PUBKEY = "cd".repeat(32);
const HOST = "blossom.example";
const NOW = 1_700_000_000;

const input = { pubkey: PUBKEY, sha256: HASH, serverHost: HOST, now: NOW };

describe("buildUploadAuthEvent", () => {
  it("builds exactly the four tags, in order", () => {
    const event = buildUploadAuthEvent(input);
    expect(event.tags).toEqual([
      ["t", "upload"],
      ["x", HASH],
      ["server", HOST],
      ["expiration", String(NOW + AUTH_TTL_SECONDS)],
    ]);
  });

  it("is a kind 24242 event with a readable sentence for content", () => {
    const event = buildUploadAuthEvent(input);
    expect(event.kind).toBe(24242);
    expect(UPLOAD_AUTH_KIND).toBe(24242);
    expect(event.content).toBe("Upload profile image");
    expect(UPLOAD_AUTH_CONTENT).toBe("Upload profile image");
    expect(event.pubkey).toBe(PUBKEY);
  });

  it("backdates created_at by 10 seconds and expires 300 seconds after now", () => {
    expect(AUTH_BACKDATE_SECONDS).toBe(10);
    expect(AUTH_TTL_SECONDS).toBe(300);
    const event = buildUploadAuthEvent(input);
    expect(event.created_at).toBe(NOW - 10);
    expect(event.tags.find(([name]) => name === "expiration")?.[1]).toBe(
      String(NOW + 300)
    );
  });

  it("keeps created_at in the past and expiration in the future of the same clock reading", () => {
    const event = buildUploadAuthEvent(input);
    const expiration = Number(
      event.tags.find(([name]) => name === "expiration")?.[1]
    );
    expect(event.created_at).toBeLessThan(NOW);
    expect(expiration).toBeGreaterThan(NOW);
  });

  it("applies one policy whatever the server", () => {
    const a = buildUploadAuthEvent({ ...input, serverHost: "a.example" });
    const b = buildUploadAuthEvent({ ...input, serverHost: "b.example" });
    expect(a.created_at).toBe(b.created_at);
    expect(a.tags[3]).toEqual(b.tags[3]);
  });

  it.each([
    ["an uppercase hash", { sha256: HASH.toUpperCase() }],
    ["a short hash", { sha256: HASH.slice(2) }],
    ["a non-hex hash", { sha256: "zz".repeat(32) }],
    ["a short pubkey", { pubkey: PUBKEY.slice(2) }],
    ["an uppercase pubkey", { pubkey: PUBKEY.toUpperCase() }],
    ["an uppercase host", { serverHost: "Blossom.Example" }],
    ["a host with a scheme", { serverHost: "https://blossom.example" }],
    ["a host with a path", { serverHost: "blossom.example/upload" }],
    ["an empty host", { serverHost: "" }],
    ["a fractional clock", { now: NOW + 0.5 }],
  ])("refuses %s", (_name, override) => {
    expect(() => buildUploadAuthEvent({ ...input, ...override })).toThrow();
  });
});

describe("encodeBase64UrlJson", () => {
  it("encodes with the url-safe alphabet and no padding (fixed vector)", () => {
    // Standard base64 of this JSON is eyJraW5kIjoyNDI0MiwiY29udGVudCI6Ij8/Pj5+fsOpIn0=
    expect(encodeBase64UrlJson({ kind: 24242, content: "??>>~~é" })).toBe(
      "eyJraW5kIjoyNDI0MiwiY29udGVudCI6Ij8_Pj5-fsOpIn0"
    );
  });

  it("never emits +, / or =", () => {
    for (let i = 0; i < 200; i += 1) {
      const encoded = encodeBase64UrlJson({ i, text: "?".repeat(i % 7) + ">" });
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("decodes back to the same JSON, including non-ASCII text", () => {
    const value = { content: "Téléchargement ✓", n: 7 };
    const encoded = encodeBase64UrlJson(value);
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(
      atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)),
      (c) => c.charCodeAt(0)
    );
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(value);
  });
});

describe("encodeAuthorizationHeader", () => {
  const signed = {
    ...buildUploadAuthEvent(input),
    id: "11".repeat(32),
    sig: "22".repeat(64),
  };

  it("is the Nostr scheme followed by the encoded event", () => {
    const header = encodeAuthorizationHeader(signed);
    expect(header.startsWith("Nostr ")).toBe(true);
    expect(header.slice("Nostr ".length)).toBe(encodeBase64UrlJson(signed));
    expect(header.slice("Nostr ".length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("round-trips the signed event", () => {
    const token = encodeAuthorizationHeader(signed).slice("Nostr ".length);
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(
      atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)),
      (c) => c.charCodeAt(0)
    );
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(signed);
  });
});

/**
 * The NIP-01 pre-image serializer, tested in isolation.
 *
 * The entire reason this function exists as its own module is that the
 * highest-consequence string in the product should be assertable without a
 * hash, a key, an adapter, a port or a mock. This file imports nothing but the
 * function and the vendored vectors, which is itself part of the assertion:
 * if the serializer ever needs a dependency to be tested, it has stopped being
 * the pure thing the design calls for.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { serializeEventForId } from "@/domain/nostr/event-serialization";
import { loadNip01Vectors } from "../../vectors/load";

const PUBKEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const CREATED_AT = 1700000000;
const KIND = 1;

/** The pre-image for a content-only event, with the content already escaped. */
function handBuilt(serializedContent: string): string {
  return `[0,"${PUBKEY}",${CREATED_AT},${KIND},[],"${serializedContent}"]`;
}

function serializeContent(raw: string): string {
  return serializeEventForId(PUBKEY, CREATED_AT, KIND, [], raw);
}

describe("serializeEventForId", () => {
  it("produces the NIP-01 array in the mandated field order", () => {
    expect(
      serializeEventForId("ab".repeat(32), 1, 0, [["p", "x"]], "hi")
    ).toBe(`[0,"${"ab".repeat(32)}",1,0,[["p","x"]],"hi"]`);
  });

  it("performs no hashing, hex encoding or signing", () => {
    // It returns the pre-image and nothing else. A 64-character hex string
    // coming out of here would mean the hash had leaked back into the domain.
    const out = serializeContent("hello");
    expect(out.startsWith("[0,")).toBe(true);
    expect(out).not.toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(serializeContent("same")).toBe(serializeContent("same"));
  });

  describe("the seven characters NIP-01 mandates escaping", () => {
    const mandated = [
      ["line break", "\n", "\\n"],
      ["double quote", '"', '\\"'],
      ["backslash", "\\", "\\\\"],
      ["carriage return", "\r", "\\r"],
      ["tab", "\t", "\\t"],
      ["backspace", "\b", "\\b"],
      ["form feed", "\f", "\\f"],
    ] as const;

    for (const [name, raw, escaped] of mandated) {
      it(`escapes ${name}`, () => {
        expect(serializeContent(raw)).toBe(handBuilt(escaped));
      });
    }
  });

  describe("the characters NIP-01 says not to escape", () => {
    // These three are where a naive serializer diverges. `JSON.stringify`
    // emits them raw, which is what the spec asks for.
    const passthrough = [
      ["U+2028 line separator", "\u2028"],
      ["U+2029 paragraph separator", "\u2029"],
      ["U+007F delete", "\u007f"],
    ] as const;

    for (const [name, raw] of passthrough) {
      it(`emits ${name} unescaped`, () => {
        expect(serializeContent(raw)).toBe(handBuilt(raw));
      });
    }
  });

  describe("control characters U+0001 to U+001F", () => {
    it("escapes those without a short form as \\u00XX", () => {
      // A DECISION, pinned. This diverges from the letter of NIP-01, which
      // asks for them raw, and matches what most of the ecosystem emits,
      // because most implementations also delegate to their language's JSON
      // serializer. Bit-compatibility with the implementations Ostrilo's
      // events must verify against wins over the letter of the spec here.
      expect(serializeContent("\u0001")).toBe(handBuilt("\\u0001"));
      expect(serializeContent("\u001f")).toBe(handBuilt("\\u001f"));
    });
  });

  describe("lone surrogates", () => {
    it("escapes them, which is why they are refused at the validation boundary", () => {
      // `UnsignedEventSchema` rejects these before they can reach a signing
      // path. The behaviour is pinned anyway: the relay trust boundary
      // recomputes ids for events a hostile relay supplied, and has to get a
      // stable answer in order to reject one.
      expect(serializeContent(String.fromCharCode(0xd800))).toBe(
        handBuilt("\\ud800")
      );
      expect(serializeContent(String.fromCharCode(0xdfff))).toBe(
        handBuilt("\\udfff")
      );
    });

    it("leaves a correctly paired surrogate as the character it is", () => {
      expect(serializeContent("🎉")).toBe(handBuilt("🎉"));
    });
  });

  describe("against the vendored NIP-01 vectors", () => {
    const vectors = loadNip01Vectors();

    it("has vectors to check against", () => {
      expect(vectors.length).toBeGreaterThan(0);
    });

    for (const v of vectors) {
      it(`its pre-image hashes to the published id for ${v.name}`, () => {
        // The serializer produces the string; Node's own SHA-256 - not
        // Ostrilo's - turns it into the id. Using Ostrilo's hash here would
        // let a wrong-but-consistent pair of functions pass.
        const preimage = serializeEventForId(
          v.event.pubkey,
          v.event.created_at,
          v.event.kind,
          v.event.tags,
          v.event.content
        );
        const id = createHash("sha256")
          .update(Buffer.from(preimage, "utf8"))
          .digest("hex");
        expect(id).toBe(v.event.id);
      });
    }
  });
});

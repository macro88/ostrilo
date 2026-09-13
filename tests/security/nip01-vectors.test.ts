/**
 * NIP-01 known-answer tests against cross-implementation event vectors.
 *
 * ## What these vectors are, stated plainly
 *
 * NIP-01 publishes NO official test-vector file. Nothing here claims otherwise.
 *
 * `tests/vectors/nip01-events.json` holds fourteen events that Ostrilo did not
 * generate. Each was produced and signed by a third-party Nostr implementation
 * and was published or served by at least one NAMED external implementation -
 * three come from `go-nostr`'s published test fixtures, the rest were retrieved
 * from public relays and then confirmed byte-identical across relays running
 * different server software. Per-vector attestations live in the vector file;
 * the honest counts and the assembly procedure are in `tests/vectors/README.md`.
 *
 * That distinction is the whole point. Signing with Ostrilo and verifying with
 * Ostrilo would pass for a wrong-but-consistent implementation. Reproducing an
 * id that a Go relay and a Rust relay already agreed on would not.
 *
 * ## Serialization edge cases
 *
 * NIP-01 fixes the id as the SHA-256 of `[0,pubkey,created_at,kind,tags,content]`
 * with a named escape set, so `JSON.stringify` behaviour is load-bearing. The
 * four cases below are pinned against a hand-written expected serialization -
 * not against `JSON.stringify` itself - so a serializer swap changes the test
 * result rather than moving silently with it. Each case records whether the
 * observed behaviour matches the specification, common practice, or neither.
 *
 * Nothing in this file is mocked.
 */

import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { computeEventId, verifyEventSignature } from "@/domain/utils/crypto";
import {
  loadNip01Vectors,
  provenance,
  type Nip01Event,
  type Nip01Vector,
} from "../vectors/load";

const vectors = loadNip01Vectors();

/** SHA-256 over the UTF-8 bytes of an explicitly built serialization. */
function sha256Hex(serialized: string): string {
  return createHash("sha256")
    .update(Buffer.from(serialized, "utf8"))
    .digest("hex");
}

/**
 * Build the NIP-01 serialization by hand, with the content already escaped
 * exactly as the test expects it to appear. Deliberately not `JSON.stringify`:
 * the point is to pin what bytes get hashed, and reusing the serializer under
 * test would make the assertion vacuous.
 */
function idOfHandBuiltSerialization(
  pubkey: string,
  createdAt: number,
  kind: number,
  serializedContent: string
): string {
  return sha256Hex(
    `[0,"${pubkey}",${createdAt},${kind},[],"${serializedContent}"]`
  );
}

const EDGE_CASE_PUBKEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const EDGE_CASE_CREATED_AT = 1700000000;
const EDGE_CASE_KIND = 1;

function edgeCaseId(rawContent: string): string {
  return computeEventId(
    EDGE_CASE_PUBKEY,
    EDGE_CASE_CREATED_AT,
    EDGE_CASE_KIND,
    [],
    rawContent
  );
}

function expectedEdgeCaseId(serializedContent: string): string {
  return idOfHandBuiltSerialization(
    EDGE_CASE_PUBKEY,
    EDGE_CASE_CREATED_AT,
    EDGE_CASE_KIND,
    serializedContent
  );
}

function recomputeId(event: Nip01Event): string {
  return computeEventId(
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  );
}

function title(v: Nip01Vector): string {
  return `${v.name} (kind ${v.event.kind})`;
}

describe("NIP-01 cross-implementation event vectors", () => {
  describe("vector file honesty", () => {
    it("records that NIP-01 has no official vector file", () => {
      const recorded = provenance["nip01-events.json"];
      expect(recorded).toBeDefined();
      expect(
        recorded!.official,
        "NIP-01 publishes no official vector file; this must never be marked official"
      ).toBe(false);
      expect(recorded!.upstream_url).toBeNull();
      expect(recorded!.vector_count).toBe(vectors.length);
    });

    it("names at least one external implementation for every vector", () => {
      for (const v of vectors) {
        expect(
          v.provenance.attestations.length,
          `${v.name} has no named external attestation, so it is not a cross-implementation vector`
        ).toBeGreaterThan(0);
        expect(v.provenance.distinct_implementations.length).toBeGreaterThan(0);
        for (const attestation of v.provenance.attestations) {
          expect(attestation.implementation.length).toBeGreaterThan(0);
          expect(attestation.source.length).toBeGreaterThan(0);
        }
      }
    });

    it("records the true two-or-more-implementations split without rounding it up", () => {
      // Honest bookkeeping, asserted so it cannot drift into an overstatement.
      // 12 vectors carry two or more distinct named implementations; 2 carry
      // exactly one, and are kept for the serialization shapes they cover.
      const multi = vectors.filter(
        (v) => v.provenance.distinct_implementations.length >= 2
      );
      const single = vectors.filter(
        (v) => v.provenance.distinct_implementations.length === 1
      );
      expect(multi).toHaveLength(12);
      expect(single.map((v) => v.name).sort()).toEqual([
        "kind-1-hello-world-secret-key-one",
        "kind-3-contacts-json-content",
      ]);
    });

    it("covers a spread of event kinds", () => {
      expect(vectors).toHaveLength(14);
      expect([...new Set(vectors.map((v) => v.event.kind))].sort((a, b) => a - b))
        .toEqual([0, 1, 3, 6, 7, 10002]);
    });
  });

  // Task 4.10 - computeEventId reproduces every published id exactly.
  describe("computeEventId reproduces every published id", () => {
    for (const v of vectors) {
      it(`reproduces the id for ${title(v)}`, () => {
        expect(
          recomputeId(v.event),
          `Ostrilo computed a different event id from the one ${v.provenance.distinct_implementations.join(
            " and "
          )} agreed on`
        ).toBe(v.event.id);
      });
    }
  });

  // Task 4.11 - every published signature verifies.
  describe("every published signature verifies", () => {
    for (const v of vectors) {
      it(`verifies the signature for ${title(v)}`, () => {
        expect(
          verifyEventSignature(v.event.id, v.event.sig, v.event.pubkey),
          `Ostrilo rejected a signature that ${v.provenance.distinct_implementations.join(
            " and "
          )} accepted`
        ).toBe(true);
      });
    }
  });

  // Task 4.11 - altering any serialized field breaks both id and signature.
  describe("altering a serialized field breaks both the id and the signature", () => {
    const mutations: Array<{
      field: string;
      apply: (event: Nip01Event) => Nip01Event;
    }> = [
      {
        field: "pubkey",
        apply: (e) => ({
          ...e,
          pubkey: e.pubkey.slice(0, 63) + (e.pubkey.endsWith("0") ? "1" : "0"),
        }),
      },
      { field: "created_at", apply: (e) => ({ ...e, created_at: e.created_at + 1 }) },
      { field: "kind", apply: (e) => ({ ...e, kind: e.kind + 1 }) },
      {
        field: "tags",
        apply: (e) => ({ ...e, tags: [...e.tags, ["tampered", "value"]] }),
      },
      { field: "content", apply: (e) => ({ ...e, content: e.content + " " }) },
    ];

    for (const v of vectors) {
      it(`rejects every single-field alteration of ${title(v)}`, () => {
        for (const mutation of mutations) {
          const mutated = mutation.apply(v.event);
          const mutatedId = recomputeId(mutated);

          expect(
            mutatedId,
            `altering ${mutation.field} left the id unchanged, so the id does not cover that field`
          ).not.toBe(v.event.id);

          expect(
            verifyEventSignature(mutatedId, v.event.sig, v.event.pubkey),
            `the published signature still verified against an id built from an altered ${mutation.field}`
          ).toBe(false);
        }
      });
    }

    it("rejects a signature altered by a single hex digit", () => {
      for (const v of vectors) {
        const tampered =
          (v.event.sig[0] === "0" ? "1" : "0") + v.event.sig.slice(1);
        expect(
          verifyEventSignature(v.event.id, tampered, v.event.pubkey),
          `${v.name} accepted a signature with a flipped leading digit`
        ).toBe(false);
      }
    });
  });

  // Tasks 4.12 to 4.14 - the serialization edge cases, pinned with a judgement.
  describe("serialization edge cases", () => {
    // Task 4.12
    describe("control characters U+0001 to U+001F", () => {
      // JUDGEMENT: diverges from the letter of NIP-01, matches deployed practice.
      //
      // NIP-01 names exactly seven escapes for the content string - \n, \", \\,
      // \r, \t, \b, \f - and says no other characters are escaped. Read
      // literally, a U+0001 would therefore be emitted raw. `JSON.stringify`
      // emits the escape `\u0001` instead, because a raw control character is
      // not legal inside a JSON string. Every deployed implementation that
      // serializes through a standard JSON encoder does the same, so ids agree
      // in practice; the divergence is in the wording of the spec, not in
      // interoperability.
      //
      // Pinned so a future serializer that emits raw control bytes is caught.
      const NIP01_NAMED_ESCAPES: Record<number, string> = {
        0x08: "\\b",
        0x09: "\\t",
        0x0a: "\\n",
        0x0c: "\\f",
        0x0d: "\\r",
      };

      it("emits the five NIP-01-named control escapes exactly as the spec names them", () => {
        for (const [codeText, escape] of Object.entries(NIP01_NAMED_ESCAPES)) {
          const code = Number(codeText);
          const raw = String.fromCharCode(code);
          expect(
            edgeCaseId(raw),
            `U+${code.toString(16).padStart(4, "0").toUpperCase()} must serialize as ${escape}`
          ).toBe(expectedEdgeCaseId(escape));
        }
      });

      it("emits every other control character in the range as a lowercase \\u00XX escape", () => {
        for (let code = 0x01; code <= 0x1f; code++) {
          if (code in NIP01_NAMED_ESCAPES) continue;
          const raw = String.fromCharCode(code);
          const escaped = `\\u${code.toString(16).padStart(4, "0")}`;

          expect(
            edgeCaseId(raw),
            `U+${code.toString(16).padStart(4, "0").toUpperCase()} must serialize as ${escaped}`
          ).toBe(expectedEdgeCaseId(escaped));
        }
      });

      it("does not pass control characters through raw, which is what the letter of NIP-01 would require", () => {
        // The failing direction, asserted so the divergence is a recorded
        // decision and not an accident nobody measured.
        const raw = String.fromCharCode(0x01);
        expect(edgeCaseId(raw)).not.toBe(expectedEdgeCaseId(raw));
      });

      it("uses lowercase hex in the escape, not uppercase", () => {
        expect(edgeCaseId(String.fromCharCode(0x1f))).toBe(
          expectedEdgeCaseId("\\u001f")
        );
        expect(edgeCaseId(String.fromCharCode(0x1f))).not.toBe(
          expectedEdgeCaseId("\\u001F")
        );
      });
    });

    // Task 4.13
    describe("U+2028, U+2029 and U+007F", () => {
      // JUDGEMENT: correct. These are legal raw in a JSON string, NIP-01 names
      // no escape for them, and `JSON.stringify` passes them through unescaped.
      // Pinned so a future serializer that escapes them - some JavaScript
      // emitters escape U+2028 and U+2029 for `<script>` safety - is caught
      // before it changes event ids.
      const passThrough: Array<[string, number]> = [
        ["U+2028 LINE SEPARATOR", 0x2028],
        ["U+2029 PARAGRAPH SEPARATOR", 0x2029],
        ["U+007F DELETE", 0x007f],
      ];

      for (const [name, code] of passThrough) {
        it(`passes ${name} through raw and unescaped`, () => {
          const raw = String.fromCharCode(code);
          expect(edgeCaseId(raw)).toBe(expectedEdgeCaseId(raw));
        });

        it(`does not escape ${name}`, () => {
          const raw = String.fromCharCode(code);
          const escaped = `\\u${code.toString(16).padStart(4, "0")}`;
          expect(edgeCaseId(raw)).not.toBe(expectedEdgeCaseId(escaped));
        });
      }
    });

    // Task 4.14
    describe("lone surrogate U+D800", () => {
      // JUDGEMENT: this is the one genuine interoperability divergence here.
      //
      // A lone surrogate has no UTF-8 encoding. `JSON.stringify` follows the
      // well-formed-stringify rule (ES2019) and emits the ASCII escape
      // `\ud800`, which then hashes as the six bytes 5c 75 64 38 30 30.
      // An implementation that instead UTF-8-encodes the raw string gets the
      // replacement character ef bf bd, and an implementation that rejects the
      // input produces no id at all. Implementations genuinely differ, so this
      // input can produce three different outcomes across the network.
      //
      // Pinned with its observed behaviour so the divergence is a decision on
      // record. Whether `computeEventId` should reject such content instead is
      // an open question owned by `consolidate-crypto-implementations`.
      it("emits a lone high surrogate as the escape \\ud800", () => {
        const raw = String.fromCharCode(0xd800);
        expect(edgeCaseId(raw)).toBe(expectedEdgeCaseId("\\ud800"));
      });

      it("emits a lone low surrogate as the escape \\udfff", () => {
        const raw = String.fromCharCode(0xdfff);
        expect(edgeCaseId(raw)).toBe(expectedEdgeCaseId("\\udfff"));
      });

      it("does not substitute the replacement character, which is what a raw UTF-8 encode would produce", () => {
        // The divergent alternative, asserted so the two outcomes stay distinct.
        const raw = String.fromCharCode(0xd800);
        expect(edgeCaseId(raw)).not.toBe(expectedEdgeCaseId("�"));
      });

      it("still encodes a valid surrogate pair as the raw character", () => {
        // The contrast case: a well-formed pair is not escaped, so the escaping
        // above is specific to lone surrogates and not a blanket policy.
        const emoji = "\u{1F600}";
        expect(edgeCaseId(emoji)).toBe(expectedEdgeCaseId(emoji));
      });
    });
  });
});

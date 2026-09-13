import { describe, it, expect } from "vitest";
import {
  UnsignedEventSchema,
  MAX_EVENT_CONTENT_BYTES,
  MAX_EVENT_TAGS,
  MAX_TAG_ELEMENTS,
  MAX_TAG_ELEMENT_BYTES,
  MAX_EVENT_SERIALIZED_BYTES,
} from "@/infrastructure/validation/schemas";

/**
 * Size bounds on an event a web page asks to have signed.
 *
 * There were none. `content` was `z.string()` and `tags` was
 * `z.array(z.array(z.string()))`, so a page could hand the service worker a
 * hundred-megabyte payload, which `computeEventId` would then serialize and
 * SHA-256 inside the worker - and which the approval dialog would render into
 * a clipped panel with no indication of how much was being hidden. The user
 * approves what they can see.
 */

const base = {
  kind: 1,
  content: "hello",
  tags: [] as string[][],
  created_at: 1_735_689_600,
};

const ok = (event: unknown) => UnsignedEventSchema.safeParse(event).success;

describe("event size bounds", () => {
  it("measures content in UTF-8 bytes, not string length", () => {
    // "𝄞".length is 2 but it occupies 4 bytes. A length bound is off by up to
    // 4x on exactly the content most likely to be adversarial.
    const justUnder = "𝄞".repeat(MAX_EVENT_CONTENT_BYTES / 4);
    const justOver = "𝄞".repeat(MAX_EVENT_CONTENT_BYTES / 4 + 1);

    expect(justUnder.length).toBeLessThan(MAX_EVENT_CONTENT_BYTES);
    expect(ok({ ...base, content: justUnder })).toBe(true);
    expect(
      ok({ ...base, content: justOver }),
      "SECURITY REGRESSION: content was bounded by string length, not bytes"
    ).toBe(false);
  });

  it("bounds content", () => {
    expect(ok({ ...base, content: "a".repeat(MAX_EVENT_CONTENT_BYTES) })).toBe(
      true
    );
    expect(
      ok({ ...base, content: "a".repeat(MAX_EVENT_CONTENT_BYTES + 1) })
    ).toBe(false);
  });

  it("bounds the number of tags", () => {
    const tag = ["p", "ab".repeat(32)];
    expect(
      ok({ ...base, tags: Array.from({ length: MAX_EVENT_TAGS }, () => tag) })
    ).toBe(true);
    expect(
      ok({
        ...base,
        tags: Array.from({ length: MAX_EVENT_TAGS + 1 }, () => tag),
      })
    ).toBe(false);
  });

  it("bounds elements within one tag", () => {
    expect(
      ok({ ...base, tags: [Array.from({ length: MAX_TAG_ELEMENTS }, () => "x")] })
    ).toBe(true);
    expect(
      ok({
        ...base,
        tags: [Array.from({ length: MAX_TAG_ELEMENTS + 1 }, () => "x")],
      })
    ).toBe(false);
  });

  it("bounds the size of one tag element", () => {
    expect(
      ok({ ...base, tags: [["p", "x".repeat(MAX_TAG_ELEMENT_BYTES)]] })
    ).toBe(true);
    expect(
      ok({ ...base, tags: [["p", "x".repeat(MAX_TAG_ELEMENT_BYTES + 1)]] })
    ).toBe(false);
  });

  it("bounds the total serialized event, not only each field", () => {
    // Every per-field bound holds here and the result is still enormous:
    // 5,000 tags of 100 elements of 1,024 bytes is about half a gigabyte.
    const fatTag = Array.from({ length: MAX_TAG_ELEMENTS }, () =>
      "x".repeat(MAX_TAG_ELEMENT_BYTES)
    );
    const event = {
      ...base,
      tags: Array.from({ length: MAX_EVENT_TAGS }, () => fatTag),
    };

    expect(
      ok(event),
      "SECURITY REGRESSION: per-field bounds alone let a half-gigabyte event through"
    ).toBe(false);
    expect(MAX_EVENT_SERIALIZED_BYTES).toBeGreaterThan(0);
  });
});

describe("ordinary Nostr events still validate", () => {
  // The bounds are only useful if they are invisible in normal use. These are
  // the shapes the product actually sees.
  const cases: Array<[string, unknown]> = [
    ["a short note", { ...base, kind: 1, content: "gm" }],
    [
      "a long-form article",
      { ...base, kind: 30023, content: "a".repeat(40_000) },
    ],
    ["a reaction", { ...base, kind: 7, content: "+", tags: [["e", "ab".repeat(32)]] }],
    [
      "a profile",
      {
        ...base,
        kind: 0,
        content: JSON.stringify({
          name: "Someone",
          about: "b".repeat(1_000),
          picture: "https://example.com/a.png",
        }),
      },
    ],
    [
      "a relay list",
      {
        ...base,
        kind: 10002,
        content: "",
        tags: Array.from({ length: 20 }, (_, i) => [
          "r",
          `wss://relay-${i}.example`,
        ]),
      },
    ],
    [
      "a contact list of 2,000 people",
      {
        ...base,
        kind: 3,
        content: "",
        tags: Array.from({ length: 2_000 }, () => [
          "p",
          "ab".repeat(32),
          "wss://relay.example",
        ]),
      },
    ],
  ];

  for (const [name, event] of cases) {
    it(`accepts ${name}`, () => {
      expect(ok(event), `${name} must still validate`).toBe(true);
    });
  }
});

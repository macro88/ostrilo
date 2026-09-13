import { describe, it, expect } from "vitest";
import {
  RELAY_BOUNDS,
  RelayEventSchema,
  RelayMessageSchema,
  RelayUrlListSchema,
  RelayUrlSchema,
  alternateRelay,
  assignRelay,
  assignRelayIndex,
  boundNoticeText,
  createPartitionSalt,
  isPartitionSalt,
  matchesFilter,
  sanitizeRelayUrls,
  verifyRelayEvent,
} from "@/domain/relay";
import { computeEventId } from "@/domain/utils/crypto";
import { loadNip01Vectors, type Nip01Event } from "../../vectors/load";

/**
 * The relay validation boundary, exercised against a real third-party-signed
 * NIP-01 event rather than one Ostrilo produced. Signing with Ostrilo and
 * verifying with Ostrilo would pass for a wrong-but-consistent implementation.
 */
const vectors = loadNip01Vectors();
const genuineProfileEvent = vectors.find(
  (vector) => vector.event.kind === 0
)!.event;

function clone(event: Nip01Event): Nip01Event {
  return structuredClone(event);
}

describe("relay bounds", () => {
  it("pins the numeric budget a relay can spend", () => {
    expect(RELAY_BOUNDS.MAX_FRAME_BYTES).toBe(131072);
    expect(RELAY_BOUNDS.MAX_EVENTS_PER_SUBSCRIPTION).toBe(20);
    expect(RELAY_BOUNDS.MAX_EVENT_CONTENT_BYTES).toBe(8192);
    expect(RELAY_BOUNDS.MAX_EVENT_TAGS).toBe(50);
    expect(RELAY_BOUNDS.MAX_TAG_ELEMENTS).toBe(10);
    expect(RELAY_BOUNDS.MAX_TAG_ELEMENT_BYTES).toBe(1024);
    expect(RELAY_BOUNDS.MAX_CREATED_AT_SKEW_SECONDS).toBe(900);
    expect(RELAY_BOUNDS.MAX_NOTICE_CHARS).toBe(200);
    expect(RELAY_BOUNDS.MAX_REMOTE_URL_CHARS).toBe(512);
    expect(RELAY_BOUNDS.MAX_METADATA_BYTES).toBe(4096);
    expect(RELAY_BOUNDS.MAX_CACHE_ENTRIES).toBe(50);
    expect(RELAY_BOUNDS.MAX_CACHE_BYTES).toBe(262144);
    expect(RELAY_BOUNDS.MAX_CONFIGURED_RELAYS).toBe(10);
    expect(RELAY_BOUNDS.FETCH_DEADLINE_MS).toBe(5000);
    expect(RELAY_BOUNDS.MAX_RECONNECT_ATTEMPTS).toBe(5);
  });

  it("truncates relay notice text before it reaches a log", () => {
    const notice = "x".repeat(1000);
    expect(boundNoticeText(notice)).toHaveLength(200);
    expect(boundNoticeText(undefined)).toBe("");
    expect(boundNoticeText({ nested: true })).toBe("");
  });
});

describe("relay message envelope schema", () => {
  const subId = "abc-123_XYZ";

  it("accepts the NIP-01 relay-to-client message types", () => {
    expect(
      RelayMessageSchema.safeParse(["EVENT", subId, genuineProfileEvent]).success
    ).toBe(true);
    expect(RelayMessageSchema.safeParse(["EOSE", subId]).success).toBe(true);
    expect(
      RelayMessageSchema.safeParse(["OK", genuineProfileEvent.id, true]).success
    ).toBe(true);
    expect(RelayMessageSchema.safeParse(["NOTICE", "hello"]).success).toBe(true);
    expect(RelayMessageSchema.safeParse(["CLOSED", subId, "gone"]).success).toBe(
      true
    );
    expect(RelayMessageSchema.safeParse(["AUTH", "challenge"]).success).toBe(
      true
    );
  });

  it("rejects unknown types, non-arrays and malformed subscription IDs", () => {
    expect(RelayMessageSchema.safeParse(["BOGUS", subId]).success).toBe(false);
    expect(RelayMessageSchema.safeParse({ type: "EVENT" }).success).toBe(false);
    expect(RelayMessageSchema.safeParse(["EVENT"]).success).toBe(false);
    expect(RelayMessageSchema.safeParse(["EOSE"]).success).toBe(false);
    expect(
      RelayMessageSchema.safeParse(["EOSE", "has spaces"]).success
    ).toBe(false);
    expect(RelayMessageSchema.safeParse(["EOSE", "a".repeat(65)]).success).toBe(
      false
    );
    expect(RelayMessageSchema.safeParse(["EOSE", ""]).success).toBe(false);
  });

  it("rejects a non-object EVENT payload", () => {
    expect(RelayMessageSchema.safeParse(["EVENT", subId, null]).success).toBe(
      false
    );
    expect(RelayMessageSchema.safeParse(["EVENT", subId, "text"]).success).toBe(
      false
    );
    expect(RelayMessageSchema.safeParse(["EVENT", subId, []]).success).toBe(
      false
    );
  });
});

describe("relay event schema", () => {
  it("accepts a genuine third-party-signed event", () => {
    expect(RelayEventSchema.safeParse(genuineProfileEvent).success).toBe(true);
  });

  it("requires lowercase hex identifiers of exact length", () => {
    const upper = clone(genuineProfileEvent);
    upper.id = upper.id.toUpperCase();
    expect(RelayEventSchema.safeParse(upper).success).toBe(false);

    const shortPubkey = clone(genuineProfileEvent);
    shortPubkey.pubkey = shortPubkey.pubkey.slice(0, 60);
    expect(RelayEventSchema.safeParse(shortPubkey).success).toBe(false);

    const shortSig = clone(genuineProfileEvent);
    shortSig.sig = shortSig.sig.slice(0, 100);
    expect(RelayEventSchema.safeParse(shortSig).success).toBe(false);
  });

  it("bounds content, tags and kind", () => {
    const bigContent = clone(genuineProfileEvent);
    bigContent.content = "x".repeat(RELAY_BOUNDS.MAX_EVENT_CONTENT_BYTES + 1);
    expect(RelayEventSchema.safeParse(bigContent).success).toBe(false);

    const manyTags = clone(genuineProfileEvent);
    manyTags.tags = Array.from({ length: RELAY_BOUNDS.MAX_EVENT_TAGS + 1 }, () => [
      "e",
    ]);
    expect(RelayEventSchema.safeParse(manyTags).success).toBe(false);

    const fatTag = clone(genuineProfileEvent);
    fatTag.tags = [["e", "y".repeat(RELAY_BOUNDS.MAX_TAG_ELEMENT_BYTES + 1)]];
    expect(RelayEventSchema.safeParse(fatTag).success).toBe(false);

    const longTag = clone(genuineProfileEvent);
    longTag.tags = [
      Array.from({ length: RELAY_BOUNDS.MAX_TAG_ELEMENTS + 1 }, () => "e"),
    ];
    expect(RelayEventSchema.safeParse(longTag).success).toBe(false);

    const bigKind = clone(genuineProfileEvent);
    bigKind.kind = 70000;
    expect(RelayEventSchema.safeParse(bigKind).success).toBe(false);
  });

  it("rejects a created_at far in the future", () => {
    const future = clone(genuineProfileEvent);
    future.created_at =
      Math.floor(Date.now() / 1000) +
      RELAY_BOUNDS.MAX_CREATED_AT_SKEW_SECONDS +
      60;
    expect(RelayEventSchema.safeParse(future).success).toBe(false);
  });

  it("drops unknown relay-supplied keys by refusing the event", () => {
    const extra = { ...clone(genuineProfileEvent), surprise: "payload" };
    expect(RelayEventSchema.safeParse(extra).success).toBe(false);
  });
});

describe("verifyRelayEvent", () => {
  it("accepts a genuine event that matches the subscription filter", () => {
    const result = verifyRelayEvent(genuineProfileEvent, {
      kinds: [0],
      authors: [genuineProfileEvent.pubkey],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an event whose author was not requested", () => {
    const result = verifyRelayEvent(genuineProfileEvent, {
      kinds: [0],
      authors: ["b".repeat(64)],
    });
    expect(result).toEqual({ ok: false, reason: "author-mismatch" });
  });

  it("rejects an event whose kind was not requested", () => {
    const result = verifyRelayEvent(genuineProfileEvent, {
      kinds: [1],
      authors: [genuineProfileEvent.pubkey],
    });
    expect(result).toEqual({ ok: false, reason: "kind-mismatch" });
  });

  it("rejects an event whose ID does not match its own contents", () => {
    const tampered = clone(genuineProfileEvent);
    tampered.content = JSON.stringify({ name: "attacker" });
    const result = verifyRelayEvent(tampered);
    expect(result).toEqual({ ok: false, reason: "id-mismatch" });
  });

  it("rejects an event whose signature does not verify", () => {
    // Rewrite the content and recompute the ID, so only the signature is wrong.
    const forged = clone(genuineProfileEvent);
    forged.content = JSON.stringify({
      name: "attacker",
      picture: "https://evil.example.com/track.png",
    });
    forged.id = computeEventId(
      forged.pubkey,
      forged.created_at,
      forged.kind,
      forged.tags,
      forged.content
    );

    const result = verifyRelayEvent(forged);
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects malformed payloads without throwing", () => {
    expect(verifyRelayEvent(null)).toEqual({ ok: false, reason: "schema" });
    expect(verifyRelayEvent("text")).toEqual({ ok: false, reason: "schema" });
    expect(verifyRelayEvent([])).toEqual({ ok: false, reason: "schema" });
  });
});

describe("matchesFilter", () => {
  const event = { pubkey: "a".repeat(64), kind: 0 };

  it("treats an absent filter field as unconstrained", () => {
    expect(matchesFilter(event, {})).toBe(true);
    expect(matchesFilter(event, undefined)).toBe(true);
    expect(matchesFilter(event, { kinds: [0] })).toBe(true);
  });

  it("treats a present filter field as a closed set", () => {
    expect(matchesFilter(event, { authors: ["b".repeat(64)] })).toBe(false);
    expect(matchesFilter(event, { kinds: [1] })).toBe(false);
    expect(matchesFilter(event, { authors: [event.pubkey], kinds: [0] })).toBe(
      true
    );
  });
});

describe("relay URL schema", () => {
  it("accepts only wss URLs", () => {
    expect(RelayUrlSchema.safeParse("wss://relay.example.com").success).toBe(
      true
    );
    expect(RelayUrlSchema.safeParse("ws://relay.example.com").success).toBe(
      false
    );
    expect(RelayUrlSchema.safeParse("http://relay.example.com").success).toBe(
      false
    );
    expect(RelayUrlSchema.safeParse("https://relay.example.com").success).toBe(
      false
    );
    expect(
      RelayUrlSchema.safeParse("wss://user:pass@relay.example.com").success
    ).toBe(false);
    expect(RelayUrlSchema.safeParse("not-a-url").success).toBe(false);
  });

  it("bounds the configured relay list", () => {
    const ten = Array.from(
      { length: 10 },
      (_, i) => `wss://relay-${i}.example.com`
    );
    expect(RelayUrlListSchema.safeParse(ten).success).toBe(true);
    expect(
      RelayUrlListSchema.safeParse([...ten, "wss://relay-10.example.com"])
        .success
    ).toBe(false);
    expect(
      RelayUrlListSchema.safeParse(["wss://ok.example.com", "ws://bad.example.com"])
        .success
    ).toBe(false);
  });

  it("sanitises a stored relay list by dropping cleartext entries", () => {
    expect(
      sanitizeRelayUrls([
        "wss://good.example.com",
        "ws://legacy.example.com",
        "http://nope.example.com",
        "  wss://trimmed.example.com  ",
        "wss://good.example.com",
        42,
      ])
    ).toEqual(["wss://good.example.com", "wss://trimmed.example.com"]);

    expect(sanitizeRelayUrls("not an array")).toEqual([]);
    expect(
      sanitizeRelayUrls(
        Array.from({ length: 25 }, (_, i) => `wss://relay-${i}.example.com`)
      )
    ).toHaveLength(RELAY_BOUNDS.MAX_CONFIGURED_RELAYS);
  });
});

describe("relay partitioning", () => {
  const relays = [
    "wss://relay-a.example.com",
    "wss://relay-b.example.com",
    "wss://relay-c.example.com",
  ];

  it("produces a usable salt", () => {
    const salt = createPartitionSalt();
    expect(isPartitionSalt(salt)).toBe(true);
    expect(isPartitionSalt("not-a-salt")).toBe(false);
    expect(isPartitionSalt(undefined)).toBe(false);
    expect(createPartitionSalt()).not.toBe(salt);
  });

  it("assigns a pubkey to the same relay every time", () => {
    const salt = createPartitionSalt();
    const pubkey = "a".repeat(64);
    const first = assignRelay(pubkey, salt, relays);

    for (let i = 0; i < 20; i++) {
      expect(assignRelay(pubkey, salt, relays)).toBe(first);
    }
  });

  it("does not derive the assignment from the pubkey alone", () => {
    const pubkey = "a".repeat(64);
    const assignments = new Set(
      Array.from({ length: 40 }, () =>
        assignRelay(pubkey, createPartitionSalt(), relays)
      )
    );

    // Different installs must not all land on the same relay for a given key.
    expect(assignments.size).toBeGreaterThan(1);
  });

  it("spreads a set of pubkeys across the configured relays", () => {
    const salt = createPartitionSalt();
    const pubkeys = Array.from({ length: 60 }, (_, i) =>
      i.toString(16).padStart(64, "0")
    );
    const used = new Set(pubkeys.map((pk) => assignRelay(pk, salt, relays)));
    expect(used.size).toBeGreaterThan(1);
  });

  it("offers exactly one alternate relay, never the assigned one", () => {
    const salt = createPartitionSalt();
    const pubkey = "c".repeat(64);
    const assigned = assignRelay(pubkey, salt, relays);
    const alternate = alternateRelay(pubkey, salt, relays);

    expect(alternate).not.toBeNull();
    expect(alternate).not.toBe(assigned);
    expect(relays).toContain(alternate);
    expect(alternateRelay(pubkey, salt, ["wss://only.example.com"])).toBeNull();
  });

  it("reports no assignment when no relay is configured", () => {
    const salt = createPartitionSalt();
    expect(assignRelayIndex("a".repeat(64), salt, 0)).toBe(-1);
    expect(assignRelay("a".repeat(64), salt, [])).toBeNull();
  });
});

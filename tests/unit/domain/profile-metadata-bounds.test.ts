import { describe, it, expect } from "vitest";
import {
  PROFILE_FIELD_BOUNDS,
  ProfileMetadataSchema,
  boundProfileMetadata,
  isAllowedRemoteUrl,
  profileMetadataByteSize,
  validateProfileMetadata,
  validateProfileMetadataDetailed,
} from "@/domain/profile/types";
import { RELAY_BOUNDS } from "@/domain/relay";

describe("remote URL allowlist", () => {
  it("accepts https and nothing else", () => {
    expect(isAllowedRemoteUrl("https://example.com/a.png")).toBe(true);

    expect(isAllowedRemoteUrl("http://example.com/a.png")).toBe(false);
    expect(isAllowedRemoteUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedRemoteUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isAllowedRemoteUrl("blob:https://example.com/abc")).toBe(false);
    expect(isAllowedRemoteUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedRemoteUrl("ws://example.com")).toBe(false);
    expect(isAllowedRemoteUrl("wss://example.com")).toBe(false);
    expect(isAllowedRemoteUrl("ftp://example.com")).toBe(false);
  });

  it("rejects relative URLs and over-long values", () => {
    expect(isAllowedRemoteUrl("/relative/path.png")).toBe(false);
    expect(isAllowedRemoteUrl("example.com/a.png")).toBe(false);
    expect(isAllowedRemoteUrl("not a url")).toBe(false);
    expect(isAllowedRemoteUrl("")).toBe(false);
    expect(isAllowedRemoteUrl(undefined)).toBe(false);
    expect(isAllowedRemoteUrl(42)).toBe(false);

    const tooLong = `https://example.com/${"a".repeat(
      PROFILE_FIELD_BOUNDS.URL
    )}`;
    expect(tooLong.length).toBeGreaterThan(PROFILE_FIELD_BOUNDS.URL);
    expect(isAllowedRemoteUrl(tooLong)).toBe(false);
  });
});

describe("validateProfileMetadata", () => {
  it("drops non-https URL fields while keeping the rest of the profile", () => {
    const result = validateProfileMetadataDetailed({
      name: "Alice",
      picture: "javascript:alert(1)",
      banner: "http://insecure.example.com/banner.png",
      website: "data:text/html,<script>alert(1)</script>",
    });

    expect(result.metadata).toEqual({ name: "Alice" });
    expect(result.metadata?.picture).toBeUndefined();
    expect(result.metadata?.banner).toBeUndefined();
    expect(result.metadata?.website).toBeUndefined();
    expect(result.rejectedFields.sort()).toEqual([
      "banner",
      "picture",
      "website",
    ]);
  });

  it("drops unknown relay-supplied keys", () => {
    const result = validateProfileMetadataDetailed({
      name: "Alice",
      // A relay can put anything here. None of it should reach storage or UI.
      __proto__polluter: "x",
      nip57: "y",
      huge: "z".repeat(5000),
    });

    expect(result.metadata).toEqual({ name: "Alice" });
    expect(Object.keys(result.metadata ?? {})).toEqual(["name"]);
    expect(result.rejectedFields).toContain("nip57");
    expect(result.rejectedFields).toContain("huge");
  });

  it("keeps the https URL fields it is given", () => {
    const metadata = validateProfileMetadata({
      name: "Alice",
      picture: "https://cdn.example.com/a.png",
      banner: "https://cdn.example.com/b.png",
      website: "https://alice.example.com",
      nip05: "alice@example.com",
      lud16: "alice@getalby.com",
      lud06: "lnurl1dp68",
    });

    expect(metadata).toEqual({
      name: "Alice",
      picture: "https://cdn.example.com/a.png",
      banner: "https://cdn.example.com/b.png",
      website: "https://alice.example.com",
      nip05: "alice@example.com",
      lud16: "alice@getalby.com",
      lud06: "lnurl1dp68",
    });
  });

  it("enforces the field length bounds", () => {
    const result = validateProfileMetadataDetailed({
      name: "n".repeat(PROFILE_FIELD_BOUNDS.NAME + 1),
      display_name: "d".repeat(PROFILE_FIELD_BOUNDS.DISPLAY_NAME + 1),
      about: "a".repeat(PROFILE_FIELD_BOUNDS.ABOUT + 1),
      nip05: `${"u".repeat(PROFILE_FIELD_BOUNDS.NIP05)}@example.com`,
      lud06: "l".repeat(PROFILE_FIELD_BOUNDS.LUD06 + 1),
    });

    expect(result.metadata).toEqual({});
    expect(result.rejectedFields.sort()).toEqual([
      "about",
      "display_name",
      "lud06",
      "name",
      "nip05",
    ]);
  });

  it("returns null for a non-object payload", () => {
    expect(validateProfileMetadata("not an object")).toBeNull();
    expect(validateProfileMetadata(null)).toBeNull();
    expect(validateProfileMetadata(["a"])).toBeNull();
  });

  it("rejects non-https URLs through the strict schema too", () => {
    // ProfileRpcHandler.handleUpdate parses user-entered values with this
    // schema directly, so a non-conforming value becomes a field-level error
    // rather than a silent drop.
    const parsed = ProfileMetadataSchema.safeParse({
      name: "Alice",
      picture: "http://insecure.example.com/a.png",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === "picture")).toBe(
        true
      );
    }
  });
});

describe("boundProfileMetadata", () => {
  it("leaves a normal profile alone", () => {
    const metadata = {
      name: "Alice",
      about: "A short bio",
      picture: "https://cdn.example.com/a.png",
    };

    const { metadata: bounded, droppedFields } = boundProfileMetadata(metadata);
    expect(bounded).toEqual(metadata);
    expect(droppedFields).toEqual([]);
  });

  it("sheds optional fields until the serialised profile fits", () => {
    // Every field here is inside its character bound. The byte ceiling is still
    // reachable because the field bounds count characters and the cache budget
    // counts bytes, so a profile written in a multi-byte script costs several
    // times what its character count suggests.
    const metadata = {
      name: "Alice",
      display_name: "アリス",
      about: "あ".repeat(500),
      picture: `https://cdn.example.com/${"p".repeat(400)}.png`,
      banner: `https://cdn.example.com/${"b".repeat(400)}.png`,
      website: `https://alice.example.com/${"w".repeat(400)}`,
      nip05: `${"n".repeat(200)}@example.com`,
      lud16: `${"l".repeat(200)}@getalby.com`,
      lud06: "ル".repeat(512),
    };

    expect(profileMetadataByteSize(metadata)).toBeGreaterThan(
      RELAY_BOUNDS.MAX_METADATA_BYTES
    );

    const { metadata: bounded, droppedFields } = boundProfileMetadata(metadata);

    expect(profileMetadataByteSize(bounded)).toBeLessThanOrEqual(
      RELAY_BOUNDS.MAX_METADATA_BYTES
    );
    expect(droppedFields.length).toBeGreaterThan(0);
    // The identity-bearing field survives: telling identities apart is the
    // point of caching a profile at all.
    expect(bounded.name).toBe("Alice");
  });

  it("sheds even the name when nothing else will fit", () => {
    const { metadata: bounded, droppedFields } = boundProfileMetadata({
      name: "x".repeat(RELAY_BOUNDS.MAX_METADATA_BYTES + 100),
    });

    expect(bounded).toEqual({});
    expect(droppedFields).toContain("name");
  });
});

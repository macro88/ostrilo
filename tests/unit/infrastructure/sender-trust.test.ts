import { describe, expect, it } from "vitest";
import { attestPageOrigin } from "@/infrastructure/messaging/sender-trust";

const RUNTIME_ID = "abcdefghijklmnopabcdefghijklmnop";
const SITE = "https://a.example";

/** A top-frame content-script sender as Chromium reports it. */
const chromium = (overrides: Record<string, unknown> = {}) => ({
  id: RUNTIME_ID,
  tab: { id: 7 },
  frameId: 0,
  url: `${SITE}/path?q=1`,
  origin: SITE,
  ...overrides,
});

/** The same sender as Firefox reports it: no `origin` field. */
const firefox = (overrides: Record<string, unknown> = {}) => {
  const { origin: _origin, ...rest } = chromium(overrides);
  return rest;
};

describe("attestPageOrigin", () => {
  it.each([
    ["Chromium", chromium()],
    ["Firefox", firefox()],
  ])("derives the origin from a %s-shaped top-frame sender", (_name, sender) => {
    expect(attestPageOrigin(sender, RUNTIME_ID, SITE)).toEqual({
      ok: true,
      origin: SITE,
    });
  });

  it("returns the derived origin, not the claimed string", () => {
    const result = attestPageOrigin(
      firefox({ url: "https://A.Example:443/x" }),
      RUNTIME_ID,
      SITE
    );
    expect(result).toEqual({ ok: true, origin: SITE });
  });

  it.each([
    ["no sender", undefined],
    ["a non-object sender", "https://a.example"],
    ["another extension", chromium({ id: "otherextensionidotherextensionid" })],
    ["a missing id", chromium({ id: undefined })],
    ["no tab", chromium({ tab: undefined })],
    ["a subframe", chromium({ frameId: 3 })],
    ["a missing frame id", chromium({ frameId: undefined })],
    ["no url", chromium({ url: undefined })],
    ["an unparseable url", firefox({ url: "not a url" })],
    ["an http url", firefox({ url: "http://a.example/" })],
    ["a file url", firefox({ url: "file:///etc/passwd" })],
    ["a sender origin that disagrees with its url", chromium({ origin: "https://b.example" })],
  ])("refuses %s", (_name, sender) => {
    expect(attestPageOrigin(sender, RUNTIME_ID, SITE).ok).toBe(false);
  });

  it.each([
    ["a different origin", "https://trusted.example"],
    ["a missing claim", undefined],
    ["a non-string claim", 42],
    ["a claim with a path", `${SITE}/path`],
  ])("refuses %s in the message", (_name, claimed) => {
    expect(attestPageOrigin(chromium(), RUNTIME_ID, claimed).ok).toBe(false);
    expect(attestPageOrigin(firefox(), RUNTIME_ID, claimed).ok).toBe(false);
  });
});

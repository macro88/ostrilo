import { describe, expect, it } from "vitest";
import {
  isRoutableRelayHost,
  parseRelayList,
  relayListTags,
  selectPublishRelays,
} from "@/domain/relay/relay-list";

describe("public relay lists", () => {
  it("merges normalized URLs, counts invalid tags and ignores content", () => {
    const parsed = parseRelayList({
      content: "ignored",
      tags: [
        ["r", "wss://A.example/", "read"],
        ["r", "wss://a.example", "write"],
        ["r", "ws://plain.example"],
        ["r", "wss://b.example", "both"],
      ],
    });
    expect(parsed?.droppedCount).toBe(2);
    expect(relayListTags(parsed!.entries)).toEqual([["r", "wss://a.example"]]);
  });

  it("refuses to truncate oversized lists", () => {
    expect(
      parseRelayList({
        tags: Array.from({ length: 21 }, (_, i) => [
          "r",
          `wss://r${i}.example`,
        ]),
      }),
    ).toBeNull();
  });

  it.each([
    "localhost.",
    "a.localhost",
    "a.local",
    "x.internal",
    "0.1.1.1",
    "10.0.0.1",
    "100.127.1.1",
    "127.0.0.1",
    "169.254.1.2",
    "172.31.255.255",
    "192.168.1.1",
    "[::]",
    "[::1]",
    "[fc00::1]",
    "[fdff::1]",
    "[febf::1]",
    "[::ffff:127.0.0.1]",
    "[::ffff:c0a8:1]",
  ])("keeps %s off the network", (host) => {
    expect(isRoutableRelayHost(`wss://${host}`)).toBe(false);
  });

  it("allows a public domain whose first label is numeric", () => {
    expect(isRoutableRelayHost("wss://10.relay.example")).toBe(true);
  });

  it("permits configured private destinations and public write relays", () => {
    const entries = parseRelayList({
      tags: [
        ["r", "wss://localhost"],
        ["r", "wss://public.example"],
        ["r", "wss://read.example", "read"],
      ],
    })!.entries;
    expect(selectPublishRelays(entries, [], [])).toEqual([
      "wss://public.example",
    ]);
    expect(selectPublishRelays(entries, [], ["wss://localhost"])).toContain(
      "wss://localhost",
    );
  });
});

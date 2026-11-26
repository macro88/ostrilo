import { describe, expect, it } from "vitest";
import {
  BLOSSOM_SERVERS,
  BLOSSOM_SERVER_IDS,
  blossomServerHost,
  findBlossomServer,
  normalizeBlossomServer,
} from "@/domain/blossom/servers";

describe("curated Blossom server list", () => {
  it("lists the vetted servers in order", () => {
    expect(BLOSSOM_SERVERS.map((server) => [server.id, server.origin])).toEqual(
      [
        ["primal", "https://blossom.primal.net"],
        ["nostr-build", "https://blossom.nostr.build"],
        ["nostrcheck", "https://cdn.nostrcheck.me"],
      ]
    );
  });

  it("has unique kebab-case ids that match the id tuple", () => {
    const ids = BLOSSOM_SERVERS.map((server) => server.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...BLOSSOM_SERVER_IDS]);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it.each(BLOSSOM_SERVERS)(
    "$id is a bare lowercase https origin with a display name",
    (server) => {
      const url = new URL(server.origin);
      expect(url.protocol).toBe("https:");
      expect(server.origin).toBe(`https://${url.host}`);
      expect(server.origin).toBe(server.origin.toLowerCase());
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(server.name.trim().length).toBeGreaterThan(0);
    }
  );

  it("finds a server by id and nothing else", () => {
    expect(findBlossomServer("primal")?.origin).toBe(
      "https://blossom.primal.net"
    );
    expect(findBlossomServer("PRIMAL")).toBeUndefined();
    expect(findBlossomServer("https://blossom.primal.net")).toBeUndefined();
    expect(findBlossomServer("")).toBeUndefined();
    expect(findBlossomServer(undefined)).toBeUndefined();
    expect(findBlossomServer(42)).toBeUndefined();
    expect(findBlossomServer("__proto__")).toBeUndefined();
    expect(findBlossomServer("constructor")).toBeUndefined();
  });

  it("names the host of a server", () => {
    const server = findBlossomServer("nostrcheck");
    expect(server && blossomServerHost(server)).toBe("cdn.nostrcheck.me");
  });

  it("normalizes a stored value to a listed id or undefined", () => {
    expect(normalizeBlossomServer("nostr-build")).toBe("nostr-build");
    expect(normalizeBlossomServer("removed-in-a-later-release")).toBeUndefined();
    expect(normalizeBlossomServer("https://evil.example")).toBeUndefined();
    expect(normalizeBlossomServer(null)).toBeUndefined();
    expect(normalizeBlossomServer({ id: "primal" })).toBeUndefined();
  });
});

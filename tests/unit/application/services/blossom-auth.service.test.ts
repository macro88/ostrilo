import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BlossomAuthService,
  UploadAuthKeyNotFoundError,
  UploadAuthServerError,
  type UploadAuthVault,
} from "@/application/services/blossom-auth.service";
import { ActivityLogService } from "@/application/services/activity-log.service";
import { computeEventId } from "@/application/crypto/event-id";
import type { StorageSuite } from "@/application/ports/storage";
import {
  NobleSchnorr,
  NobleSha256,
} from "@/infrastructure/crypto/adapters";
import { memoryStorage, testVault } from "../../../helpers/vault";
import {
  PUBKEY_ONE,
  SECRET_ONE,
  STRONG_PASSWORD,
} from "../../infrastructure/messaging-fixture";

const HASH = "ab".repeat(32);
const NOW_MS = 1_700_000_000_500;
const NOW_S = 1_700_000_000;

const hexBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

function decodeToken(header: string): Record<string, unknown> {
  const token = header.slice("Nostr ".length);
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
}

/** Storage that remembers everything written to it, to prove what is not. */
function recordingStorage(): { storage: StorageSuite; writes: string[] } {
  const base = memoryStorage();
  const writes: string[] = [];
  const wrap = (area: StorageSuite["local"]): StorageSuite["local"] => ({
    ...area,
    async set(key, value) {
      writes.push(JSON.stringify({ key, value }));
      return area.set(key, value);
    },
  });
  return {
    storage: { local: wrap(base.local), sync: wrap(base.sync), session: wrap(base.session) },
    writes,
  };
}

describe("BlossomAuthService", () => {
  let storage: StorageSuite;
  let writes: string[];
  let vault: ReturnType<typeof testVault>["vault"];
  let activity: ActivityLogService;
  let service: BlossomAuthService;

  beforeEach(async () => {
    ({ storage, writes } = recordingStorage());
    ({ vault } = testVault(storage));
    activity = new ActivityLogService(storage.local);
    service = new BlossomAuthService(vault, activity, () => NOW_MS);
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await vault.unlock(STRONG_PASSWORD);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a Nostr header carrying an event signed by the named key", async () => {
    const header = await service.authorizeUpload({
      pubkey: PUBKEY_ONE,
      sha256: HASH,
      serverId: "primal",
    });

    expect(header.startsWith("Nostr ")).toBe(true);
    const event = decodeToken(header) as {
      id: string;
      pubkey: string;
      sig: string;
      created_at: number;
      kind: number;
      tags: string[][];
      content: string;
    };
    expect(event.pubkey).toBe(PUBKEY_ONE);
    expect(event.kind).toBe(24242);
    expect(event.content).toBe("Upload profile image");
    expect(event.created_at).toBe(NOW_S - 10);
    expect(event.tags).toEqual([
      ["t", "upload"],
      ["x", HASH],
      ["server", "blossom.primal.net"],
      ["expiration", String(NOW_S + 300)],
    ]);
  });

  it("signs an event whose id and signature verify", async () => {
    const header = await service.authorizeUpload({
      pubkey: PUBKEY_ONE,
      sha256: HASH,
      serverId: "nostr-build",
    });
    const event = decodeToken(header) as {
      id: string;
      pubkey: string;
      sig: string;
      created_at: number;
      kind: number;
      tags: string[][];
      content: string;
    };

    const id = computeEventId(NobleSha256, event);
    expect(event.id).toBe(id);
    expect(
      NobleSchnorr.verify(hexBytes(event.sig), hexBytes(id), hexBytes(event.pubkey))
    ).toBe(true);
    expect(event.tags[2]).toEqual(["server", "blossom.nostr.build"]);
  });

  it("records one activity entry for the authorisation", async () => {
    const keyId = (await vault.listKeys())[0].id;

    await service.authorizeUpload({
      pubkey: PUBKEY_ONE,
      sha256: HASH,
      serverId: "nostrcheck",
    });

    const entries = await activity.getRecent(10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      origin: "extension://profile",
      kind: 24242,
      decision: "allow",
      keyId,
      contentPreview: "Upload profile image",
    });
  });

  it("refuses a key the vault does not hold, signing and logging nothing", async () => {
    const signSpy = vi.spyOn(vault, "signEvent");

    await expect(
      service.authorizeUpload({
        pubkey: "ef".repeat(32),
        sha256: HASH,
        serverId: "primal",
      })
    ).rejects.toBeInstanceOf(UploadAuthKeyNotFoundError);

    expect(signSpy).not.toHaveBeenCalled();
    expect(await activity.getRecent(10)).toEqual([]);
  });

  it("refuses a server that is not on the list, signing and logging nothing", async () => {
    const signSpy = vi.spyOn(vault, "signEvent");

    await expect(
      service.authorizeUpload({
        pubkey: PUBKEY_ONE,
        sha256: HASH,
        serverId: "evil.example",
      })
    ).rejects.toBeInstanceOf(UploadAuthServerError);

    expect(signSpy).not.toHaveBeenCalled();
    expect(await activity.getRecent(10)).toEqual([]);
  });

  it("signs with the key named, not the selected one", async () => {
    const signSpy = vi.spyOn(vault, "signEvent");
    const keyId = (await vault.listKeys())[0].id;

    await service.authorizeUpload({
      pubkey: PUBKEY_ONE,
      sha256: HASH,
      serverId: "primal",
    });

    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(signSpy.mock.calls[0][1]).toBe(keyId);
  });

  it("refuses while the vault is locked, logging nothing", async () => {
    await vault.lock();

    await expect(
      service.authorizeUpload({
        pubkey: PUBKEY_ONE,
        sha256: HASH,
        serverId: "primal",
      })
    ).rejects.toThrow();

    expect(await activity.getRecent(10)).toEqual([]);
  });

  it.each([
    ["another key", { pubkey: "ef".repeat(32) }],
    ["another kind", { kind: 1 }],
  ])("refuses a signer that returns an event with %s", async (_name, override) => {
    const key = (await vault.listKeys())[0];
    const lying: UploadAuthVault = {
      listKeys: async () => [key],
      async signEvent(event) {
        return { ...event, id: "11".repeat(32), sig: "22".repeat(64), ...override };
      },
    };
    const guarded = new BlossomAuthService(lying, activity, () => NOW_MS);

    await expect(
      guarded.authorizeUpload({ pubkey: PUBKEY_ONE, sha256: HASH, serverId: "primal" })
    ).rejects.toThrow("unexpected event");
    expect(await activity.getRecent(10)).toEqual([]);
  });

  it("never hands out a token it could not log", async () => {
    vi.spyOn(activity, "addEntry").mockRejectedValue(new Error("storage full"));

    await expect(
      service.authorizeUpload({
        pubkey: PUBKEY_ONE,
        sha256: HASH,
        serverId: "primal",
      })
    ).rejects.toThrow("storage full");
  });

  it("keeps the token out of storage, the activity log and the console", async () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => {})
    );
    writes.length = 0;

    const header = await service.authorizeUpload({
      pubkey: PUBKEY_ONE,
      sha256: HASH,
      serverId: "primal",
    });
    const token = header.slice("Nostr ".length);
    const sigHex = (decodeToken(header) as { sig: string }).sig;

    for (const write of writes) {
      expect(write).not.toContain(token);
      expect(write).not.toContain(sigHex);
    }
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(token);
        expect(JSON.stringify(call)).not.toContain(sigHex);
      }
    }
    expect(JSON.stringify(await activity.getRecent(10))).not.toContain(token);
  });

  it("reads the clock once per authorisation", async () => {
    const clock = vi.fn(() => NOW_MS);
    const timed = new BlossomAuthService(vault, activity, clock);

    await timed.authorizeUpload({
      pubkey: PUBKEY_ONE,
      sha256: HASH,
      serverId: "primal",
    });

    expect(clock).toHaveBeenCalledTimes(1);
  });
});

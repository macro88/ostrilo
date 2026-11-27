import { ProfileService } from "@/application/services/profile.service";
import { VaultRpcHandler } from "@/infrastructure/messaging/handlers/vault-rpc";
import { describe, expect, it, vi } from "vitest";
import { RelayListService } from "@/application/services/relay-list.service";
import { RelayListCache } from "@/application/services/relay-list-cache";
import { lookupOn } from "@/application/services/relay-list-lookup";
import { RELAY_BOUNDS } from "@/domain/relay";
import {
  realContext,
  SECRET_ONE,
  STRONG_PASSWORD,
} from "../../infrastructure/messaging-fixture";
import { memoryStorage } from "../../../helpers/vault";

const discovery = "wss://relay.example";
const old = "wss://old.example";
const next = "wss://next.example";
const permissions = (url: string) => ({ url, read: true, write: true });
async function fixture() {
  const f = realContext();
  const key = await f.vault.importKey(SECRET_ONE, STRONG_PASSWORD);
  await f.vault.unlock(STRONG_PASSWORD);
  const service = new RelayListService(
    f.relay,
    f.storage.session,
    f.vault,
    f.activityLog,
  );
  const event = await f.vault.signEvent(
    {
      kind: 10002,
      pubkey: key.pubkey,
      created_at: Math.floor(Date.now() / 1000) + 10,
      tags: [["r", old]],
      content: "",
    },
    key.id,
  );
  return { ...f, service, key, event };
}

describe("relay list lookup and publication", () => {
  it("guards the editor base, includes previous write relays and records only accepted publications", async () => {
    const { service, key, relay, event, storage, activityLog } =
      await fixture();
    const log = vi.spyOn(activityLog, "addEntry");
    const sends = vi.spyOn(relay, "publishTo");
    relay.published.push(event);
    const subscriptions = vi.spyOn(relay, "subscribeOn");
    const args = [
      key.id,
      key.pubkey,
      [permissions(next), permissions("wss://localhost")],
    ] as const;
    expect((await service.publish(...args, null)).status).toBe("changed");
    expect(sends).not.toHaveBeenCalled();
    expect((await service.publish(...args, event.id)).status).toBe("published");
    expect(subscriptions.mock.calls.map((call) => call[0])).toContain(old);
    for (const [, filter] of subscriptions.mock.calls)
      expect(filter).toEqual({ authors: [key.pubkey], kinds: [10002] });
    expect(sends.mock.calls[0][0].sort()).toEqual(
      [old, discovery, next].sort(),
    );
    expect(relay.published.at(-1)).toMatchObject({
      created_at: event.created_at + 1,
      tags: [
        ["r", next],
        ["r", "wss://localhost"],
      ],
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "extension://relays",
        keyId: key.id,
        kind: 10002,
      }),
    );
    expect(await storage.local.get("relayListCache")).toBeUndefined();
    await service.invalidate(key.pubkey);
    expect(await service.lookupUrls(key.pubkey)).toEqual([discovery]);
  });

  it("blocks an unreachable or unreadable list and refuses read-only entries", async () => {
    const { service, key, relay, event } = await fixture();
    expect(await service.lookup(key.pubkey)).toEqual({ status: "none" });
    await expect(
      service.publish(
        key.id,
        key.pubkey,
        [{ ...permissions(next), write: false }],
        null,
      ),
    ).rejects.toThrow();
    const sub = vi
      .spyOn(relay, "subscribeOn")
      .mockRejectedValue(new Error("offline"));
    expect(
      await service.publish(key.id, key.pubkey, [permissions(next)], null),
    ).toEqual({ status: "blocked", reason: "unreachable" });
    sub.mockImplementation(async (_url, _filter, accept, end) => {
      accept({ ...event, pubkey: "other" });
      end?.();
      return "s";
    });
    expect(
      await service.publish(key.id, key.pubkey, [permissions(next)], null),
    ).toEqual({ status: "blocked", reason: "unreadable" });
    expect(relay.published).toHaveLength(0);
  });

  it("accounts for deadlines even when subscribe never resolves", async () => {
    const { relay, key } = await fixture();
    vi.useFakeTimers();
    try {
      vi.spyOn(relay, "subscribeOn").mockImplementation(
        () => new Promise(() => {}),
      );
      const promise = lookupOn(relay, discovery, key.pubkey);
      await vi.advanceTimersByTimeAsync(RELAY_BOUNDS.FETCH_DEADLINE_MS);
      expect(await promise).toEqual({ status: "unreachable" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports zero acceptances without writing activity", async () => {
    const { relay, service, key, activityLog } = await fixture();
    relay.failPublish = true;
    const log = vi.spyOn(activityLog, "addEntry");
    expect(
      await service.publish(key.id, key.pubkey, [permissions(discovery)], null),
    ).toEqual({
      status: "failed",
      results: [{ url: discovery, accepted: false }],
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("routes explicit profile writes and refreshes while hydration stays on discovery", async () => {
    const { key, relay, event, storage, vault, service } = await fixture();
    const profiles = new ProfileService(storage, relay, vault, service);
    const send = vi.spyOn(relay, "publishTo");
    const subscribe = vi.spyOn(relay, "subscribeOn");
    await profiles.updateProfile({ name: "Initial" });
    expect(send.mock.calls[0][0]).toEqual([discovery]);
    relay.published.push(event);
    await profiles.updateProfile({ name: "Updated" });
    expect(send.mock.calls[1][0]).toEqual([discovery, old]);
    subscribe.mockClear();
    await profiles.getProfile(key.pubkey, true);
    expect(subscribe.mock.calls.map((call) => call[0])).toEqual([
      discovery,
      old,
    ]);
    await profiles.clearCache(key.pubkey);
    subscribe.mockClear();
    await profiles.getAllProfiles();
    expect(
      subscribe.mock.calls.some((call) => call[1].kinds?.includes(10002)),
    ).toBe(false);
    expect(subscribe.mock.calls.some((call) => call[0] === old)).toBe(false);
  });

  it("returns a newly generated record without waiting for publication and never retries a failed starter", async () => {
    const { context, relay, settings, vault } = realContext();
    await settings.update({ relays: [discovery] });
    let finish!: (result: { url: string; accepted: boolean }[]) => void;
    const send = vi.spyOn(relay, "publishTo").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const handler = new VaultRpcHandler();
    const reply = await handler.handleRequest(
      { type: "vault.generate", password: STRONG_PASSWORD },
      context,
    );
    expect(reply.ok).toBe(true);
    expect(send.mock.calls[0][1]).toMatchObject({
      kind: 10002,
      tags: [["r", discovery]],
      content: "",
    });
    finish([{ url: discovery, accepted: false }]);
    await vault.unlock(STRONG_PASSWORD);
    expect(send).toHaveBeenCalledTimes(1);
    await handler.handleRequest(
      {
        type: "vault.generate",
        password: STRONG_PASSWORD,
        publishStarter: false,
      },
      context,
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("bounds and expires session records", async () => {
    const storage = memoryStorage();
    const cache = new RelayListCache(storage.session);
    const list = {
      entries: [],
      eventId: "event",
      createdAt: 1,
      droppedCount: 0,
    };
    for (let i = 0; i < 51; i++) await cache.update("user-" + i, list);
    expect(await cache.get("user-0")).toBeUndefined();
    expect(await cache.get("user-50")).toBeDefined();
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(3600001);
      expect(await cache.get("user-50")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

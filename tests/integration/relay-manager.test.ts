import { describe, expect, it, vi } from "vitest";
import { RelayManager } from "@/infrastructure/relay/relay-manager";
import type {
  NostrEvent,
  NostrEventCallback,
  NostrEOSECallback,
  NostrFilter,
} from "@/application/ports/relay";

function createEvent(id: string): NostrEvent {
  return {
    id,
    pubkey: "pubkey",
    created_at: 1,
    kind: 0,
    tags: [],
    content: "{}",
    sig: "sig",
  };
}

function createRelay(options: {
  subId?: string;
  event?: NostrEvent;
  error?: Error;
}) {
  return {
    subscribe: vi.fn(
      async (
        _filter: NostrFilter,
        onEvent: NostrEventCallback,
        onEOSE?: NostrEOSECallback
      ) => {
        if (options.error) {
          throw options.error;
        }

        if (options.event) {
          onEvent(options.event);
        }

        onEOSE?.();
        return options.subId ?? crypto.randomUUID();
      }
    ),
    publish: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    getRelayUrl: vi.fn(() => "wss://relay.example"),
  };
}

describe("RelayManager", () => {
  it("reflects exactly the relay list it is given, with no implicit defaults", () => {
    // The default relay list is applied by SettingsService (see
    // settings.service.ts and its tests), not here. RelayManager must stay
    // faithful to its input: if it substituted defaults for an empty list,
    // removing every relay in Settings would silently reconnect the user to
    // the default relay they had just removed.
    expect(new RelayManager([]).getRelayUrls()).toEqual([]);

    const configured = ["wss://relay.example", "wss://relay.other"];
    expect(new RelayManager(configured).getRelayUrls()).toEqual(configured);
  });

  it("keeps profile subscriptions alive when one relay fails", async () => {
    const manager = new RelayManager([]);
    const event = createEvent("event-1");
    const healthyRelay = createRelay({ subId: "healthy-sub", event });
    const failedRelay = createRelay({ error: new Error("connection failed") });
    (manager as any).relays = [healthyRelay, failedRelay];

    const onEvent = vi.fn();
    const onEOSE = vi.fn();

    const subId = await manager.subscribe(
      { kinds: [0] },
      onEvent,
      onEOSE
    );

    expect(subId).toBe("healthy-sub,");
    expect(onEvent).toHaveBeenCalledWith(event);
    expect(onEOSE).toHaveBeenCalledTimes(1);
  });

  it("returns an empty subscription and EOSE when every relay fails", async () => {
    const manager = new RelayManager([]);
    const firstRelay = createRelay({ error: new Error("first failed") });
    const secondRelay = createRelay({ error: new Error("second failed") });
    (manager as any).relays = [firstRelay, secondRelay];

    const onEvent = vi.fn();
    const onEOSE = vi.fn();

    const subId = await manager.subscribe(
      { kinds: [0] },
      onEvent,
      onEOSE
    );

    expect(subId).toBe(",");
    expect(onEvent).not.toHaveBeenCalled();
    expect(onEOSE).toHaveBeenCalledTimes(1);
  });

  it("disconnects existing relays before applying updated relay URLs", async () => {
    const manager = new RelayManager([]);
    const oldRelay = createRelay({ subId: "old-sub" });
    (manager as any).relays = [oldRelay];

    await manager.setRelayUrls(["wss://relay.example"]);

    expect(oldRelay.disconnect).toHaveBeenCalledTimes(1);
    expect(manager.getRelayUrls()).toEqual(["wss://relay.example"]);
  });

  it("refuses to open a connection to a cleartext or malformed relay URL", () => {
    // Defence in depth. The settings schema and the domain validator reject
    // these first; the manager must not open a socket if one slips through.
    const manager = new RelayManager([
      "wss://relay.example",
      "ws://legacy.example",
      "http://relay.example",
      "wss://user:pass@relay.example",
      "not-a-url",
    ]);

    expect(manager.getRelayUrls()).toEqual(["wss://relay.example"]);
  });

  it("bounds the number of configured relays", () => {
    const manager = new RelayManager(
      Array.from({ length: 25 }, (_, i) => `wss://relay-${i}.example`)
    );

    expect(manager.getRelayCount()).toBe(10);
  });

  it("de-duplicates repeated relay URLs", () => {
    const manager = new RelayManager([
      "wss://relay.example",
      "wss://relay.example",
      "  wss://relay.example  ",
    ]);

    expect(manager.getRelayUrls()).toEqual(["wss://relay.example"]);
  });

  describe("subscribeOn", () => {
    function managerWithRelays(urls: string[]) {
      const manager = new RelayManager([]);
      const relays = urls.map((url) => {
        const relay = createRelay({ subId: `sub-${url}` });
        relay.getRelayUrl = vi.fn(() => url);
        return relay;
      });
      (manager as any).relays = relays;
      return { manager, relays };
    }

    it("subscribes on exactly one relay and leaves the others untouched", async () => {
      const { manager, relays } = managerWithRelays([
        "wss://relay-a.example",
        "wss://relay-b.example",
        "wss://relay-c.example",
      ]);

      const subId = await manager.subscribeOn(
        "wss://relay-b.example",
        { kinds: [0], authors: ["a".repeat(64)], limit: 1 },
        vi.fn(),
        vi.fn()
      );

      expect(relays[0].subscribe).not.toHaveBeenCalled();
      expect(relays[1].subscribe).toHaveBeenCalledTimes(1);
      expect(relays[2].subscribe).not.toHaveBeenCalled();

      // Positional composite ID, so close() still lines IDs up with relays.
      expect(subId).toBe(",sub-wss://relay-b.example,");
    });

    it("closes only the relay that was subscribed", async () => {
      const { manager, relays } = managerWithRelays([
        "wss://relay-a.example",
        "wss://relay-b.example",
      ]);

      const subId = await manager.subscribeOn(
        "wss://relay-b.example",
        { kinds: [0] },
        vi.fn()
      );
      await manager.close(subId);

      expect(relays[0].close).not.toHaveBeenCalled();
      expect(relays[1].close).toHaveBeenCalledWith("sub-wss://relay-b.example");
    });

    it("signals EOSE when the named relay is not configured", async () => {
      const { manager, relays } = managerWithRelays(["wss://relay-a.example"]);
      const onEOSE = vi.fn();

      await manager.subscribeOn(
        "wss://relay-unknown.example",
        { kinds: [0] },
        vi.fn(),
        onEOSE
      );

      expect(relays[0].subscribe).not.toHaveBeenCalled();
      expect(onEOSE).toHaveBeenCalledTimes(1);
    });

    it("signals EOSE when the named relay fails to subscribe", async () => {
      const manager = new RelayManager([]);
      const failing = createRelay({ error: new Error("unreachable") });
      failing.getRelayUrl = vi.fn(() => "wss://relay-a.example");
      (manager as any).relays = [failing];

      const onEOSE = vi.fn();
      const subId = await manager.subscribeOn(
        "wss://relay-a.example",
        { kinds: [0] },
        vi.fn(),
        onEOSE
      );

      expect(onEOSE).toHaveBeenCalledTimes(1);
      expect(subId).toBe("");
    });
  });
});
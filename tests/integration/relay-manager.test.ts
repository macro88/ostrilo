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
});
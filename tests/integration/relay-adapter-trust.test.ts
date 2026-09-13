import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import { NostrRelayAdapter } from "@/infrastructure/relay/nostr-relay.adapter";
import { RELAY_BOUNDS } from "@/domain/relay";
import { NostrEventCrypto } from "@/infrastructure/crypto/adapters";
import { bytesToHex, hexToBytes } from "@/domain/utils/hex";
import { loadNip01Vectors, type Nip01Event } from "../vectors/load";

/**
 * NostrRelayAdapter as a trust boundary.
 *
 * These drive the adapter through a fake WebSocket rather than asserting on
 * method arity, because the property under test is what the adapter does with
 * bytes a hostile relay sends, and that lives entirely in the message handler.
 */

type Listener = ((event: any) => void) | null;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];
  /** When true, every new socket errors as soon as it is constructed. */
  static autoFail = false;

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];

  onopen: Listener = null;
  onerror: Listener = null;
  onmessage: Listener = null;
  onclose: Listener = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    if (MockWebSocket.autoFail) {
      queueMicrotask(() => {
        this.readyState = MockWebSocket.CLOSED;
        this.onerror?.({});
      });
    }
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  // -- test controls ---------------------------------------------------------

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  deliver(raw: string): void {
    this.onmessage?.({ data: raw });
  }

  deliverMessage(message: unknown): void {
    this.deliver(JSON.stringify(message));
  }

  static reset(): void {
    MockWebSocket.instances = [];
    MockWebSocket.autoFail = false;
  }

  static latest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

const RELAY_URL = "wss://test-relay.example.com";

const vectors = loadNip01Vectors();
const genuineProfileEvent = vectors.find((v) => v.event.kind === 0)!.event;

/** A local key used only to mint additional validly signed events. */
const TEST_SECRET_KEY = new Uint8Array(32).fill(7);
const TEST_PUBKEY = bytesToHex(schnorr.getPublicKey(TEST_SECRET_KEY));

function signEvent(
  fields: Pick<Nip01Event, "created_at" | "kind" | "tags" | "content">
): Nip01Event {
  const id = NostrEventCrypto.computeEventId({
    pubkey: TEST_PUBKEY,
    ...fields,
  });
  return {
    id,
    pubkey: TEST_PUBKEY,
    sig: bytesToHex(schnorr.sign(hexToBytes(id), TEST_SECRET_KEY)),
    ...fields,
  };
}

function clone(event: Nip01Event): Nip01Event {
  return structuredClone(event);
}

async function connectedAdapter(url = RELAY_URL) {
  const adapter = new NostrRelayAdapter(url);
  const events: Nip01Event[] = [];
  let eoseCount = 0;

  const subscribePromise = adapter.subscribe(
    { kinds: [0], authors: [genuineProfileEvent.pubkey] },
    (event) => events.push(event as unknown as Nip01Event),
    () => {
      eoseCount += 1;
    }
  );

  MockWebSocket.latest().open();
  const subId = await subscribePromise;

  return { adapter, subId, events, socket: MockWebSocket.latest(), eose: () => eoseCount };
}

describe("NostrRelayAdapter trust boundary", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    MockWebSocket.reset();
    (globalThis as any).WebSocket = MockWebSocket;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).WebSocket;
  });

  describe("transport", () => {
    it("refuses to open a WebSocket for a non-wss relay URL", async () => {
      const adapter = new NostrRelayAdapter("ws://relay.example.com");

      await expect(
        adapter.subscribe({ kinds: [0] }, () => {})
      ).rejects.toThrow(/Relay configuration error/);

      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it("refuses http and credentialed relay URLs too", async () => {
      for (const url of [
        "http://relay.example.com",
        "wss://user:pass@relay.example.com",
      ]) {
        const adapter = new NostrRelayAdapter(url);
        await expect(
          adapter.subscribe({ kinds: [0] }, () => {})
        ).rejects.toThrow(/Relay configuration error/);
      }

      expect(MockWebSocket.instances).toHaveLength(0);
    });
  });

  describe("frame and envelope validation", () => {
    it("discards an oversized frame without parsing it", async () => {
      const { socket, events } = await connectedAdapter();
      const parse = vi.spyOn(JSON, "parse");

      socket.deliver("x".repeat(RELAY_BOUNDS.MAX_FRAME_BYTES + 1));

      expect(parse).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
      parse.mockRestore();
    });

    it("discards frames whose envelope fails the schema", async () => {
      const { socket, subId, events, eose } = await connectedAdapter();

      socket.deliver("{not json");
      socket.deliverMessage({ type: "EVENT" });
      socket.deliverMessage(["EVENT"]);
      socket.deliverMessage(["BOGUS", subId, genuineProfileEvent]);
      socket.deliverMessage(["EVENT", "has spaces", genuineProfileEvent]);
      socket.deliverMessage(["EOSE", "a".repeat(65)]);

      expect(events).toHaveLength(0);
      expect(eose()).toBe(0);
    });

    it("discards a non-object EVENT payload and leaves the subscription intact", async () => {
      const { socket, subId, events, eose, adapter } = await connectedAdapter();

      socket.deliverMessage(["EVENT", subId, null]);
      socket.deliverMessage(["EVENT", subId, "text"]);

      expect(events).toHaveLength(0);
      expect(eose()).toBe(0);
      expect(adapter.getActiveSubscriptionCount()).toBe(1);
    });

    it("discards an event that breaches the schema bounds", async () => {
      const { socket, subId, events } = await connectedAdapter();

      const oversized = clone(genuineProfileEvent);
      oversized.content = "x".repeat(RELAY_BOUNDS.MAX_EVENT_CONTENT_BYTES + 1);
      socket.deliverMessage(["EVENT", subId, oversized]);

      const uppercase = clone(genuineProfileEvent);
      uppercase.id = uppercase.id.toUpperCase();
      socket.deliverMessage(["EVENT", subId, uppercase]);

      expect(events).toHaveLength(0);
    });

    it("truncates relay NOTICE text and never logs the raw frame", async () => {
      const { socket } = await connectedAdapter();
      const notice = "N".repeat(1000);

      socket.deliverMessage(["NOTICE", notice]);

      const logged = warn.mock.calls.flat().join(" ");
      expect(logged).toContain("Relay notice:");
      expect(logged).not.toContain(notice);
      expect(logged).toContain("N".repeat(200));
      expect(logged).not.toContain("N".repeat(201));
    });
  });

  describe("event verification", () => {
    it("delivers a genuine event that matches the subscription filter", async () => {
      const { socket, subId, events } = await connectedAdapter();

      socket.deliverMessage(["EVENT", subId, genuineProfileEvent]);

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(genuineProfileEvent.id);
    });

    it("rejects an event whose author was not requested", async () => {
      const { socket, subId, events } = await connectedAdapter();

      // Validly signed, but by a different key than the filter asked for.
      const other = signEvent({
        created_at: Math.floor(Date.now() / 1000) - 60,
        kind: 0,
        tags: [],
        content: JSON.stringify({ name: "someone else" }),
      });
      socket.deliverMessage(["EVENT", subId, other]);

      expect(events).toHaveLength(0);
    });

    it("rejects an event whose kind was not requested", async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const seen: Nip01Event[] = [];
      const p = adapter.subscribe({ kinds: [0], authors: [TEST_PUBKEY] }, (e) =>
        seen.push(e as unknown as Nip01Event)
      );
      MockWebSocket.latest().open();
      const subId = await p;

      const wrongKind = signEvent({
        created_at: Math.floor(Date.now() / 1000) - 60,
        kind: 1,
        tags: [],
        content: "a note, not a profile",
      });
      MockWebSocket.latest().deliverMessage(["EVENT", subId, wrongKind]);

      expect(seen).toHaveLength(0);
    });

    it("rejects an event whose ID does not match its contents", async () => {
      const { socket, subId, events } = await connectedAdapter();

      const tampered = clone(genuineProfileEvent);
      tampered.content = JSON.stringify({ name: "attacker" });
      socket.deliverMessage(["EVENT", subId, tampered]);

      expect(events).toHaveLength(0);
    });

    it("rejects an event whose signature does not verify", async () => {
      const { socket, subId, events } = await connectedAdapter();

      const forged = clone(genuineProfileEvent);
      forged.content = JSON.stringify({
        name: "attacker",
        picture: "https://evil.example.com/beacon.png",
      });
      forged.id = NostrEventCrypto.computeEventId(forged);
      socket.deliverMessage(["EVENT", subId, forged]);

      expect(events).toHaveLength(0);
    });
  });

  describe("volume bounds", () => {
    it("accepts at most 20 events and then closes the subscription", async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const seen: Nip01Event[] = [];
      let eoseCount = 0;
      const p = adapter.subscribe(
        { kinds: [0], authors: [TEST_PUBKEY] },
        (e) => seen.push(e as unknown as Nip01Event),
        () => {
          eoseCount += 1;
        }
      );
      MockWebSocket.latest().open();
      const subId = await p;
      const socket = MockWebSocket.latest();

      const base = Math.floor(Date.now() / 1000) - 1000;
      for (let i = 0; i < RELAY_BOUNDS.MAX_EVENTS_PER_SUBSCRIPTION + 5; i++) {
        socket.deliverMessage([
          "EVENT",
          subId,
          signEvent({
            created_at: base + i,
            kind: 0,
            tags: [],
            content: JSON.stringify({ name: `profile ${i}` }),
          }),
        ]);
      }

      expect(seen).toHaveLength(RELAY_BOUNDS.MAX_EVENTS_PER_SUBSCRIPTION);
      expect(eoseCount).toBe(1);
      expect(adapter.getActiveSubscriptionCount()).toBe(0);
      expect(socket.sent.some((frame) => frame.includes('"CLOSE"'))).toBe(true);
    });
  });

  describe("subscription lifecycle", () => {
    it("closes and deregisters the subscription on EOSE", async () => {
      const { socket, subId, adapter, eose } = await connectedAdapter();

      expect(adapter.getActiveSubscriptionCount()).toBe(1);
      socket.deliverMessage(["EOSE", subId]);

      expect(eose()).toBe(1);
      expect(adapter.getActiveSubscriptionCount()).toBe(0);
      expect(socket.sent.some((frame) => frame.includes('"CLOSE"'))).toBe(true);
    });

    it("settles the subscription when the relay sends CLOSED", async () => {
      const { socket, subId, adapter, eose } = await connectedAdapter();

      socket.deliverMessage(["CLOSED", subId, "rate-limited"]);

      expect(eose()).toBe(1);
      expect(adapter.getActiveSubscriptionCount()).toBe(0);
    });

    it("ignores events for a subscription that already closed", async () => {
      const { socket, subId, events } = await connectedAdapter();

      socket.deliverMessage(["EOSE", subId]);
      socket.deliverMessage(["EVENT", subId, genuineProfileEvent]);

      expect(events).toHaveLength(0);
    });
  });

  describe("reconnection", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("gives up after 5 consecutive failures and settles dependent fetches", async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      let eoseCount = 0;
      const p = adapter.subscribe(
        { kinds: [0], authors: [TEST_PUBKEY] },
        () => {},
        () => {
          eoseCount += 1;
        }
      );
      MockWebSocket.latest().open();
      await p;

      const socketsBefore = MockWebSocket.instances.length;
      MockWebSocket.autoFail = true;
      MockWebSocket.latest().close();

      // 1s + 2s + 4s + 8s + 16s of backoff, plus jitter.
      await vi.advanceTimersByTimeAsync(120000);

      expect(adapter.hasAbandonedReconnection()).toBe(true);
      expect(MockWebSocket.instances.length - socketsBefore).toBe(
        RELAY_BOUNDS.MAX_RECONNECT_ATTEMPTS
      );
      expect(adapter.getActiveSubscriptionCount()).toBe(0);
      expect(eoseCount).toBe(1);

      // No further attempts once it has given up.
      const settled = MockWebSocket.instances.length;
      await vi.advanceTimersByTimeAsync(120000);
      expect(MockWebSocket.instances.length).toBe(settled);
    });

    it("does not reconnect when it holds no subscriptions", async () => {
      const { adapter, socket, subId } = await connectedAdapter();
      socket.deliverMessage(["EOSE", subId]);
      expect(adapter.getActiveSubscriptionCount()).toBe(0);

      const before = MockWebSocket.instances.length;
      MockWebSocket.autoFail = true;
      socket.close();
      await vi.advanceTimersByTimeAsync(120000);

      expect(MockWebSocket.instances.length).toBe(before);
      expect(adapter.hasAbandonedReconnection()).toBe(false);
    });

    it("resets the attempt counter after a successful reconnect", async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const p = adapter.subscribe({ kinds: [0], authors: [TEST_PUBKEY] }, () => {});
      MockWebSocket.latest().open();
      const subId = await p;

      // Two failures, then a success.
      MockWebSocket.autoFail = true;
      MockWebSocket.latest().close();
      await vi.advanceTimersByTimeAsync(6000);

      MockWebSocket.autoFail = false;
      await vi.advanceTimersByTimeAsync(6000);
      MockWebSocket.latest().open();
      await vi.advanceTimersByTimeAsync(10);

      expect(adapter.hasAbandonedReconnection()).toBe(false);
      // The live subscription is re-established on the new socket.
      expect(
        MockWebSocket.latest().sent.some(
          (frame) => frame.includes('"REQ"') && frame.includes(subId)
        )
      ).toBe(true);

      // The counter is back to zero: another five attempts are available.
      const before = MockWebSocket.instances.length;
      MockWebSocket.autoFail = true;
      MockWebSocket.latest().close();
      await vi.advanceTimersByTimeAsync(120000);
      expect(MockWebSocket.instances.length - before).toBe(
        RELAY_BOUNDS.MAX_RECONNECT_ATTEMPTS
      );
    });
  });
});

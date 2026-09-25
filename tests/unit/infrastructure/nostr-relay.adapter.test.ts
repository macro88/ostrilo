import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { NostrRelayAdapter } from "@/infrastructure/relay/nostr-relay.adapter";
import { RELAY_BOUNDS } from "@/domain/relay";
import type { NostrEvent } from "@/application/ports/relay";
import {
  FakeWebSocket,
  TEST_NOTE_FILTER as FILTER,
  signedNote,
} from "../../helpers/relay-fakes";

const RELAY_URL = "wss://relay.test.example";

interface Harness {
  adapter: NostrRelayAdapter;
  socket: FakeWebSocket;
  subId: string;
  received: NostrEvent[];
  eoseCount: () => number;
}

async function subscribed(
  onEvent?: (event: NostrEvent) => void,
  onEOSE?: () => void
): Promise<Harness> {
  const adapter = new NostrRelayAdapter(RELAY_URL);
  const received: NostrEvent[] = [];
  let eose = 0;
  const pending = adapter.subscribe(
    FILTER,
    (event) => {
      received.push(event);
      onEvent?.(event);
    },
    () => {
      eose += 1;
      onEOSE?.();
    }
  );
  FakeWebSocket.latest().open();
  const subId = await pending;
  return {
    adapter,
    socket: FakeWebSocket.latest(),
    subId,
    received,
    eoseCount: () => eose,
  };
}

async function connectedForPublish(): Promise<{
  adapter: NostrRelayAdapter;
  socket: FakeWebSocket;
}> {
  const { adapter, socket, subId } = await subscribed();
  await adapter.close(subId);
  return { adapter, socket };
}

describe("NostrRelayAdapter", () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.reset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("connection", () => {
    it("sends a REQ frame carrying the subscription ID and filter", async () => {
      const { socket, subId } = await subscribed();

      expect(socket.url).toBe(RELAY_URL);
      expect(socket.framesOfType("REQ")).toEqual([["REQ", subId, FILTER]]);
    });

    it("reuses an open socket for a second subscription", async () => {
      const { adapter, socket } = await subscribed();

      const second = await adapter.subscribe({ kinds: [0] }, () => {});

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(socket.framesOfType("REQ").map((frame) => frame[1])).toContain(
        second
      );
      expect(adapter.getActiveSubscriptionCount()).toBe(2);
    });

    it("lets a concurrent caller wait for the connection already in flight", async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const first = adapter.subscribe(FILTER, () => {});
      const second = adapter.subscribe({ kinds: [0] }, () => {});

      FakeWebSocket.latest().open();
      await vi.advanceTimersByTimeAsync(100);
      const ids = await Promise.all([first, second]);

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(
        FakeWebSocket.latest()
          .framesOfType("REQ")
          .map((frame) => frame[1])
      ).toEqual(ids);
    });

    it("fails the waiting caller when the in-flight connection errors", async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const first = adapter.subscribe(FILTER, () => {});
      const second = adapter.subscribe({ kinds: [0] }, () => {});
      const firstResult = first.catch((error: Error) => error.message);
      const secondResult = second.catch((error: Error) => error.message);

      FakeWebSocket.latest().fail();
      await vi.advanceTimersByTimeAsync(100);

      expect(await firstResult).toBe("WebSocket connection error");
      expect(await secondResult).toBe("Connection failed");
      expect(adapter.getActiveSubscriptionCount()).toBe(0);
    });

    it("times out a connection that never opens and closes the socket", async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const first = adapter.subscribe(FILTER, () => {});
      const second = adapter.subscribe({ kinds: [0] }, () => {});
      const firstResult = first.catch((error: Error) => error.message);
      const secondResult = second.catch((error: Error) => error.message);

      await vi.advanceTimersByTimeAsync(10_000);

      expect(await firstResult).toBe("Connection timeout");
      expect(await secondResult).toMatch(/^Connection (failed|timeout)$/);
      expect(FakeWebSocket.latest().closeCalls).toBe(1);
      expect(adapter.getActiveSubscriptionCount()).toBe(0);
    });

    it("rejects when the WebSocket constructor throws and can connect afterwards", async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      FakeWebSocket.constructError = new SyntaxError("bad url");

      await expect(adapter.subscribe(FILTER, () => {})).rejects.toThrow(
        "bad url"
      );

      FakeWebSocket.constructError = null;
      const pending = adapter.subscribe(FILTER, () => {});
      FakeWebSocket.latest().open();
      await expect(pending).resolves.toMatch(/.+/);
    });

    it("removes the subscription when the socket stops being open before REQ is sent", async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const pending = adapter.subscribe(FILTER, () => {});
      const socket = FakeWebSocket.latest();
      socket.open();
      socket.readyState = FakeWebSocket.CLOSING;

      await expect(pending).rejects.toThrow("Relay not connected");
      expect(adapter.getActiveSubscriptionCount()).toBe(0);
      expect(socket.sent).toEqual([]);
    });

    it("reports the URL it was constructed with", () => {
      expect(new NostrRelayAdapter(RELAY_URL).getRelayUrl()).toBe(RELAY_URL);
    });
  });

  describe("inbound frames", () => {
    it("discards a binary frame and keeps the subscription", async () => {
      const { socket, subId, received, adapter } = await subscribed();
      const bytes = new TextEncoder().encode(
        JSON.stringify(["EVENT", subId, signedNote("binary")])
      );

      socket.deliver(bytes.buffer);

      expect(received).toEqual([]);
      expect(adapter.getActiveSubscriptionCount()).toBe(1);
    });

    it("measures UTF-8 bytes, discarding a frame whose characters fit but bytes do not", async () => {
      const { socket } = await subscribed();
      const chars = RELAY_BOUNDS.MAX_FRAME_BYTES / 2;

      socket.deliverMessage(["NOTICE", "€".repeat(chars)]);
      socket.deliverMessage(["NOTICE", "a".repeat(chars)]);

      const logged = warn.mock.calls.map((call) => String(call[0]));
      expect(logged[0]).toMatch(/^Discarded oversized relay frame/);
      expect(logged[1]).toMatch(/^Relay notice: a{200}$/);
    });

    it("acknowledges an AUTH challenge without disturbing subscriptions", async () => {
      const { socket, subId, received, adapter } = await subscribed();

      socket.deliverMessage(["AUTH", "challenge-string"]);
      const note = signedNote("after auth");
      socket.deliverMessage(["EVENT", subId, note]);

      expect(received).toEqual([note]);
      expect(adapter.getActiveSubscriptionCount()).toBe(1);
      expect(socket.framesOfType("AUTH")).toEqual([]);
    });

    it("ignores EOSE for a subscription it does not hold", async () => {
      const { socket, adapter, eoseCount } = await subscribed();

      socket.deliverMessage(["EOSE", "unknown-sub"]);

      expect(socket.framesOfType("CLOSE")).toEqual([]);
      expect(eoseCount()).toBe(0);
      expect(adapter.getActiveSubscriptionCount()).toBe(1);
    });
  });

  describe("subscription callbacks", () => {
    it("keeps delivering after an event handler throws", async () => {
      let calls = 0;
      const { socket, subId, received } = await subscribed(() => {
        calls += 1;
        if (calls === 1) throw new Error("handler broke");
        if (calls === 2) throw "not an error object";
      });
      const notes = [signedNote("a", 1), signedNote("b", 2), signedNote("c", 3)];

      for (const note of notes) socket.deliverMessage(["EVENT", subId, note]);

      expect(received).toEqual(notes);
    });

    it("deregisters and sends CLOSE even when the EOSE handler throws", async () => {
      const { socket, subId, adapter, eoseCount } = await subscribed(
        undefined,
        () => {
          throw new Error("eose broke");
        }
      );

      socket.deliverMessage(["EOSE", subId]);

      expect(eoseCount()).toBe(1);
      expect(adapter.getActiveSubscriptionCount()).toBe(0);
      expect(socket.framesOfType("CLOSE")).toEqual([["CLOSE", subId]]);
    });

    it("tolerates a non-Error thrown from the EOSE handler", async () => {
      const { socket, subId, adapter } = await subscribed(undefined, () => {
        throw "eose string";
      });

      socket.deliverMessage(["EOSE", subId]);

      expect(adapter.getActiveSubscriptionCount()).toBe(0);
    });

    it("drops an event delivered re-entrantly once the cap is reached", async () => {
      const cap = RELAY_BOUNDS.MAX_EVENTS_PER_SUBSCRIPTION;
      const notes = Array.from({ length: cap + 1 }, (_, i) =>
        signedNote(`n${i}`, i)
      );
      const harness: { socket?: FakeWebSocket; subId?: string } = {};
      let count = 0;
      const { socket, subId, received } = await subscribed(() => {
        count += 1;
        if (count === cap) {
          harness.socket?.deliverMessage(["EVENT", harness.subId, notes[cap]]);
        }
      });
      harness.socket = socket;
      harness.subId = subId;

      for (const note of notes.slice(0, cap)) {
        socket.deliverMessage(["EVENT", subId, note]);
      }

      expect(received).toHaveLength(cap);
      expect(received).not.toContainEqual(notes[cap]);
    });

    it("closes a held subscription on request and sends CLOSE", async () => {
      const { adapter, socket, subId } = await subscribed();

      await adapter.close(subId);
      await adapter.close(subId);

      expect(adapter.getActiveSubscriptionCount()).toBe(0);
      expect(socket.framesOfType("CLOSE")).toEqual([["CLOSE", subId]]);
    });

    it("drops the local handler even when CLOSE cannot be sent", async () => {
      const { adapter, socket, subId } = await subscribed();
      socket.readyState = FakeWebSocket.CLOSED;

      await adapter.close(subId);

      expect(adapter.getActiveSubscriptionCount()).toBe(0);
      expect(socket.framesOfType("CLOSE")).toEqual([]);
    });
  });

  describe("publish", () => {
    it("sends the event and resolves when the relay accepts it", async () => {
      const { adapter, socket } = await connectedForPublish();
      const note = signedNote("publish me");

      const result = adapter.publish(note);
      await vi.advanceTimersByTimeAsync(0);
      socket.deliverMessage(["OK", note.id, true, ""]);

      await expect(result).resolves.toBeUndefined();
      expect(socket.framesOfType("EVENT")).toEqual([["EVENT", note]]);
    });

    it("rejects with the relay's bounded reason when it refuses the event", async () => {
      const { adapter, socket } = await connectedForPublish();
      const note = signedNote("refused");

      const result = adapter.publish(note);
      await vi.advanceTimersByTimeAsync(0);
      socket.deliverMessage(["OK", note.id, false, "blocked: spam"]);

      await expect(result).rejects.toThrow("Publish failed: blocked: spam");
    });

    it("ignores an OK for an event it did not publish", async () => {
      const { adapter, socket } = await connectedForPublish();
      const note = signedNote("mine");

      const result = adapter.publish(note);
      const outcome = result.then(
        () => "resolved",
        (error: Error) => error.message
      );
      await vi.advanceTimersByTimeAsync(0);
      socket.deliverMessage(["OK", "f".repeat(64), false, "not yours"]);
      await vi.advanceTimersByTimeAsync(0);
      socket.deliverMessage(["OK", note.id, true]);

      expect(await outcome).toBe("resolved");
    });

    it("times out after five seconds and ignores a late OK", async () => {
      const { adapter, socket } = await connectedForPublish();
      const note = signedNote("slow");

      const result = adapter.publish(note);
      const outcome = result.catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(5_000);
      socket.deliverMessage(["OK", note.id, true]);

      expect(await outcome).toBe("Publish timeout");
    });

    it("rejects without leaving a pending publish when the socket is not open", async () => {
      const { adapter, socket } = await connectedForPublish();
      const note = signedNote("closing");

      const result = adapter.publish(note);
      socket.readyState = FakeWebSocket.CLOSING;

      await expect(result).rejects.toThrow("Relay not connected");
      expect(socket.framesOfType("EVENT")).toEqual([]);
    });
  });

  describe("disconnect", () => {
    it("closes every subscription, rejects pending publishes and does not reconnect", async () => {
      const { adapter, socket, subId } = await subscribed();
      const other = await adapter.subscribe({ kinds: [0] }, () => {});
      const note = signedNote("pending");
      const publishResult = adapter
        .publish(note)
        .catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(0);

      await adapter.disconnect();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(await publishResult).toBe("Disconnected");
      expect(socket.framesOfType("CLOSE")).toEqual([
        ["CLOSE", subId],
        ["CLOSE", other],
      ]);
      expect(socket.closeCalls).toBe(1);
      expect(adapter.getActiveSubscriptionCount()).toBe(0);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it("cancels a scheduled reconnect", async () => {
      const { adapter, socket } = await subscribed();
      socket.close();

      await adapter.disconnect();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(adapter.hasAbandonedReconnection()).toBe(false);
    });

    it("is a no-op for an adapter that never connected", async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);

      await expect(adapter.disconnect()).resolves.toBeUndefined();
      expect(FakeWebSocket.instances).toHaveLength(0);
    });
  });

  describe("reconnection", () => {
    it("schedules one attempt per failure when a failed socket fires both error and close", async () => {
      const { socket } = await subscribed();
      FakeWebSocket.failOnConnect = true;

      socket.close();
      await vi.advanceTimersByTimeAsync(1_200);
      expect(FakeWebSocket.instances).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(1_200);
      expect(FakeWebSocket.instances).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(1_300);
      expect(FakeWebSocket.instances).toHaveLength(3);
    });

    it("backs off exponentially within the jitter band", async () => {
      vi.spyOn(Math, "random").mockReturnValue(1);
      const { socket } = await subscribed();
      FakeWebSocket.failOnConnect = true;
      socket.close();

      const attemptTimes: number[] = [];
      for (let t = 0; t <= 40_000; t += 100) {
        const before = FakeWebSocket.instances.length;
        await vi.advanceTimersByTimeAsync(100);
        if (FakeWebSocket.instances.length > before) attemptTimes.push(t + 100);
      }

      expect(attemptTimes).toEqual([1_200, 3_600, 8_400, 18_000, 37_200]);
    });

    it("retries after a constructor failure that is not an Error", async () => {
      const { socket, adapter } = await subscribed();
      FakeWebSocket.constructError = "boom";

      socket.close();
      await vi.advanceTimersByTimeAsync(1_200);
      FakeWebSocket.constructError = null;
      await vi.advanceTimersByTimeAsync(2_400);
      FakeWebSocket.latest().open();
      await vi.advanceTimersByTimeAsync(0);

      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(adapter.hasAbandonedReconnection()).toBe(false);
      expect(adapter.getActiveSubscriptionCount()).toBe(1);
    });

    it("settles every orphaned subscription when giving up, even if one EOSE handler throws", async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const settled: string[] = [];
      const first = adapter.subscribe(
        FILTER,
        () => {},
        () => {
          settled.push("first");
          throw new Error("eose broke");
        }
      );
      FakeWebSocket.latest().open();
      await first;
      await adapter.subscribe({ kinds: [0] }, () => {}, () => {
        settled.push("second");
      });
      await adapter.subscribe({ kinds: [3] }, () => {}, () => {
        settled.push("third");
        throw "not an error";
      });

      FakeWebSocket.failOnConnect = true;
      FakeWebSocket.latest().close();
      await vi.advanceTimersByTimeAsync(120_000);

      expect(adapter.hasAbandonedReconnection()).toBe(true);
      expect(settled).toEqual(["first", "second", "third"]);
      expect(adapter.getActiveSubscriptionCount()).toBe(0);
    });

    it("clears the abandoned flag once a later connection opens", async () => {
      const { adapter, socket } = await subscribed();
      FakeWebSocket.failOnConnect = true;
      socket.close();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(adapter.hasAbandonedReconnection()).toBe(true);

      FakeWebSocket.failOnConnect = false;
      const pending = adapter.subscribe(FILTER, () => {});
      FakeWebSocket.latest().open();
      await pending;

      expect(adapter.hasAbandonedReconnection()).toBe(false);
    });
  });
});

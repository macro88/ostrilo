import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { RelayManager } from "@/infrastructure/relay/relay-manager";
import type { NostrEvent } from "@/application/ports/relay";
import {
  FakeWebSocket,
  TEST_NOTE_FILTER as FILTER,
  signedNote,
  socketFor,
} from "../../helpers/relay-fakes";

const RELAY_A = "wss://a.relay.example";
const RELAY_B = "wss://b.relay.example";

function openAll(): void {
  for (const socket of FakeWebSocket.instances) {
    if (socket.readyState === FakeWebSocket.CONNECTING) socket.open();
  }
}

function reqId(url: string): string {
  return String(socketFor(url).framesOfType("REQ")[0][1]);
}

async function subscribedOnBoth(withEose: boolean) {
  const manager = new RelayManager([RELAY_A, RELAY_B]);
  const received: NostrEvent[] = [];
  let eose = 0;
  const pending = manager.subscribe(
    FILTER,
    (event) => received.push(event),
    withEose
      ? () => {
          eose += 1;
        }
      : undefined
  );
  openAll();
  const compositeId = await pending;
  return { manager, compositeId, received, eoseCount: () => eose };
}

describe("RelayManager over real relay adapters", () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    FakeWebSocket.reset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("subscribe", () => {
    it("signals EOSE immediately and opens nothing when no relays are configured", async () => {
      const manager = new RelayManager([]);
      let eose = 0;

      const subId = await manager.subscribe(FILTER, () => {}, () => {
        eose += 1;
      });

      expect(subId).toBe("");
      expect(eose).toBe(1);
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it("returns an empty ID without EOSE callback when no relays are configured", async () => {
      await expect(new RelayManager([]).subscribe(FILTER, () => {})).resolves.toBe(
        ""
      );
    });

    it("returns the per-relay subscription IDs in relay order", async () => {
      const { compositeId } = await subscribedOnBoth(true);

      expect(compositeId).toBe(`${reqId(RELAY_A)},${reqId(RELAY_B)}`);
    });

    it("delivers an event seen on two relays exactly once", async () => {
      const { received } = await subscribedOnBoth(false);
      const note = signedNote("duplicated");
      const other = signedNote("unique", 5);

      socketFor(RELAY_A).deliverMessage(["EVENT", reqId(RELAY_A), note]);
      socketFor(RELAY_B).deliverMessage(["EVENT", reqId(RELAY_B), note]);
      socketFor(RELAY_B).deliverMessage(["EVENT", reqId(RELAY_B), other]);

      expect(received).toEqual([note, other]);
    });

    it("signals EOSE once, after every relay has finished", async () => {
      const { eoseCount } = await subscribedOnBoth(true);

      socketFor(RELAY_A).deliverMessage(["EOSE", reqId(RELAY_A)]);
      expect(eoseCount()).toBe(0);

      socketFor(RELAY_B).deliverMessage(["EOSE", reqId(RELAY_B)]);
      expect(eoseCount()).toBe(1);
    });

    it("waits only for the relays that accepted the subscription", async () => {
      const manager = new RelayManager([RELAY_A, RELAY_B]);
      let eose = 0;
      const pending = manager.subscribe(FILTER, () => {}, () => {
        eose += 1;
      });
      socketFor(RELAY_A).open();
      socketFor(RELAY_B).fail();
      const compositeId = await pending;

      expect(compositeId).toBe(`${reqId(RELAY_A)},`);
      expect(eose).toBe(0);

      socketFor(RELAY_A).deliverMessage(["EOSE", reqId(RELAY_A)]);
      expect(eose).toBe(1);
    });

    it("names every failure reason, including non-Error ones, when all relays fail", async () => {
      FakeWebSocket.constructError = "socket refused";
      const manager = new RelayManager([RELAY_A, RELAY_B]);

      const subId = await manager.subscribe(FILTER, () => {});

      expect(subId).toBe(",");
      const logged = warn.mock.calls.map((call) => String(call[0]));
      expect(logged).toContain(
        "Relay subscription failed on all relays: socket refused, socket refused"
      );
    });
  });

  describe("subscribeOn", () => {
    it("reports an unknown failure and still signals EOSE when the relay throws a non-Error", async () => {
      FakeWebSocket.constructError = 42;
      const manager = new RelayManager([RELAY_A, RELAY_B]);
      let eose = 0;

      const subId = await manager.subscribeOn(RELAY_B, FILTER, () => {}, () => {
        eose += 1;
      });

      expect(subId).toBe(",");
      expect(eose).toBe(1);
      expect(warn.mock.calls.map((call) => String(call[0]))).toContain(
        `Relay subscription failed on ${RELAY_B}: unknown error`
      );
    });
  });

  describe("publish", () => {
    async function publishing(note: NostrEvent) {
      const manager = new RelayManager([RELAY_A, RELAY_B]);
      const outcome = manager.publish(note).then(
        () => "published",
        (error: Error) => error.message
      );
      openAll();
      await vi.waitFor(() => {
        expect(socketFor(RELAY_A).framesOfType("EVENT")).toHaveLength(1);
        expect(socketFor(RELAY_B).framesOfType("EVENT")).toHaveLength(1);
      });
      return { outcome };
    }

    it("succeeds when every relay accepts the event", async () => {
      const note = signedNote("to all");
      const { outcome } = await publishing(note);

      socketFor(RELAY_A).deliverMessage(["OK", note.id, true]);
      socketFor(RELAY_B).deliverMessage(["OK", note.id, true]);

      expect(await outcome).toBe("published");
      expect(socketFor(RELAY_A).framesOfType("EVENT")).toEqual([["EVENT", note]]);
    });

    it("succeeds when at least one relay accepts, and reports the partial failure", async () => {
      const note = signedNote("partial");
      const { outcome } = await publishing(note);

      socketFor(RELAY_A).deliverMessage(["OK", note.id, false, "rate-limited"]);
      socketFor(RELAY_B).deliverMessage(["OK", note.id, true]);

      expect(await outcome).toBe("published");
      expect(warn.mock.calls.map((call) => String(call[0]))).toContain(
        "Publish succeeded on 1/2 relays"
      );
    });

    it("fails with every relay's reason when none accepts", async () => {
      const note = signedNote("rejected");
      const { outcome } = await publishing(note);

      socketFor(RELAY_A).deliverMessage(["OK", note.id, false, "blocked"]);
      socketFor(RELAY_B).deliverMessage(["OK", note.id, false, "invalid"]);

      expect(await outcome).toBe(
        "Publish failed on all relays: Publish failed: blocked, Publish failed: invalid"
      );
    });

    it("fails when there are no relays to publish to", async () => {
      await expect(
        new RelayManager([]).publish(signedNote("nowhere"))
      ).rejects.toThrow("Publish failed on all relays: ");
    });
  });

  describe("close", () => {
    it("closes each relay's subscription by position", async () => {
      const { manager, compositeId } = await subscribedOnBoth(true);

      await manager.close(compositeId);

      expect(socketFor(RELAY_A).framesOfType("CLOSE")).toEqual([
        ["CLOSE", reqId(RELAY_A)],
      ]);
      expect(socketFor(RELAY_B).framesOfType("CLOSE")).toEqual([
        ["CLOSE", reqId(RELAY_B)],
      ]);
    });

    it("closes the positions it was given when the ID count does not match", async () => {
      const { manager } = await subscribedOnBoth(true);

      await manager.close(reqId(RELAY_A));

      expect(socketFor(RELAY_A).framesOfType("CLOSE")).toHaveLength(1);
      expect(socketFor(RELAY_B).framesOfType("CLOSE")).toEqual([]);
      expect(warn.mock.calls.map((call) => String(call[0]))).toContain(
        "Subscription ID count mismatch: expected 2, got 1"
      );
    });
  });

  describe("setRelayUrls", () => {
    // The background calls this on every local settings write, a theme change
    // included. Only a different relay list may touch a socket.
    it("leaves open sockets and subscriptions alone when the relay list is unchanged", async () => {
      const { manager, received } = await subscribedOnBoth(true);
      const sockets = [socketFor(RELAY_A), socketFor(RELAY_B)];

      await manager.setRelayUrls([RELAY_A, RELAY_B]);

      expect(sockets.map((socket) => socket.closeCalls)).toEqual([0, 0]);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(manager.getRelayUrls()).toEqual([RELAY_A, RELAY_B]);

      socketFor(RELAY_A).deliverMessage([
        "EVENT",
        reqId(RELAY_A),
        signedNote("still subscribed"),
      ]);
      expect(received.map((event) => event.content)).toEqual([
        "still subscribed",
      ]);
    });

    it("treats a list that sanitizes to the current one as unchanged", async () => {
      const { manager } = await subscribedOnBoth(true);

      await manager.setRelayUrls([RELAY_A, ` ${RELAY_B} `, RELAY_A]);

      expect(socketFor(RELAY_A).closeCalls).toBe(0);
      expect(socketFor(RELAY_B).closeCalls).toBe(0);
    });

    it("closes the old sockets and adopts the new list when a relay is removed", async () => {
      const { manager } = await subscribedOnBoth(true);
      const [oldA, oldB] = [socketFor(RELAY_A), socketFor(RELAY_B)];

      await manager.setRelayUrls([RELAY_A]);

      expect(oldA.closeCalls).toBe(1);
      expect(oldB.closeCalls).toBe(1);
      expect(manager.getRelayUrls()).toEqual([RELAY_A]);
    });

    it("rebuilds when a relay is added", async () => {
      const manager = new RelayManager([RELAY_A]);

      await manager.setRelayUrls([RELAY_A, RELAY_B]);

      expect(manager.getRelayUrls()).toEqual([RELAY_A, RELAY_B]);
    });
  });

  it("reports how many relays it manages", () => {
    expect(new RelayManager([RELAY_A, RELAY_B]).getRelayCount()).toBe(2);
  });
});

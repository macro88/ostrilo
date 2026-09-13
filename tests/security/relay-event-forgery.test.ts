import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProfileService } from "@/application/services/profile.service";
import { RelayManager } from "@/infrastructure/relay/relay-manager";
import type { StoragePort, StorageSuite } from "@/application/ports/storage";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import { computeEventId } from "@/domain/utils/crypto";
import { loadNip01Vectors, type Nip01Event } from "../vectors/load";

/**
 * A hostile relay cannot rewrite the identity the user is about to sign with.
 *
 * This exercises the real composition - ProfileService over RelayManager over
 * NostrRelayAdapter over a WebSocket - because the defence is only worth
 * anything if it holds on the path the extension actually uses. The relay is
 * played by a fake socket that answers a kind:0 request for the user's own
 * pubkey with an attacker-chosen name and picture.
 *
 * The genuine event is a third-party-signed NIP-01 vector, so the positive
 * control proves the pipeline works rather than proving that Ostrilo agrees
 * with itself.
 */

type Listener = ((event: any) => void) | null;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: Listener = null;
  onerror: Listener = null;
  onmessage: Listener = null;
  onclose: Listener = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    // A relay accepts the connection immediately; the hostility is in what it
    // sends afterwards.
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({});
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

class MemoryStorage implements StoragePort {
  readonly store = new Map<string, any>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key);
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

async function waitFor(
  predicate: () => boolean,
  what: string,
  timeoutMs = 2000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

const vectors = loadNip01Vectors();
const GENUINE = vectors.find((vector) => vector.event.kind === 0)!.event;
const VICTIM_PUBKEY = GENUINE.pubkey;

/**
 * A kind:0 event claiming the victim's pubkey, carrying an attacker-chosen name
 * and picture. The ID is recomputed so it is internally consistent: the only
 * thing wrong with it is that no one holding the victim's key ever signed it.
 */
function forgedProfileEvent(): Nip01Event {
  const forged: Nip01Event = {
    ...structuredClone(GENUINE),
    content: JSON.stringify({
      name: "Ostrilo Support",
      display_name: "Ostrilo Support",
      picture: "https://tracker.attacker.example/beacon.png",
      about: "Send your seed phrase here to recover your account",
    }),
  };
  forged.id = computeEventId(
    forged.pubkey,
    forged.created_at,
    forged.kind,
    forged.tags,
    forged.content
  );
  return forged;
}

describe("Forged relay profile events", () => {
  let storage: StorageSuite;
  let session: MemoryStorage;
  let local: MemoryStorage;
  let relayManager: RelayManager;
  let service: ProfileService;

  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket;

    local = new MemoryStorage();
    session = new MemoryStorage();
    storage = { local, sync: new MemoryStorage(), session };

    relayManager = new RelayManager(["wss://hostile-relay.example.com"]);
    service = new ProfileService(storage, relayManager, {
      listKeys: vi.fn(),
    } as unknown as KeyVaultService);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await relayManager.disconnect();
    vi.restoreAllMocks();
    delete (globalThis as any).WebSocket;
  });

  /** Run a profile fetch while the fake relay answers with `event`. */
  async function fetchWithRelayAnswer(
    event: Nip01Event | null,
    forceFetch = false
  ) {
    const pending = service.getProfile(VICTIM_PUBKEY, forceFetch);

    await waitFor(
      () => MockWebSocket.instances.length > 0,
      "the adapter to open a socket"
    );
    const socket = MockWebSocket.instances[0];

    await waitFor(
      () => socket.sent.some((frame) => frame.startsWith('["REQ"')),
      "the REQ frame"
    );
    const req = JSON.parse(
      socket.sent.find((frame) => frame.startsWith('["REQ"'))!
    ) as [string, string, unknown];
    const subId = req[1];

    if (event) {
      socket.deliver(["EVENT", subId, event]);
    }
    socket.deliver(["EOSE", subId]);

    return { result: await pending, socket, subId };
  }

  it("accepts a genuine third-party-signed profile event", async () => {
    const { result } = await fetchWithRelayAnswer(GENUINE);

    expect(result).not.toBeNull();
    expect(session.store.get("profileCache")?.[VICTIM_PUBKEY]).toBeDefined();
  });

  it("discards a forged profile event for the user's own pubkey", async () => {
    const { result } = await fetchWithRelayAnswer(forgedProfileEvent());

    expect(result).toBeNull();
    expect(session.store.get("profileCache")).toBeUndefined();
  });

  it("leaves the already-known identity untouched when a forgery arrives", async () => {
    // The user already has a verified profile for this key.
    const now = Math.floor(Date.now() / 1000);
    await session.set("profileCache", {
      [VICTIM_PUBKEY]: {
        pubkey: VICTIM_PUBKEY,
        metadata: { name: "My real name", picture: "https://cdn.example.com/me.png" },
        fetchedAt: now,
        ttl: 3600,
      },
    });

    // An explicit refresh goes to the relay, which answers with the forgery.
    const { result } = await fetchWithRelayAnswer(forgedProfileEvent(), true);

    expect(result).toBeNull();

    const cached = session.store.get("profileCache")[VICTIM_PUBKEY];
    expect(cached.metadata).toEqual({
      name: "My real name",
      picture: "https://cdn.example.com/me.png",
    });

    // The name the key selector would show is unchanged.
    const displayed = await service.getProfile(VICTIM_PUBKEY);
    expect(displayed?.name).toBe("My real name");
    expect(displayed?.picture).toBe("https://cdn.example.com/me.png");
  });

  it("discards an event for a pubkey the extension did not ask about", async () => {
    const other = structuredClone(GENUINE);
    other.pubkey = "b".repeat(64);

    const { result } = await fetchWithRelayAnswer(other);

    expect(result).toBeNull();
    expect(session.store.get("profileCache")).toBeUndefined();
  });

  it("settles the fetch when the relay answers with a null event payload", async () => {
    const pending = service.getProfile(VICTIM_PUBKEY);

    await waitFor(
      () => MockWebSocket.instances.length > 0,
      "the adapter to open a socket"
    );
    const socket = MockWebSocket.instances[0];
    await waitFor(
      () => socket.sent.some((frame) => frame.startsWith('["REQ"')),
      "the REQ frame"
    );
    const subId = (
      JSON.parse(
        socket.sent.find((frame) => frame.startsWith('["REQ"'))!
      ) as [string, string]
    )[1];

    // The payload that previously threw a TypeError out of the EOSE callback
    // and left getProfile awaiting forever.
    socket.deliver(["EVENT", subId, null]);
    socket.deliver(["EOSE", subId]);

    await expect(pending).resolves.toBeNull();
  });
});

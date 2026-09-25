import { schnorr } from "@noble/curves/secp256k1.js";
import { NostrEventCrypto } from "@/infrastructure/crypto/adapters";
import { bytesToHex, hexToBytes } from "@/domain/utils/hex";
import type { NostrEvent } from "@/application/ports/relay";

type Handler = ((event: { data?: unknown }) => void) | null;

export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];
  static failOnConnect = false;
  static constructError: unknown = null;

  readyState = FakeWebSocket.CONNECTING;
  sent: unknown[][] = [];
  closeCalls = 0;

  onopen: Handler = null;
  onerror: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;

  constructor(readonly url: string) {
    if (FakeWebSocket.constructError !== null) {
      throw FakeWebSocket.constructError;
    }
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.failOnConnect) {
      queueMicrotask(() => this.fail());
    }
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  fail(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onerror?.({});
    this.onclose?.({});
  }

  deliver(data: unknown): void {
    this.onmessage?.({ data });
  }

  deliverMessage(message: unknown): void {
    this.deliver(JSON.stringify(message));
  }

  framesOfType(type: string): unknown[][] {
    return this.sent.filter((frame) => frame[0] === type);
  }

  static latest(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  static reset(): void {
    FakeWebSocket.instances = [];
    FakeWebSocket.failOnConnect = false;
    FakeWebSocket.constructError = null;
  }
}

export function socketFor(url: string): FakeWebSocket {
  const matches = FakeWebSocket.instances.filter((socket) => socket.url === url);
  return matches[matches.length - 1];
}

const SECRET = new Uint8Array(32).fill(9);
export const TEST_RELAY_PUBKEY = bytesToHex(schnorr.getPublicKey(SECRET));
export const TEST_NOTE_FILTER = { kinds: [1], authors: [TEST_RELAY_PUBKEY] };

export function signedNote(content: string, offset = 0): NostrEvent {
  const fields = {
    pubkey: TEST_RELAY_PUBKEY,
    created_at: Math.floor(Date.now() / 1000) - 60 - offset,
    kind: 1,
    tags: [],
    content,
  };
  const id = NostrEventCrypto.computeEventId(fields);
  return {
    ...fields,
    id,
    sig: bytesToHex(schnorr.sign(hexToBytes(id), SECRET)),
  };
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { ensureDevCertificate } from "./make-dev-cert";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const REJECT_REASON = "blocked: fixture relay refused this event";

export interface SignedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface RelayFilter {
  authors?: string[];
  kinds?: number[];
}

/** One client frame, or null while the buffer still holds a partial frame. */
function readFrame(
  buffer: Buffer
): { opcode: number; payload: Buffer; rest: Buffer } | null {
  if (buffer.length < 2) return null;

  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  let mask: Buffer | null = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + length) return null;

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] ^= mask[i % 4];
    }
  }

  return { opcode, payload, rest: buffer.subarray(offset + length) };
}

/** A server-to-client text frame. Server frames are never masked. */
function sendText(socket: Duplex, text: string): void {
  const payload = Buffer.from(text, "utf8");
  let header: Buffer;

  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

/**
 * A NIP-01 relay, in this process, over `wss:`.
 *
 * It exists so a publish can be asserted end to end without a live relay. It
 * speaks only what the extension speaks - EVENT/OK, REQ/EVENT/EOSE - and it
 * stores the last kind:0 per author so a forced refetch gets back exactly what
 * was published. `accepts: false` answers `OK false`, which is a relay refusing
 * an event rather than a network that is down.
 *
 * `wss:` is not optional here: the manifest CSP allows `wss:` and the relay URL
 * validator refuses anything else, so a plaintext `ws://` fixture would be
 * rejected by the code under test before a byte moved.
 */
export class FixtureRelay {
  /** Every event the extension published, accepted or not. */
  readonly received: SignedEvent[] = [];
  /** Every REQ filter the extension subscribed with. */
  readonly requested: RelayFilter[] = [];

  private readonly accepts: boolean;
  private readonly sockets = new Set<Duplex>();
  private readonly stored = new Map<string, SignedEvent>();
  private server: Server | null = null;
  private port = 0;

  constructor(options: { accepts: boolean }) {
    this.accepts = options.accepts;
  }

  get url(): string {
    if (!this.port) throw new Error("FixtureRelay is not listening");
    return `wss://localhost:${this.port}`;
  }

  async start(): Promise<void> {
    const { cert, key } = ensureDevCertificate();
    const server = createServer({
      cert: readFileSync(cert),
      key: readFileSync(key),
    });

    server.on("upgrade", (request, socket) => {
      this.accept(request.headers["sec-websocket-key"], socket);
    });

    // Port 0, and no host: an ephemeral port cannot collide with a concurrent
    // spec, and binding every interface keeps `localhost` working whether the
    // browser resolves it to ::1 or 127.0.0.1.
    await new Promise<void>((resolve) => server.listen(0, resolve));
    this.port = (server.address() as AddressInfo).port;
    this.server = server;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();

    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private accept(key: string | undefined, socket: Duplex): void {
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = createHash("sha1")
      .update(`${key}${WS_GUID}`)
      .digest("base64");

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => {
      // The browser tears connections down abruptly; that is not a failure.
    });

    let pending: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);

      for (;;) {
        const frame = readFrame(pending);
        if (!frame) return;
        pending = frame.rest;

        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(Buffer.concat([Buffer.from([0x8a, 0]), Buffer.alloc(0)]));
          continue;
        }
        if (frame.opcode === 0x1) {
          this.handle(socket, frame.payload.toString("utf8"));
        }
      }
    });
  }

  private handle(socket: Duplex, text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(message)) return;

    if (message[0] === "EVENT") {
      const event = message[1] as SignedEvent;
      this.received.push(event);
      if (this.accepts) this.stored.set(event.pubkey, event);

      sendText(
        socket,
        JSON.stringify([
          "OK",
          event.id,
          this.accepts,
          this.accepts ? "" : REJECT_REASON,
        ])
      );
      return;
    }

    if (message[0] === "REQ") {
      const subId = message[1] as string;
      const filter = (message[2] ?? {}) as RelayFilter;
      this.requested.push(filter);

      for (const author of filter.authors ?? []) {
        const event = this.stored.get(author);
        if (event && (filter.kinds ?? [event.kind]).includes(event.kind)) {
          sendText(socket, JSON.stringify(["EVENT", subId, event]));
        }
      }

      sendText(socket, JSON.stringify(["EOSE", subId]));
    }
  }
}

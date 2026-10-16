import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";

import { ensureDevCertificate } from "./make-dev-cert";

export interface ImageRequest {
  path: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * An HTTPS image host in this process, over the throwaway localhost certificate.
 *
 * It answers like a host that wants its pictures reused, with
 * `Access-Control-Allow-Origin: *`, and 404s any path it was not given. It
 * records every request so a spec can say how many times the host was asked,
 * and with what headers.
 *
 * It does not model a host that blocks cross-origin reads. In the Chromium this
 * suite runs, an extension page whose manifest has https content-script
 * matches loaded an image from a host that sent no CORS headers and read it
 * back, so a spec cannot produce that failure from here; the tainted-canvas
 * path is covered where it can be forced, in the capture helper's unit tests.
 */
export class ImageHost {
  /** Every request the host received, in order. */
  readonly requests: ImageRequest[] = [];

  private server: Server | null = null;
  private port = 0;

  constructor(private readonly images: Record<string, Buffer>) {}

  get origin(): string {
    if (!this.port) throw new Error("ImageHost is not listening");
    return `https://localhost:${this.port}`;
  }

  url(path: string): string {
    return `${this.origin}${path}`;
  }

  async start(): Promise<void> {
    const { cert, key } = ensureDevCertificate();
    const server = createServer(
      { cert: readFileSync(cert), key: readFileSync(key) },
      (request, response) => {
        const path = new URL(request.url ?? "/", this.origin).pathname;
        this.requests.push({ path, headers: { ...request.headers } });

        const body = this.images[path];
        if (!body) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          "content-type": "image/png",
          "access-control-allow-origin": "*",
        });
        response.end(body);
      }
    );
    await new Promise<void>((resolve) => server.listen(0, resolve));
    this.port = (server.address() as AddressInfo).port;
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

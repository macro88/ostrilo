import { createHash } from "node:crypto";
import type { BrowserContext, Route } from "@playwright/test";

/**
 * A Blossom server (BUD-02) answered at the browser-context level.
 *
 * The extension's CSP only reaches the curated hosts, so a local fixture server
 * on another origin would be blocked by the very policy under test. Intercepting
 * a curated origin keeps the real CSP, the real CORS preflight, the real RPC and
 * the real dialog in play, and sends nothing to the network.
 */

export const BLOSSOM_HOST = "blossom.primal.net";
export const BLOSSOM_ORIGIN = `https://${BLOSSOM_HOST}`;

const CORS = { "access-control-allow-origin": "*" };

export interface ReceivedUpload {
  method: string;
  headers: Record<string, string>;
  body: Buffer;
  sha256: string;
}

export interface Reply {
  status: number;
  json?: unknown;
  headers?: Record<string, string>;
  text?: string;
}

export interface FakeBlossomOptions {
  /** Holds the reply to the `PUT` until this settles. */
  hold?: Promise<void>;
  /** Replaces the default `201` descriptor. */
  reply?: (upload: ReceivedUpload) => Reply;
  /**
   * Fails the `PUT` at the network layer, so `fetch` rejects. A browser rejects
   * the same way for a reply it may not read; Playwright's fulfilled responses
   * are not subject to CORS, so that case cannot be produced here, and CORS
   * against real servers was checked when the hosts were vetted.
   */
  abort?: boolean;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const sha256Hex = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

export class FakeBlossom {
  readonly uploads: ReceivedUpload[] = [];
  /** Every request that reached this host, as `METHOD /path`. */
  readonly requests: string[] = [];
  private readonly blobs = new Map<string, { bytes: Buffer; type: string }>();

  constructor(private readonly options: FakeBlossomOptions = {}) {}

  async attach(context: BrowserContext): Promise<void> {
    await context.route(`${BLOSSOM_ORIGIN}/**`, (route) => this.handle(route));
  }

  /** The address a real server would hand back for `upload`. */
  urlFor(upload: ReceivedUpload): string {
    const type = upload.headers["content-type"] ?? "image/png";
    return `${BLOSSOM_ORIGIN}/${upload.sha256}.${EXTENSIONS[type] ?? "bin"}`;
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const { pathname } = new URL(request.url());
    this.requests.push(`${request.method()} ${pathname}`);

    if (pathname === "/upload") {
      const body = request.postDataBuffer() ?? Buffer.alloc(0);
      const upload: ReceivedUpload = {
        method: request.method(),
        headers: request.headers(),
        body,
        sha256: sha256Hex(body),
      };
      this.uploads.push(upload);
      this.blobs.set(upload.sha256, {
        bytes: body,
        type: upload.headers["content-type"] ?? "image/png",
      });

      if (this.options.hold) await this.options.hold;
      if (this.options.abort) {
        await route.abort("failed");
        return;
      }

      const reply: Reply = this.options.reply?.(upload) ?? {
        status: 201,
        json: {
          url: this.urlFor(upload),
          sha256: upload.sha256,
          size: body.length,
          type: upload.headers["content-type"],
          uploaded: Math.floor(Date.now() / 1000),
        },
      };
      await route.fulfill({
        status: reply.status,
        headers: { ...CORS, ...reply.headers },
        contentType: "application/json",
        body: reply.json === undefined ? (reply.text ?? "") : JSON.stringify(reply.json),
      });
      return;
    }

    const served = this.blobs.get(pathname.slice(1).split(".")[0]);
    if (request.method() === "GET" && served) {
      await route.fulfill({
        status: 200,
        headers: CORS,
        contentType: served.type,
        body: served.bytes,
      });
      return;
    }
    await route.fulfill({ status: 404, headers: CORS, body: "" });
  }
}

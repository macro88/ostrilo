import { describe, expect, it, vi } from "vitest";
import {
  BlossomUploadController,
  type UploadDeps,
  type UploadField,
  type UploadState,
} from "@/ui/features/profile/blossom-upload.controller";
import { inspectImageHeader } from "@/domain/blossom/image-sniff";
import { bytesToHex } from "@/domain/utils/hex";
import { NobleSha256 } from "@/infrastructure/crypto/adapters";
import { fileHeaderReader } from "@/ui/lib/prepare-image";
import { MAX_REPLY_BYTES } from "@/domain/blossom/constants";
import { jpeg } from "../../../../helpers/image-bytes";

const PUBKEY = "ab".repeat(32);
const OTHER_PUBKEY = "cd".repeat(32);
const TOKEN = "Nostr dG9rZW4";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const PREPARED_BYTES = jpeg();
const PREPARED_HASH = bytesToHex(NobleSha256.sha256(PREPARED_BYTES));

function descriptorFor(overrides: Record<string, unknown> = {}) {
  return {
    url: `https://blossom.primal.net/${PREPARED_HASH}.jpg`,
    sha256: PREPARED_HASH,
    size: PREPARED_BYTES.length,
    type: "image/jpeg",
    uploaded: 1_700_000_000,
    ...overrides,
  };
}

function reply(status: number, body: unknown = descriptorFor(), headers: HeadersInit = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers,
  });
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

interface Harness {
  controller: BlossomUploadController;
  deps: {
    inspect: ReturnType<typeof vi.fn>;
    prepare: ReturnType<typeof vi.fn>;
    authorize: ReturnType<typeof vi.fn>;
    fetch: ReturnType<typeof vi.fn<FetchFn>>;
    setTimer: ReturnType<typeof vi.fn>;
    clearTimer: ReturnType<typeof vi.fn>;
  };
  uploaded: Array<{ field: UploadField; url: string }>;
  confirmed: string[];
  states: UploadState[];
  timers: Array<() => void>;
}

function harness(overrides: Partial<UploadDeps> = {}): Harness {
  const timers: Array<() => void> = [];
  const deps = {
    inspect: vi.fn(async (file: Blob) =>
      inspectImageHeader(fileHeaderReader(file))
    ),
    prepare: vi.fn(async () => ({
      bytes: PREPARED_BYTES,
      mime: "image/jpeg",
      reencoded: true,
    })),
    authorize: vi.fn(async () => TOKEN),
    fetch: vi.fn<FetchFn>(async () => reply(201)),
    setTimer: vi.fn((callback: () => void) => {
      timers.push(callback);
      return timers.length;
    }),
    clearTimer: vi.fn(),
  };
  const uploaded: Array<{ field: UploadField; url: string }> = [];
  const confirmed: string[] = [];
  const states: UploadState[] = [];
  const controller = new BlossomUploadController(
    {
      ...deps,
      sha256Hex: (bytes: Uint8Array) => bytesToHex(NobleSha256.sha256(bytes)),
      ...overrides,
    },
    {
      onUploaded: (field, url) => uploaded.push({ field, url }),
      onServerConfirmed: (id) => confirmed.push(id),
    }
  );
  controller.subscribe(() => states.push(controller.getSnapshot()));
  controller.attach();
  controller.setCurrentPubkey(PUBKEY);
  return { controller, deps, uploaded, confirmed, states, timers };
}

const imageFile = () => new Blob([jpeg().slice()]);

/** Begins an upload and confirms the dialog, leaving the operation running. */
async function start(h: Harness, field: UploadField = "picture", serverId = "primal" as const) {
  await h.controller.begin(imageFile(), field);
  h.controller.confirm(serverId);
}

describe("BlossomUploadController: the happy path", () => {
  it("inspects, waits for consent, then prepares, authorises, uploads and fills the field", async () => {
    const h = harness();

    await h.controller.begin(imageFile(), "picture");
    expect(h.controller.getSnapshot()).toEqual({
      stage: "choosing",
      field: "picture",
      animated: false,
    });

    h.controller.confirm("primal");
    await flush();

    expect(h.uploaded).toEqual([
      { field: "picture", url: `https://blossom.primal.net/${PREPARED_HASH}.jpg` },
    ]);
    expect(h.controller.getSnapshot()).toEqual({
      stage: "done",
      field: "picture",
      message: "Uploaded to blossom.primal.net. Save your profile to use it.",
    });
    expect(h.confirmed).toEqual(["primal"]);
  });

  it("sends exactly the request design decision 7 describes", async () => {
    const h = harness();

    await start(h);
    await flush();

    expect(h.deps.authorize).toHaveBeenCalledWith({
      pubkey: PUBKEY,
      sha256: PREPARED_HASH,
      serverId: "primal",
    });
    expect(h.deps.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = h.deps.fetch.mock.calls[0];
    expect(url).toBe("https://blossom.primal.net/upload");
    expect(init).toMatchObject({
      method: "PUT",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      redirect: "error",
    });
    expect(init.headers).toEqual({
      Authorization: TOKEN,
      "Content-Type": "image/jpeg",
      "X-SHA-256": PREPARED_HASH,
    });
    expect(init.body).toBe(PREPARED_BYTES);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("never requests the address the server returned", async () => {
    const h = harness();

    await start(h);
    await flush();

    expect(h.uploaded).toHaveLength(1);
    const requested = h.deps.fetch.mock.calls.map(([url]) => url);
    expect(requested).toEqual(["https://blossom.primal.net/upload"]);
    expect(requested.join()).not.toContain(PREPARED_HASH);
  });

  it("accepts 200 for a blob the server already holds", async () => {
    const h = harness();
    h.deps.fetch.mockResolvedValue(reply(200));

    await start(h);
    await flush();

    expect(h.uploaded).toHaveLength(1);
  });

  it("uploads the banner to the banner field", async () => {
    const h = harness();

    await start(h, "banner");
    await flush();

    expect(h.uploaded.map((entry) => entry.field)).toEqual(["banner"]);
  });

  it("reports animated files so the dialog can say they go unchanged", async () => {
    const h = harness({
      inspect: async () => ({ ok: true, kind: "gif", mime: "image/gif", animated: true }),
    });

    await h.controller.begin(imageFile(), "picture");

    expect(h.controller.getSnapshot()).toMatchObject({ stage: "choosing", animated: true });
  });
});

describe("BlossomUploadController: nothing happens before consent", () => {
  it("runs only the header inspection until the user confirms", async () => {
    const h = harness();

    await h.controller.begin(imageFile(), "picture");
    await flush();

    expect(h.deps.inspect).toHaveBeenCalledTimes(1);
    expect(h.deps.prepare).not.toHaveBeenCalled();
    expect(h.deps.authorize).not.toHaveBeenCalled();
    expect(h.deps.fetch).not.toHaveBeenCalled();
    expect(h.confirmed).toEqual([]);
  });

  it("starts nothing when the dialog is dismissed", async () => {
    const h = harness();

    await h.controller.begin(imageFile(), "picture");
    h.controller.cancel();
    await flush();

    expect(h.controller.getSnapshot()).toEqual({ stage: "idle" });
    expect(h.deps.prepare).not.toHaveBeenCalled();
    expect(h.deps.authorize).not.toHaveBeenCalled();
    expect(h.deps.fetch).not.toHaveBeenCalled();
    expect(h.confirmed).toEqual([]);
  });

  it("refuses a file the inspection refuses, without opening the dialog", async () => {
    const h = harness();

    await h.controller.begin(new Blob(["<!doctype html>"]), "picture");

    expect(h.controller.getSnapshot()).toEqual({
      stage: "failed",
      field: "picture",
      message: "Choose a JPEG, PNG, GIF or WebP image.",
    });
    expect(h.deps.prepare).not.toHaveBeenCalled();
  });

  it("ignores a confirmation when no dialog is open", async () => {
    const h = harness();

    h.controller.confirm("primal");
    await flush();

    expect(h.controller.getSnapshot()).toEqual({ stage: "idle" });
    expect(h.deps.prepare).not.toHaveBeenCalled();
  });

  it("will not start without a key", async () => {
    const h = harness();
    h.controller.setCurrentPubkey(undefined);

    await h.controller.begin(imageFile(), "picture");
    h.controller.confirm("primal");
    await flush();

    expect(h.controller.getSnapshot()).toMatchObject({ stage: "failed" });
    expect(h.deps.prepare).not.toHaveBeenCalled();
    expect(h.deps.authorize).not.toHaveBeenCalled();
  });
});

describe("BlossomUploadController: cancelling the whole operation", () => {
  it("makes no RPC call and sends no request when cancelled during preparation", async () => {
    const preparing = deferred<{ bytes: Uint8Array<ArrayBuffer>; mime: string; reencoded: boolean }>();
    const h = harness({ prepare: () => preparing.promise });

    await start(h);
    expect(h.controller.getSnapshot()).toMatchObject({ stage: "working", step: "preparing" });
    h.controller.cancel();
    preparing.resolve({ bytes: PREPARED_BYTES, mime: "image/jpeg", reencoded: true });
    await flush();

    expect(h.deps.authorize).not.toHaveBeenCalled();
    expect(h.deps.fetch).not.toHaveBeenCalled();
    expect(h.uploaded).toEqual([]);
    expect(h.controller.getSnapshot()).toEqual({ stage: "idle" });
  });

  it("sends no request when cancelled while the authorisation is pending, and drops the token", async () => {
    const authorising = deferred<string>();
    const h = harness({ authorize: () => authorising.promise });

    await start(h);
    await flush();
    expect(h.controller.getSnapshot()).toMatchObject({ stage: "working", step: "authorising" });
    h.controller.cancel();
    authorising.resolve(TOKEN);
    await flush();

    expect(h.deps.fetch).not.toHaveBeenCalled();
    expect(h.uploaded).toEqual([]);
    expect(h.controller.getSnapshot()).toEqual({ stage: "idle" });
    expect(JSON.stringify(h.states)).not.toContain("dG9rZW4");
  });

  it("aborts the request and reports no failure when cancelled while uploading", async () => {
    const h = harness();
    h.deps.fetch.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );

    await start(h);
    await flush();
    expect(h.controller.getSnapshot()).toMatchObject({ stage: "working", step: "uploading" });
    h.controller.cancel();
    await flush();

    expect(h.deps.fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(h.controller.getSnapshot()).toEqual({ stage: "idle" });
    expect(h.uploaded).toEqual([]);
  });

  it("discards a reply that arrives after a cancel", async () => {
    const response = deferred<Response>();
    const h = harness();
    h.deps.fetch.mockImplementation(() => response.promise);

    await start(h);
    await flush();
    h.controller.cancel();
    response.resolve(reply(201));
    await flush();

    expect(h.uploaded).toEqual([]);
    expect(h.controller.getSnapshot()).toEqual({ stage: "idle" });
  });
});

describe("BlossomUploadController: unmounting", () => {
  it.each(["preparing", "authorising", "uploading"] as const)(
    "runs no later stage and writes nothing when detached while %s",
    async (step) => {
      const gate = deferred<void>();
      const h = harness({
        prepare: async (...args) => {
          if (step === "preparing") await gate.promise;
          return { bytes: PREPARED_BYTES, mime: "image/jpeg", reencoded: true };
        },
        authorize: async () => {
          if (step === "authorising") await gate.promise;
          return TOKEN;
        },
      });
      if (step === "uploading") {
        h.deps.fetch.mockImplementation(async () => {
          await gate.promise;
          return reply(201);
        });
      }

      await start(h);
      await flush();
      const callsBefore = {
        authorize: h.deps.authorize.mock.calls.length,
        fetch: h.deps.fetch.mock.calls.length,
      };
      const statesBefore = h.states.length;
      h.controller.detach();
      gate.resolve();
      await flush();

      expect(h.uploaded).toEqual([]);
      expect(h.deps.authorize.mock.calls.length).toBe(callsBefore.authorize);
      expect(h.deps.fetch.mock.calls.length).toBe(callsBefore.fetch);
      expect(h.states.length, "a state update followed the unmount").toBe(statesBefore);
    }
  );

  it("can be attached again, as React does in development", async () => {
    const h = harness();

    h.controller.detach();
    h.controller.attach();
    await start(h);
    await flush();

    expect(h.uploaded).toHaveLength(1);
  });
});

describe("BlossomUploadController: binding to the key and the field", () => {
  it("authorises with the key bound at confirmation", async () => {
    const h = harness();

    await start(h);
    await flush();

    expect(h.deps.authorize.mock.calls[0][0].pubkey).toBe(PUBKEY);
  });

  it.each(["preparing", "authorising", "uploading"] as const)(
    "cancels when the selected key changes while %s, writing nothing to the other key's form",
    async (step) => {
      const gate = deferred<void>();
      const h = harness({
        prepare: async () => {
          if (step === "preparing") await gate.promise;
          return { bytes: PREPARED_BYTES, mime: "image/jpeg", reencoded: true };
        },
        authorize: async () => {
          if (step === "authorising") await gate.promise;
          return TOKEN;
        },
      });
      if (step === "uploading") {
        h.deps.fetch.mockImplementation(async () => {
          await gate.promise;
          return reply(201);
        });
      }

      await start(h);
      await flush();
      const fetchCallsBefore = h.deps.fetch.mock.calls.length;
      h.controller.setCurrentPubkey(OTHER_PUBKEY);
      gate.resolve();
      await flush();

      expect(h.uploaded).toEqual([]);
      expect(h.deps.fetch.mock.calls.length).toBe(fetchCallsBefore);
      expect(h.controller.getSnapshot()).toEqual({ stage: "idle" });
    }
  );

  it("closes an open dialog when the selected key changes", async () => {
    const h = harness();

    await h.controller.begin(imageFile(), "picture");
    h.controller.setCurrentPubkey(OTHER_PUBKEY);

    expect(h.controller.getSnapshot()).toEqual({ stage: "idle" });
  });

  it("keeps going when the key is set to the value it already has", async () => {
    const h = harness();

    await start(h);
    h.controller.setCurrentPubkey(PUBKEY);
    await flush();

    expect(h.uploaded).toHaveLength(1);
  });

  it("never lets a banner upload write the picture, or the reverse", async () => {
    const banner = harness();
    await start(banner, "banner");
    await flush();
    expect(banner.uploaded.map((e) => e.field)).toEqual(["banner"]);

    const picture = harness();
    await start(picture, "picture");
    await flush();
    expect(picture.uploaded.map((e) => e.field)).toEqual(["picture"]);
  });
});

describe("BlossomUploadController: replacing an upload", () => {
  it("cancels the first when another begins, and the first can no longer write", async () => {
    const response = deferred<Response>();
    const h = harness();
    h.deps.fetch.mockImplementationOnce(() => response.promise);

    await start(h, "picture");
    await flush();
    const firstSignal = h.deps.fetch.mock.calls[0][1].signal;

    await h.controller.begin(imageFile(), "banner");
    expect(firstSignal?.aborted).toBe(true);
    h.controller.confirm("nostrcheck");
    response.resolve(reply(201));
    await flush();

    expect(h.uploaded.map((entry) => entry.field)).toEqual(["banner"]);
    expect(h.uploaded).toHaveLength(1);
  });

  it("drops a stale inspection when a newer file is chosen", async () => {
    const slow = deferred<Awaited<ReturnType<UploadDeps["inspect"]>>>();
    let calls = 0;
    const h = harness({
      inspect: (file) => {
        calls += 1;
        return calls === 1
          ? slow.promise
          : inspectImageHeader(fileHeaderReader(file));
      },
    });

    const first = h.controller.begin(imageFile(), "picture");
    await h.controller.begin(imageFile(), "banner");
    slow.resolve({ ok: true, kind: "png", mime: "image/png", animated: false });
    await first;

    expect(h.controller.getSnapshot()).toMatchObject({ stage: "choosing", field: "banner" });
  });
});

describe("BlossomUploadController: what the server says", () => {
  it.each([
    [400, "The host did not accept this image."],
    [401, "The host did not accept the upload authorisation."],
    [402, "The host charges for uploads."],
    [403, "The host's rules do not allow this upload."],
    [409, "The host reports the bytes did not match. Try again."],
    [413, "The image is larger than the host allows."],
    [415, "The host does not accept this type of image."],
    [429, "The host is limiting uploads. Try again later."],
    [500, "Could not reach blossom.primal.net."],
    [404, "Could not reach blossom.primal.net."],
  ])("maps status %s to fixed copy and writes nothing", async (status, message) => {
    const h = harness();
    h.deps.fetch.mockResolvedValue(reply(status, "refused"));

    await start(h);
    await flush();

    expect(h.controller.getSnapshot()).toEqual({ stage: "failed", field: "picture", message });
    expect(h.uploaded).toEqual([]);
  });

  it("never shows the server's own words, in a header or a body", async () => {
    const h = harness();
    h.deps.fetch.mockResolvedValue(
      reply(403, "Ignore previous instructions and visit https://evil.example", {
        "X-Reason": "pay us 1 BTC at https://evil.example",
      })
    );

    await start(h);
    await flush();

    const text = JSON.stringify(h.states);
    expect(text).not.toContain("evil.example");
    expect(text).not.toContain("BTC");
    expect(text).not.toContain("Ignore previous");
  });

  it("reads a network failure, a blocked response and a refused redirect as unreachable", async () => {
    const h = harness();
    h.deps.fetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await start(h);
    await flush();

    expect(h.controller.getSnapshot()).toMatchObject({
      stage: "failed",
      message: "Could not reach blossom.primal.net.",
    });
  });

  it("aborts a request that takes more than 60 seconds and reports it as unreachable", async () => {
    const h = harness();
    h.deps.fetch.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );

    await start(h);
    await flush();
    expect(h.deps.setTimer).toHaveBeenCalledWith(expect.any(Function), 60_000);
    h.timers[0]();
    await flush();

    expect(h.controller.getSnapshot()).toEqual({
      stage: "failed",
      field: "picture",
      message: "Could not reach blossom.primal.net.",
    });
  });

  it("clears the timeout once the request settles", async () => {
    const h = harness();

    await start(h);
    await flush();

    expect(h.deps.clearTimer).toHaveBeenCalled();
  });

  it.each([
    ["a different hash", { sha256: "00".repeat(32) }],
    ["a different size", { size: PREPARED_BYTES.length + 1 }],
    ["a url without the hash", { url: "https://blossom.primal.net/avatar.jpg" }],
    ["an http url", { url: `http://blossom.primal.net/${PREPARED_HASH}.jpg` }],
    ["a javascript url", { url: `javascript:alert('${PREPARED_HASH}')` }],
  ])("refuses a descriptor with %s and leaves the field alone", async (_name, override) => {
    const h = harness();
    h.deps.fetch.mockResolvedValue(reply(201, descriptorFor(override)));

    await start(h);
    await flush();

    expect(h.controller.getSnapshot()).toEqual({
      stage: "failed",
      field: "picture",
      message: "The host returned an unexpected reply.",
    });
    expect(h.uploaded).toEqual([]);
  });

  it("refuses a reply that is not JSON", async () => {
    const h = harness();
    h.deps.fetch.mockResolvedValue(reply(201, "<html>not json</html>"));

    await start(h);
    await flush();

    expect(h.controller.getSnapshot()).toMatchObject({
      message: "The host returned an unexpected reply.",
    });
    expect(h.uploaded).toEqual([]);
  });

  it("stops reading a reply at 16 KiB and refuses it", async () => {
    const h = harness();
    let pulled = 0;
    const chunk = new Uint8Array(1024).fill(0x20);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    h.deps.fetch.mockResolvedValue(new Response(stream, { status: 201 }));

    await start(h);
    await flush();

    expect(h.controller.getSnapshot()).toMatchObject({
      message: "The host returned an unexpected reply.",
    });
    expect(h.uploaded).toEqual([]);
    expect(pulled * 1024).toBeLessThanOrEqual(MAX_REPLY_BYTES + 4 * 1024);
  });
});

describe("BlossomUploadController: preparation and authorisation failures", () => {
  it("shows a preparation failure in fixed words", async () => {
    const { PrepareImageError } = await import("@/ui/lib/prepare-image");
    const h = harness({
      prepare: async () => {
        throw new PrepareImageError("decode-failed");
      },
    });

    await start(h);
    await flush();

    expect(h.controller.getSnapshot()).toEqual({
      stage: "failed",
      field: "picture",
      message: "This image could not be read.",
    });
    expect(h.deps.authorize).not.toHaveBeenCalled();
  });

  it("shows a locked vault or refusal without sending anything", async () => {
    const h = harness({
      authorize: async () => {
        throw new Error("rpc:blossom.authorizeUpload:locked");
      },
    });

    await start(h);
    await flush();

    expect(h.controller.getSnapshot()).toMatchObject({ stage: "failed", field: "picture" });
    expect(h.deps.fetch).not.toHaveBeenCalled();
  });

  it("can be dismissed back to idle", async () => {
    const h = harness();
    h.deps.fetch.mockResolvedValue(reply(500, ""));

    await start(h);
    await flush();
    h.controller.dismiss();

    expect(h.controller.getSnapshot()).toEqual({ stage: "idle" });
  });
});

describe("BlossomUploadController: subscriptions", () => {
  it("notifies subscribers of each stage and stops after unsubscribe", async () => {
    const h = harness();
    const seen: string[] = [];
    const unsubscribe = h.controller.subscribe(() =>
      seen.push(h.controller.getSnapshot().stage)
    );

    await start(h);
    await flush();
    unsubscribe();
    const count = seen.length;
    h.controller.cancel();

    expect(seen).toContain("inspecting");
    expect(seen).toContain("choosing");
    expect(seen).toContain("working");
    expect(seen).toContain("done");
    expect(seen.length).toBe(count);
  });

  it("returns the same snapshot object until the state changes", async () => {
    const h = harness();

    const a = h.controller.getSnapshot();
    const b = h.controller.getSnapshot();

    expect(a).toBe(b);
  });
});

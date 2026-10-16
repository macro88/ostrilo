import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AvatarCaptureError,
  avatarCaptureNote,
  captureAvatar,
  type AvatarCaptureFailure,
  type CaptureCanvas,
  type CaptureContext,
  type CaptureDeps,
  type CaptureImage,
} from "@/ui/lib/avatar-capture";
import { PNG_DATA_URL, WEBP_DATA_URL } from "../../../helpers/avatar-fixtures";

const URL_OK = "https://images.example/avatar.png";

interface Rig {
  deps: CaptureDeps;
  image: FakeImage;
  canvas: FakeCanvas;
  draws: Array<number[]>;
}

class FakeImage implements CaptureImage {
  crossOrigin: string | null = null;
  referrerPolicy = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  requested: string[] = [];
  private current = "";
  naturalWidth = 200;
  naturalHeight = 100;

  get src() {
    return this.current;
  }
  set src(value: string) {
    this.current = value;
    if (value) this.requested.push(value);
  }
}

class FakeCanvas implements CaptureCanvas {
  width = 0;
  height = 0;
  encodings: string[] = [];
  webp: string | (() => string) = WEBP_DATA_URL;
  png: string | (() => string) = PNG_DATA_URL;
  context: CaptureContext | null;

  constructor(draws: Array<number[]>) {
    this.context = {
      imageSmoothingQuality: "low",
      drawImage: (_image, ...args) => {
        draws.push(args);
      },
    };
  }

  getContext() {
    return this.context;
  }

  toDataURL(type: string) {
    this.encodings.push(type);
    const out = type === "image/webp" ? this.webp : this.png;
    return typeof out === "function" ? out() : out;
  }
}

function rig(): Rig {
  const draws: Array<number[]> = [];
  const image = new FakeImage();
  const canvas = new FakeCanvas(draws);
  const deps: CaptureDeps = {
    createImage: () => image,
    createCanvas: () => canvas,
    setTimer: (cb, ms) => setTimeout(cb, ms) as unknown as number,
    clearTimer: (id) => clearTimeout(id),
  };
  return { deps, image, canvas, draws };
}

/** Lets `captureAvatar` reach its load and then completes the load. */
async function load(r: Rig, outcome: "load" | "error" = "load") {
  await Promise.resolve();
  if (outcome === "load") r.image.onload?.();
  else r.image.onerror?.();
}

async function failureOf(promise: Promise<unknown>): Promise<AvatarCaptureFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AvatarCaptureError) return error.reason;
    throw error;
  }
  throw new Error("expected a failure");
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("captureAvatar requests", () => {
  it("loads the URL once, anonymously and without a referrer", async () => {
    const r = rig();
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    await done;

    expect(r.image.requested).toEqual([URL_OK]);
    expect(r.image.crossOrigin).toBe("anonymous");
    expect(r.image.referrerPolicy).toBe("no-referrer");
  });

  it.each([
    ["http", "http://images.example/a.png"],
    ["data", PNG_DATA_URL],
    ["blob", "blob:https://images.example/1"],
    ["file", "file:///tmp/a.png"],
    ["javascript", "javascript:alert(1)"],
    ["not a URL", "not a url"],
    ["too long", `https://images.example/${"a".repeat(600)}.png`],
  ])("rejects %s without making a request", async (_name, url) => {
    const r = rig();
    expect(await failureOf(captureAvatar(url, r.deps))).toBe("not-https");
    expect(r.image.requested).toEqual([]);
  });
});

describe("captureAvatar output", () => {
  it("draws the centred square of a landscape image onto a 96x96 canvas", async () => {
    const r = rig();
    r.image.naturalWidth = 400;
    r.image.naturalHeight = 100;
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    await done;

    expect([r.canvas.width, r.canvas.height]).toEqual([96, 96]);
    expect(r.draws).toEqual([[150, 0, 100, 100, 0, 0, 96, 96]]);
  });

  it("centre-crops a portrait image the same way", async () => {
    const r = rig();
    r.image.naturalWidth = 100;
    r.image.naturalHeight = 300;
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    await done;

    expect(r.draws).toEqual([[0, 100, 100, 100, 0, 0, 96, 96]]);
  });

  it("encodes as webp", async () => {
    const r = rig();
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    expect(await done).toBe(WEBP_DATA_URL);
    expect(r.canvas.encodings).toEqual(["image/webp"]);
  });

  it("falls back to png when the browser answers a webp request with a png", async () => {
    const r = rig();
    r.canvas.webp = PNG_DATA_URL;
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    expect(await done).toBe(PNG_DATA_URL);
    expect(r.canvas.encodings).toEqual(["image/webp", "image/png"]);
  });

  it("refuses an encoding that is over the stored size limit", async () => {
    const r = rig();
    r.canvas.webp = `${WEBP_DATA_URL}${"A".repeat(70_000)}`;
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    expect(await failureOf(done)).toBe("encode-failed");
  });

  it("refuses an encoding that is not an image of the declared type", async () => {
    const r = rig();
    r.canvas.webp = "data:image/webp;base64,AAAA";
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    expect(await failureOf(done)).toBe("encode-failed");
  });
});

describe("captureAvatar failures", () => {
  it("reports a tainted canvas, which a host without CORS produces", async () => {
    const r = rig();
    r.canvas.webp = () => {
      throw new DOMException("tainted", "SecurityError");
    };
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    expect(await failureOf(done)).toBe("tainted");
  });

  it("reports any other encoding error as an encode failure", async () => {
    const r = rig();
    r.canvas.webp = () => {
      throw new Error("out of memory");
    };
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    expect(await failureOf(done)).toBe("encode-failed");
  });

  it("reports a failed load", async () => {
    const r = rig();
    const done = captureAvatar(URL_OK, r.deps);
    await load(r, "error");
    expect(await failureOf(done)).toBe("load-failed");
  });

  it("reports an image the browser decoded to nothing as a failed load", async () => {
    const r = rig();
    r.image.naturalWidth = 0;
    r.image.naturalHeight = 0;
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    expect(await failureOf(done)).toBe("load-failed");
  });

  it("gives up after 10 seconds and cancels the request", async () => {
    const r = rig();
    const done = captureAvatar(URL_OK, r.deps);
    const reason = failureOf(done);
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(9_999);
    expect(r.image.src).toBe(URL_OK);

    await vi.advanceTimersByTimeAsync(1);
    expect(await reason).toBe("timeout");
    expect(r.image.src).toBe("");
    expect(r.canvas.encodings).toEqual([]);
  });

  it("does not time out an image that loaded in time", async () => {
    const r = rig();
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    await done;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.image.src).toBe(URL_OK);
  });

  it.each([
    ["4097 wide", 4097, 100],
    ["4097 tall", 100, 4097],
    ["both over", 5000, 5000],
  ])("rejects an image %s without drawing it", async (_name, width, height) => {
    const r = rig();
    r.image.naturalWidth = width;
    r.image.naturalHeight = height;
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    expect(await failureOf(done)).toBe("too-large");
    expect(r.draws).toEqual([]);
  });

  it("accepts an image exactly 4096 by 4096", async () => {
    const r = rig();
    r.image.naturalWidth = 4096;
    r.image.naturalHeight = 4096;
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    await expect(done).resolves.toBe(WEBP_DATA_URL);
  });

  it("reports a canvas with no 2d context", async () => {
    const r = rig();
    r.canvas.context = null;
    const done = captureAvatar(URL_OK, r.deps);
    await load(r);
    expect(await failureOf(done)).toBe("encode-failed");
  });
});

describe("avatarCaptureNote", () => {
  it("uses one generic note for every load failure, since they cannot be told apart", () => {
    expect(avatarCaptureNote("tainted")).toBe(
      "Ostrilo couldn't load this picture to keep a copy, so the header shows your seal."
    );
    expect(avatarCaptureNote("load-failed")).toBe(
      "Ostrilo couldn't load this picture to keep a copy, so the header shows your seal."
    );
  });

  it.each(["timeout", "too-large", "not-https", "encode-failed"] as const)(
    "has its own short note for %s",
    (reason) => {
      const note = avatarCaptureNote(reason);
      expect(note.length).toBeGreaterThan(10);
      expect(note.length).toBeLessThan(90);
      expect(note).not.toBe(avatarCaptureNote("tainted"));
    }
  );
});

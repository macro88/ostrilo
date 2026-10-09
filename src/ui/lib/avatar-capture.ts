import {
  AVATAR_LOAD_TIMEOUT_MS,
  AVATAR_MAX_SOURCE_EDGE_PX,
  AVATAR_SIZE_PX,
  isAvatarDataUrl,
} from "@/domain/profile/avatar";
import { isAllowedRemoteUrl } from "@/domain/profile/types";

/**
 * The one place an extension page loads a remote image.
 *
 * It runs on the Profile page, once, because the user saved their profile with
 * a picture or pressed Refresh picture. It loads the URL, draws a centred
 * square of it onto a small canvas and returns the encoded result. Nothing here
 * retries, polls or runs on its own, and no other surface imports it: the
 * header, the key lists and the approval windows only ever render the stored
 * `data:` copy.
 *
 * The image is requested with `crossOrigin="anonymous"` and no referrer. A host
 * that does not send CORS headers fails the load, or taints the canvas, and in
 * both cases there is no copy: the extension cannot read pixels it was not
 * allowed to read, and does not try another way (a `fetch` would need a wider
 * `connect-src`).
 */

export type AvatarCaptureFailure =
  | "not-https"
  | "timeout"
  | "load-failed"
  | "too-large"
  | "tainted"
  | "encode-failed";

export class AvatarCaptureError extends Error {
  constructor(readonly reason: AvatarCaptureFailure) {
    super(`avatar_capture:${reason}`);
    this.name = "AvatarCaptureError";
  }
}

/** The slice of `HTMLImageElement` the capture uses, so a test can stand in. */
export interface CaptureImage {
  crossOrigin: string | null;
  referrerPolicy: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

export interface CaptureContext {
  imageSmoothingQuality: ImageSmoothingQuality;
  drawImage(
    image: CaptureImage,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void;
}

/** The slice of `HTMLCanvasElement` the capture uses. */
export interface CaptureCanvas {
  width: number;
  height: number;
  getContext(type: "2d"): CaptureContext | null;
  toDataURL(type: string, quality?: number): string;
}

export interface CaptureDeps {
  createImage: () => CaptureImage;
  createCanvas: () => CaptureCanvas;
  setTimer: (callback: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

const browserDeps: CaptureDeps = {
  // aislop-ignore-next-line ai-slop/double-type-assertion -- CaptureImage is a structural subset of HTMLImageElement; the DOM's event-handler and drawImage signatures are wider than the subset, so TypeScript cannot see the relationship.
  createImage: () => new Image() as unknown as CaptureImage,
  // aislop-ignore-next-line ai-slop/double-type-assertion -- same: CaptureCanvas narrows HTMLCanvasElement to the calls the capture makes.
  createCanvas: () => document.createElement("canvas") as unknown as CaptureCanvas,
  setTimer: (callback, ms) => window.setTimeout(callback, ms),
  clearTimer: (id) => window.clearTimeout(id),
};

const WEBP_QUALITY = 0.85;

function loadImage(url: string, deps: CaptureDeps): Promise<CaptureImage> {
  return new Promise((resolve, reject) => {
    const image = deps.createImage();
    let timer = 0;

    const settle = (outcome: () => void) => {
      deps.clearTimer(timer);
      image.onload = null;
      image.onerror = null;
      outcome();
    };

    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.onload = () => settle(() => resolve(image));
    image.onerror = () =>
      settle(() => reject(new AvatarCaptureError("load-failed")));
    timer = deps.setTimer(
      () =>
        settle(() => {
          // Dropping the source cancels a request still in flight.
          image.src = "";
          reject(new AvatarCaptureError("timeout"));
        }),
      AVATAR_LOAD_TIMEOUT_MS
    );
    image.src = url;
  });
}

function encode(canvas: CaptureCanvas): string {
  let webp: string;
  try {
    webp = canvas.toDataURL("image/webp", WEBP_QUALITY);
  } catch (error) {
    // Reading pixels of a canvas that drew a cross-origin image the host did
    // not clear for it.
    if (error instanceof DOMException && error.name === "SecurityError") {
      throw new AvatarCaptureError("tainted");
    }
    throw new AvatarCaptureError("encode-failed");
  }
  // A browser without a webp encoder answers with a PNG instead.
  const encoded = webp.startsWith("data:image/webp")
    ? webp
    : canvas.toDataURL("image/png");
  if (!isAvatarDataUrl(encoded)) throw new AvatarCaptureError("encode-failed");
  return encoded;
}

/**
 * Loads `url` and returns it as a 96x96 centre-cropped `data:` image.
 *
 * Rejects with an `AvatarCaptureError`; the reason says which limit or
 * failure it was.
 */
export async function captureAvatar(
  url: string,
  deps: CaptureDeps = browserDeps
): Promise<string> {
  if (!isAllowedRemoteUrl(url)) throw new AvatarCaptureError("not-https");

  const image = await loadImage(url, deps);
  const { naturalWidth: width, naturalHeight: height } = image;
  if (width <= 0 || height <= 0) throw new AvatarCaptureError("load-failed");
  if (width > AVATAR_MAX_SOURCE_EDGE_PX || height > AVATAR_MAX_SOURCE_EDGE_PX) {
    throw new AvatarCaptureError("too-large");
  }

  const canvas = deps.createCanvas();
  canvas.width = AVATAR_SIZE_PX;
  canvas.height = AVATAR_SIZE_PX;
  const context = canvas.getContext("2d");
  if (!context) throw new AvatarCaptureError("encode-failed");

  const edge = Math.min(width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    (width - edge) / 2,
    (height - edge) / 2,
    edge,
    edge,
    0,
    0,
    AVATAR_SIZE_PX,
    AVATAR_SIZE_PX
  );

  return encode(canvas);
}

/** What the Profile view tells the user when no copy was made. */
export function avatarCaptureNote(reason: AvatarCaptureFailure): string {
  switch (reason) {
    case "tainted":
    case "load-failed":
      // A refused CORS read, a 404 and a DNS failure all arrive as the same
      // load error, so one note covers every way the load can fail.
      return "Ostrilo couldn't load this picture to keep a copy, so the header shows your seal.";
    case "timeout":
      return "This image took too long to load, so Ostrilo couldn't keep a copy.";
    case "too-large":
      return "This image is too large for Ostrilo to keep a copy.";
    case "not-https":
      return "Ostrilo only keeps a copy of pictures at an https:// address.";
    case "encode-failed":
      return "Ostrilo couldn't make a copy of this image.";
  }
}

import {
  BLOSSOM_MAX_EDGE_PX,
} from "@/domain/blossom/constants";
import { fitWithin } from "@/domain/blossom/dimensions";
import {
  bufferHeaderReader,
  inspectImageHeader,
  type HeaderInspection,
  type HeaderReader,
} from "@/domain/blossom/image-sniff";
import type { PrepareFailureReason } from "@/domain/blossom/messages";

/**
 * Gets a chosen image ready to upload, after the user has confirmed.
 *
 * A still JPEG, PNG or WebP is decoded from the local file and drawn onto a
 * canvas with its longest edge capped, then encoded again in the same type.
 * That drops EXIF location data, XMP and text chunks, and proves the bytes
 * really decode as an image. An animated image is sent exactly as it is, since
 * a canvas would flatten it to one frame. Nothing here touches the network.
 */

export class PrepareImageError extends Error {
  constructor(readonly reason: PrepareFailureReason) {
    super(`prepare_image:${reason}`);
    this.name = "PrepareImageError";
  }
}

export interface PreparedImage {
  bytes: Uint8Array<ArrayBuffer>;
  /** The type of `bytes`, as sniffed from them, not as requested of the encoder. */
  mime: string;
  reencoded: boolean;
}

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/** The browser work, injected so tests can stand in for a decoder. */
export interface PrepareDeps {
  decode(bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<DecodedImage>;
  /** Draws `image` at `width` by `height` and encodes it; null when the browser cannot. */
  encode(
    image: DecodedImage,
    width: number,
    height: number,
    mime: string,
    quality: number
  ): Promise<Uint8Array<ArrayBuffer> | null>;
}

const ENCODE_QUALITY = 0.9;

class BitmapImage implements DecodedImage {
  constructor(readonly bitmap: ImageBitmap) {}

  get width(): number {
    return this.bitmap.width;
  }

  get height(): number {
    return this.bitmap.height;
  }

  close(): void {
    this.bitmap.close();
  }
}

function canvasToBytes(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Uint8Array<ArrayBuffer> | null> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      mime,
      quality
    );
  });
}

const browserDeps: PrepareDeps = {
  async decode(bytes, mime) {
    // `from-image` applies the EXIF orientation while decoding, so the picture
    // stays upright once the orientation tag is gone.
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }), {
      imageOrientation: "from-image",
    });
    return new BitmapImage(bitmap);
  },

  async encode(image, width, height, mime, quality) {
    if (!(image instanceof BitmapImage)) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.imageSmoothingQuality = "high";
    context.drawImage(image.bitmap, 0, 0, width, height);
    return canvasToBytes(canvas, mime, quality);
  },
};

/** A slice reader over a chosen file, for the header inspection that precedes the dialog. */
export function fileHeaderReader(file: Blob): HeaderReader {
  return {
    size: file.size,
    async read(start, end) {
      return new Uint8Array(await file.slice(start, end).arrayBuffer());
    },
  };
}

type AcceptedInspection = Extract<HeaderInspection, { ok: true }>;

export async function prepareImage(
  file: Blob,
  inspected: AcceptedInspection,
  deps: PrepareDeps = browserDeps
): Promise<PreparedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  // The header inspection ran before the dialog opened, and the file can change
  // while the user reads it. These are the bytes that will be sent, so they are
  // judged again.
  const recheck = await inspectImageHeader(bufferHeaderReader(bytes));
  if (
    !recheck.ok ||
    recheck.kind !== inspected.kind ||
    recheck.animated !== inspected.animated
  ) {
    throw new PrepareImageError("changed");
  }

  if (inspected.animated) {
    return { bytes, mime: inspected.mime, reencoded: false };
  }

  let image: DecodedImage;
  try {
    image = await deps.decode(bytes, inspected.mime);
  } catch {
    throw new PrepareImageError("decode-failed");
  }

  try {
    let size: { width: number; height: number };
    try {
      size = fitWithin(image.width, image.height, BLOSSOM_MAX_EDGE_PX);
    } catch {
      throw new PrepareImageError("decode-failed");
    }

    const encoded = await deps.encode(
      image,
      size.width,
      size.height,
      inspected.mime,
      ENCODE_QUALITY
    );
    if (!encoded || encoded.length === 0) {
      throw new PrepareImageError("encode-failed");
    }

    const output = await inspectImageHeader(bufferHeaderReader(encoded));
    if (!output.ok) {
      throw new PrepareImageError(
        output.reason === "too-large" ? "too-large" : "encode-failed"
      );
    }

    return { bytes: encoded, mime: output.mime, reencoded: true };
  } finally {
    image.close();
  }
}

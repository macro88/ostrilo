import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PrepareImageError,
  fileHeaderReader,
  prepareImage,
  type DecodedImage,
  type PrepareDeps,
} from "@/ui/lib/prepare-image";
import { inspectImageHeader } from "@/domain/blossom/image-sniff";
import { BLOSSOM_MAX_IMAGE_BYTES } from "@/domain/blossom/constants";
import {
  animatedPng,
  containsAscii,
  gif,
  jpeg,
  jpegWithExif,
  stillPng,
  webp,
} from "../../../helpers/image-bytes";

type Inspected = Awaited<ReturnType<typeof inspectImageHeader>>;

function blobOf(bytes: Uint8Array): Blob {
  return new Blob([bytes.slice()]);
}

async function inspect(bytes: Uint8Array) {
  const result: Inspected = await inspectImageHeader(fileHeaderReader(blobOf(bytes)));
  if (!result.ok) throw new Error(`fixture was refused: ${result.reason}`);
  return result;
}

interface Calls {
  decoded: Array<{ length: number; mime: string }>;
  encoded: Array<{ width: number; height: number; mime: string; quality: number }>;
  closed: number;
}

function fakeDeps(options: {
  size?: { width: number; height: number };
  decodeFails?: boolean;
  output?: Uint8Array<ArrayBuffer> | null;
}): { deps: PrepareDeps; calls: Calls } {
  const calls: Calls = { decoded: [], encoded: [], closed: 0 };
  const size = options.size ?? { width: 4000, height: 3000 };
  const deps: PrepareDeps = {
    async decode(bytes, mime): Promise<DecodedImage> {
      calls.decoded.push({ length: bytes.length, mime });
      if (options.decodeFails) throw new Error("not decodable");
      return {
        width: size.width,
        height: size.height,
        close() {
          calls.closed += 1;
        },
      };
    },
    async encode(_image, width, height, mime, quality) {
      calls.encoded.push({ width, height, mime, quality });
      return options.output === undefined ? jpeg() : options.output;
    },
  };
  return { deps, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prepareImage: still images", () => {
  it("re-encodes in the same type with the longest edge capped at 2048", async () => {
    const bytes = jpegWithExif();
    const { deps, calls } = fakeDeps({ size: { width: 4000, height: 3000 } });

    const prepared = await prepareImage(blobOf(bytes), await inspect(bytes), deps);

    expect(prepared.reencoded).toBe(true);
    expect(prepared.mime).toBe("image/jpeg");
    expect(calls.encoded).toEqual([
      { width: 2048, height: 1536, mime: "image/jpeg", quality: 0.9 },
    ]);
  });

  it("does not enlarge a small image", async () => {
    const bytes = stillPng();
    const { deps, calls } = fakeDeps({
      size: { width: 640, height: 480 },
      output: stillPng(),
    });

    await prepareImage(blobOf(bytes), await inspect(bytes), deps);

    expect(calls.encoded[0]).toMatchObject({ width: 640, height: 480 });
  });

  it("returns the encoder's bytes, so embedded metadata does not survive", async () => {
    const bytes = jpegWithExif();
    expect(containsAscii(bytes, "Exif")).toBe(true);
    const { deps } = fakeDeps({ output: jpeg() });

    const prepared = await prepareImage(blobOf(bytes), await inspect(bytes), deps);

    expect(containsAscii(prepared.bytes, "Exif")).toBe(false);
    expect(containsAscii(prepared.bytes, "GPS")).toBe(false);
    expect(Array.from(prepared.bytes)).toEqual(Array.from(jpeg()));
  });

  it("reports the type the encoder actually produced", async () => {
    // A browser without a WebP encoder answers a WebP request with a PNG.
    const bytes = webp(0x10);
    const { deps } = fakeDeps({ output: stillPng() });

    const prepared = await prepareImage(blobOf(bytes), await inspect(bytes), deps);

    expect(prepared.mime).toBe("image/png");
    expect(prepared.reencoded).toBe(true);
  });

  it("asks for lossless PNG, with no quality that would degrade it", async () => {
    const bytes = stillPng();
    const { deps, calls } = fakeDeps({ output: stillPng() });

    await prepareImage(blobOf(bytes), await inspect(bytes), deps);

    expect(calls.encoded[0].mime).toBe("image/png");
  });

  it("releases the decoded image", async () => {
    const bytes = jpeg();
    const { deps, calls } = fakeDeps({});

    await prepareImage(blobOf(bytes), await inspect(bytes), deps);

    expect(calls.closed).toBe(1);
  });
});

describe("prepareImage: animated images are not flattened", () => {
  it.each([
    ["a GIF", gif()],
    ["an animated WebP", webp(0x02)],
    ["an animated PNG", animatedPng()],
  ])("passes %s through byte for byte", async (_name, bytes) => {
    const { deps, calls } = fakeDeps({});
    const inspected = await inspect(bytes);
    expect(inspected.animated).toBe(true);

    const prepared = await prepareImage(blobOf(bytes), inspected, deps);

    expect(prepared.reencoded).toBe(false);
    expect(Array.from(prepared.bytes)).toEqual(Array.from(bytes));
    expect(prepared.mime).toBe(inspected.mime);
    expect(calls.decoded).toEqual([]);
    expect(calls.encoded).toEqual([]);
  });
});

describe("prepareImage: refusals", () => {
  it("refuses a file replaced after the header inspection", async () => {
    const original = stillPng();
    const inspected = await inspect(original);
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    const { deps, calls } = fakeDeps({});

    await expect(prepareImage(blobOf(html), inspected, deps)).rejects.toMatchObject({
      name: "PrepareImageError",
      reason: "changed",
    });
    expect(calls.decoded).toEqual([]);
  });

  it("refuses a file that changed type after the inspection", async () => {
    const inspected = await inspect(stillPng());
    const { deps, calls } = fakeDeps({});

    await expect(
      prepareImage(blobOf(jpeg()), inspected, deps)
    ).rejects.toMatchObject({ reason: "changed" });
    expect(calls.decoded).toEqual([]);
  });

  it("refuses a file that became animated after the inspection", async () => {
    const inspected = await inspect(webp(0x10));
    const { deps } = fakeDeps({});

    await expect(
      prepareImage(blobOf(webp(0x02)), inspected, deps)
    ).rejects.toMatchObject({ reason: "changed" });
  });

  it("refuses a file that is not decodable, and releases nothing it never held", async () => {
    const bytes = jpeg();
    const { deps, calls } = fakeDeps({ decodeFails: true });

    await expect(
      prepareImage(blobOf(bytes), await inspect(bytes), deps)
    ).rejects.toMatchObject({ reason: "decode-failed" });
    expect(calls.encoded).toEqual([]);
    expect(calls.closed).toBe(0);
  });

  it("refuses a decoded image with no size", async () => {
    const bytes = jpeg();
    const { deps, calls } = fakeDeps({ size: { width: 0, height: 0 } });

    await expect(
      prepareImage(blobOf(bytes), await inspect(bytes), deps)
    ).rejects.toMatchObject({ reason: "decode-failed" });
    expect(calls.closed).toBe(1);
  });

  it("refuses when the browser cannot encode", async () => {
    const bytes = jpeg();
    const { deps, calls } = fakeDeps({ output: null });

    await expect(
      prepareImage(blobOf(bytes), await inspect(bytes), deps)
    ).rejects.toMatchObject({ reason: "encode-failed" });
    expect(calls.closed).toBe(1);
  });

  it("refuses an encoder that returns something that is not an image", async () => {
    const bytes = jpeg();
    const { deps } = fakeDeps({ output: new TextEncoder().encode("<html>") });

    await expect(
      prepareImage(blobOf(bytes), await inspect(bytes), deps)
    ).rejects.toMatchObject({ reason: "encode-failed" });
  });

  it("refuses a re-encoded image that grew past the limit", async () => {
    const bytes = stillPng();
    const huge = new Uint8Array(BLOSSOM_MAX_IMAGE_BYTES + 1);
    huge.set(stillPng());
    const { deps } = fakeDeps({ size: { width: 2000, height: 2000 }, output: huge });

    await expect(
      prepareImage(blobOf(bytes), await inspect(bytes), deps)
    ).rejects.toMatchObject({ reason: "too-large" });
  });

  it("reports failures as PrepareImageError", async () => {
    const { deps } = fakeDeps({});
    const inspected = await inspect(jpeg());

    await expect(
      prepareImage(blobOf(new Uint8Array([1, 2, 3])), inspected, deps)
    ).rejects.toBeInstanceOf(PrepareImageError);
  });
});

describe("prepareImage: what it does not do", () => {
  it("reads the file once", async () => {
    const bytes = jpeg();
    const file = blobOf(bytes);
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");
    const slice = vi.spyOn(file, "slice");
    const inspected = await inspect(bytes);
    slice.mockClear();
    const { deps } = fakeDeps({});

    await prepareImage(file, inspected, deps);

    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(slice).not.toHaveBeenCalled();
  });

  it("makes no network request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const bytes = jpeg();
    const { deps } = fakeDeps({});

    await prepareImage(blobOf(bytes), await inspect(bytes), deps);
    await prepareImage(blobOf(gif()), await inspect(gif()), deps);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fileHeaderReader", () => {
  it("serves slices of the file and reports its size", async () => {
    const reader = fileHeaderReader(blobOf(Uint8Array.from([1, 2, 3, 4, 5])));

    expect(reader.size).toBe(5);
    expect(Array.from(await reader.read(1, 3))).toEqual([2, 3]);
    expect(Array.from(await reader.read(3, 99))).toEqual([4, 5]);
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImageUploadField } from "@/ui/features/profile/components/ImageUploadField";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ENDPOINT = "https://nostr.build/api/v2/upload/files";

let container: HTMLDivElement;
let root: Root;
let current: string;
const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
let confirmSpy: ReturnType<typeof vi.spyOn>;

function Harness({ endpoint, initial }: { endpoint?: string; initial: string }) {
  const [value, setValue] = useState(initial);
  current = value;
  return (
    <ImageUploadField
      id="picture"
      label="Profile Picture URL"
      value={value}
      onChange={setValue}
      uploadEndpoint={endpoint}
    />
  );
}

function mount(endpoint?: string, initial = "") {
  act(() => {
    root.render(<Harness endpoint={endpoint} initial={initial} />);
  });
}

function fileInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  return input;
}

async function choose(file: File) {
  const input = fileInput();
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function image(type = "image/png", size = 1024): File {
  const file = new File(["x"], "avatar.png", { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function alertText(): string | null {
  return container.querySelector('[role="alert"]')?.textContent ?? null;
}

function respond(body: unknown, init: { ok?: boolean; statusText?: string } = {}) {
  fetchMock.mockResolvedValue({
    ok: init.ok ?? true,
    statusText: init.statusText ?? "OK",
    json: async () => body,
  } as Response);
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  confirmSpy.mockRestore();
  consoleError.mockRestore();
});

describe("ImageUploadField without an image host", () => {
  it("offers no upload and tells the user to paste an https URL", () => {
    mount();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toContain("No image host is configured. Paste an https:// image URL.");
  });

  it("refuses a plaintext endpoint as a host", () => {
    mount("http://insecure.example/upload");
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).not.toContain("Upload to");
  });

  it("refuses an endpoint that is not a URL", () => {
    mount("not a url");
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it("passes typed URLs straight through", () => {
    mount();
    const input = container.querySelector<HTMLInputElement>("#picture")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "https://cdn.example/me.png");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(current).toBe("https://cdn.example/me.png");
  });
});

describe("ImageUploadField with an https host", () => {
  it("names the host that would receive the image", () => {
    mount(ENDPOINT);
    expect(container.textContent).toContain("Upload to nostr.build");
    expect(container.textContent).toContain("Up to 5MB. JPEG, PNG, GIF or WebP.");
  });

  it("rejects a file type the host is not asked to accept", async () => {
    mount(ENDPOINT);
    await choose(image("image/svg+xml"));
    expect(alertText()).toBe("Choose a JPEG, PNG, GIF or WebP image.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an image over 5MB", async () => {
    mount(ENDPOINT);
    await choose(image("image/jpeg", 5 * 1024 * 1024 + 1));
    expect(alertText()).toBe("Image must be smaller than 5MB");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the user declines to share with the host", async () => {
    confirmSpy.mockReturnValue(false);
    mount(ENDPOINT);
    await choose(image());
    expect(confirmSpy.mock.calls[0][0]).toContain("Send this image to nostr.build?");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(current).toBe("");
  });

  it("posts the file and fills in the https URL the host returns", async () => {
    respond({ status: "success", data: [{ url: "https://image.nostr.build/abc.png" }] });
    mount(ENDPOINT);
    const file = image();
    await choose(file);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("file")).toBe(file);
    expect(current).toBe("https://image.nostr.build/abc.png");
    expect(alertText()).toBeNull();
  });

  it("refuses a returned URL that is not https", async () => {
    respond({ status: "success", data: [{ url: "http://image.nostr.build/abc.png" }] });
    mount(ENDPOINT);
    await choose(image());
    expect(current).toBe("");
    expect(alertText()).toBe("The image host returned a URL that is not an https:// address");
  });

  it("reports an HTTP failure from the host", async () => {
    respond({}, { ok: false, statusText: "Payload Too Large" });
    mount(ENDPOINT);
    await choose(image());
    expect(alertText()).toBe("Upload failed: Payload Too Large");
    expect(container.querySelector("progress")).toBeNull();
  });

  it("reports a non-Error failure generically", async () => {
    fetchMock.mockRejectedValue("offline");
    mount(ENDPOINT);
    await choose(image());
    expect(alertText()).toBe("Could not upload the image. Try again.");
  });

  it("shows progress and disables the controls while uploading", async () => {
    vi.useFakeTimers();
    let finish: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mount(ENDPOINT, "https://cdn.example/old.png");
    await choose(image());

    expect(container.textContent).toContain("Uploading...");
    expect(container.querySelector<HTMLInputElement>("#picture")!.disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    const progress = container.querySelector("progress");
    expect(progress?.getAttribute("aria-label")).toBe("Image upload progress");
    expect(Number(progress?.getAttribute("value"))).toBe(20);

    await act(async () => {
      finish({
        ok: true,
        statusText: "OK",
        json: async () => ({ status: "success", data: [{ url: "https://image.nostr.build/new.png" }] }),
      } as Response);
    });
    await act(async () => {
      await Promise.resolve();
    });
    vi.useRealTimers();
    expect(current).toBe("https://image.nostr.build/new.png");
    expect(container.querySelector("progress")).toBeNull();
  });

  it("clears a previous upload error when the image is removed", async () => {
    mount(ENDPOINT, "https://cdn.example/old.png");
    await choose(image("text/plain"));
    expect(alertText()).not.toBeNull();

    const remove = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Remove"
    )!;
    act(() => remove.click());
    expect(current).toBe("");
    expect(alertText()).toBeNull();
  });

  it("ignores a change event that carries no file", async () => {
    mount(ENDPOINT);
    const input = fileInput();
    Object.defineProperty(input, "files", { configurable: true, value: [] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(alertText()).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

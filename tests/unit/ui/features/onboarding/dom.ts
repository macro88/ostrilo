import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

export function render(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return {
    container,
    rerender: (next: ReactNode) => act(() => root.render(next)),
    unmount: () => act(() => root.unmount()),
  };
}

export function unmountAll() {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  document.body.innerHTML = "";
}

/** The RPC client logs method and status on every call; tests keep it quiet. */
export function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

export function input(root: ParentNode, selector: string): HTMLInputElement {
  const found = root.querySelector<HTMLInputElement>(selector);
  if (!found) throw new Error(`no input matching ${selector}`);
  return found;
}

export function setValue(field: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function button(root: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find(
    (candidate) =>
      candidate.textContent?.trim() === text ||
      candidate.getAttribute("aria-label") === text
  );
  if (!found) throw new Error(`no button labelled ${text}`);
  return found;
}

export function maybeButton(
  root: ParentNode,
  text: string
): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text
  );
}

export async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

export function alertText(root: ParentNode): string {
  return root.querySelector("[role='alert']")?.textContent ?? "";
}

/**
 * Waits on work that yields to the event loop repeatedly, such as Argon2id or
 * a debounced strength check, which a single `act` flush does not drain.
 */
export async function settle(predicate: () => boolean, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition never settled");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

/** Picks `file` on a file input the way the browser does. */
export async function chooseFile(field: HTMLInputElement, file: File) {
  Object.defineProperty(field, "files", { value: [file], configurable: true });
  await act(async () => {
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export interface CapturedDownload {
  filename: string;
  contents: string;
}

/**
 * Intercepts the save-a-file boundary: the object URL and the synthetic anchor
 * click. Returns the files written, plus the object URLs still alive.
 */
export function captureDownloads() {
  const blobs = new Map<string, Blob>();
  const live = new Set<string>();
  const pending: Array<Promise<CapturedDownload>> = [];
  let counter = 0;

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: (blob: Blob) => {
      counter += 1;
      const url = `blob:test/${counter}`;
      blobs.set(url, blob);
      live.add(url);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => {
      live.delete(url);
    },
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      const blob = blobs.get(this.href);
      if (!blob) return;
      const filename = this.download;
      pending.push(blob.text().then((contents) => ({ filename, contents })));
    }
  );

  return {
    liveUrls: live,
    files: () => Promise.all(pending),
    count: () => pending.length,
  };
}

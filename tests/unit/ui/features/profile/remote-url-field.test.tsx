/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RemoteUrlField } from "@/ui/features/profile/components/RemoteUrlField";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const URL_VALUE = "https://alice.example/about";
const writeText = vi.fn<(text: string) => Promise<void>>();

let container: HTMLDivElement;
let root: Root;

function mount(props: Partial<Parameters<typeof RemoteUrlField>[0]> = {}) {
  const onAdd = props.onAdd ?? vi.fn();
  act(() => {
    root.render(<RemoteUrlField label="Website" value={URL_VALUE} {...props} onAdd={onAdd} />);
  });
  return onAdd;
}

function control(label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`No control ${label}`);
  return found;
}

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RemoteUrlField", () => {
  it("renders an https URL as text with copy and open controls", () => {
    mount();
    expect(container.querySelector(".font-mono")?.textContent).toBe(URL_VALUE);
    expect(control("Copy Website")).toBeDefined();
    expect(control("Open Website in a new tab")).toBeDefined();
  });

  it("uses the caller's wording for the open control", () => {
    mount({ openLabel: "Open website in a new tab" });
    expect(control("Open website in a new tab")).toBeDefined();
  });

  it("copies the URL and confirms briefly", async () => {
    mount();
    await act(async () => {
      control("Copy Website").click();
    });
    expect(writeText).toHaveBeenCalledWith(URL_VALUE);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("Copied");

    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("");
  });

  it("stays quiet when the clipboard refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeText.mockRejectedValue(new Error("denied"));
    mount();
    await act(async () => {
      control("Copy Website").click();
    });
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("");
    expect(warn).toHaveBeenCalled();
  });

  it("opens the URL in an isolated tab", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    mount();
    act(() => control("Open Website in a new tab").click());
    expect(open).toHaveBeenCalledWith(URL_VALUE, "_blank", "noopener,noreferrer");
  });

  it("becomes an Add control for a missing or non-https value", () => {
    const onAdd = mount({ value: "javascript:alert(1)" });
    expect(container.textContent).not.toContain("javascript:");
    act(() => control("Add Website").click());
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("shows a placeholder and no controls while loading", () => {
    mount({ value: undefined, loading: true });
    expect(container.querySelector("h3")?.textContent).toBe("Website");
    expect(container.querySelector("button")).toBeNull();
  });

  it("offers neither copy nor open while loading a value it cannot yet trust", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    mount({ value: "http://plain.example", loading: true });
    expect(container.querySelector("button")).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});

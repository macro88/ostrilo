/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { Pubkey } from "@/ui/components/common/pubkey";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NPUB = "npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzzzzzz";

const writeText = vi.fn<(text: string) => Promise<void>>();
const execCommand = vi.fn<(command: string) => boolean>();

let container: HTMLDivElement;
let root: Root;

function render(ui: ReactNode) {
  act(() => {
    root.render(ui);
  });
}

function button(label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

async function press(label: string) {
  await act(async () => {
    button(label).click();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  execCommand.mockReset().mockReturnValue(true);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("Pubkey inline layout", () => {
  it("middle-truncates to the requested head and tail", () => {
    render(<Pubkey pubkey={NPUB} startChars={6} endChars={4} />);
    expect(container.textContent).toContain("npub1q…zzzz");
    expect(container.textContent).not.toContain(NPUB);
  });

  it("shows its label beside the key", () => {
    render(<Pubkey pubkey={NPUB} label="Signing key" />);
    expect(container.textContent).toContain("Signing key");
  });

  it("renders an empty chip rather than an ellipsis for no key", () => {
    render(<Pubkey pubkey="" />);
    expect(container.textContent).not.toContain("…");
  });

  it("copies the full key, not the truncated display", async () => {
    render(<Pubkey pubkey={NPUB} />);
    await press("Copy public key");
    expect(writeText).toHaveBeenCalledWith(NPUB);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      "Copied"
    );
  });

  it("clears the copied confirmation after a moment", async () => {
    render(<Pubkey pubkey={NPUB} />);
    await press("Copy public key");
    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("");
  });

  it("falls back to a hidden textarea when the clipboard API refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    let copiedValue: string | undefined;
    execCommand.mockImplementation(() => {
      copiedValue = document.querySelector("textarea")?.value;
      return true;
    });

    render(<Pubkey pubkey={NPUB} />);
    await press("Copy public key");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copiedValue).toBe(NPUB);
    expect(document.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Copied");
  });

  it("opens a QR dialog carrying the full key and closes it on Escape", async () => {
    render(<Pubkey pubkey={NPUB} />);
    await press("Show QR code");

    const dialog = container.querySelector("dialog");
    expect(dialog?.hasAttribute("open")).toBe(true);
    expect(dialog?.textContent).toContain(NPUB);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector("dialog")).toBeNull();
  });
});

describe("Pubkey block layout", () => {
  it("shows the section label over the key", () => {
    render(<Pubkey pubkey={NPUB} layout="block" label="Public key" />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("Public key");
    expect(container.textContent).toContain("npub1qqq…zzzzzz");
  });

  it("swaps the label for Copied while a copy is fresh", async () => {
    render(<Pubkey pubkey={NPUB} layout="block" label="Public key" />);
    await press("Copy public key");
    expect(writeText).toHaveBeenCalledWith(NPUB);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      "Copied"
    );

    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      "Public key"
    );
  });

  it("carries no label slot when unlabelled and nothing was copied", () => {
    render(<Pubkey pubkey={NPUB} layout="block" />);
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it("opens the QR dialog from the block layout too", async () => {
    render(<Pubkey pubkey={NPUB} layout="block" label="Public key" />);
    await press("Show QR code");
    expect(container.querySelector("dialog")?.textContent).toContain(NPUB);
  });

  it("does not update state after unmounting with a copy pending", async () => {
    render(<Pubkey pubkey={NPUB} layout="block" label="Public key" />);
    await press("Copy public key");
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });
});

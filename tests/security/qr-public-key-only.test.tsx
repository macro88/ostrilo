/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Pubkey } from "@/ui/components/common/pubkey";

/**
 * QR codes encode public data only.
 *
 * A QR code is the single easiest way to move a private key off a machine: a
 * phone camera reads it from across a room, from a screen share, or from a
 * screenshot that has already synced. `pubkey.tsx` hands `QRCodeModal` the
 * public key and nothing else, and this pins that.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SRC_ROOT = path.join(REPO_ROOT, "src");

const NPUB = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
const PUBKEY_HEX =
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function render(ui: React.ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return container;
}

function click(element: Element | null) {
  if (!element) throw new Error("element not found");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("QR codes never encode private key material", () => {
  it("renders the public key and labels it as such", () => {
    const container = render(<Pubkey pubkey={NPUB} />);

    const qrButton = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.getAttribute("aria-label") ?? "").toLowerCase().includes("qr")
    );
    click(qrButton ?? null);

    const dialog = container.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector("#qr-code-title")?.textContent).toBe(
      "Public Key"
    );
    expect(dialog?.textContent).not.toContain(NSEC);
    expect(dialog?.textContent).not.toMatch(/nsec1/);
  });

  it("passes only the public key to the modal, in source", () => {
    const source = readFileSync(
      path.join(SRC_ROOT, "ui/components/common/pubkey.tsx"),
      "utf8"
    );
    expect(source).toMatch(/<QRCodeModal[\s\S]{0,200}value=\{pubkey\}/);
    expect(source).not.toMatch(/value=\{[^}]*nsec[^}]*\}/i);
  });

  it("has no caller anywhere that hands a QR component key material", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const code = readFileSync(file, "utf8");
      if (!/QRCode(Modal|SVG)?\b/.test(code)) continue;
      // `value=` on a QR component must never be fed anything key-shaped.
      for (const match of code.matchAll(
        /<QRCode(?:Modal)?[^>]*value=\{([^}]*)\}/g
      )) {
        if (/nsec|privateKey|secretKey|\bsk\b|\bhex\b/i.test(match[1])) {
          offenders.push(`${path.relative(SRC_ROOT, file)}: ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the QR library out of the onboarding key surfaces", () => {
    const keySurfaces = sourceFiles(
      path.join(SRC_ROOT, "ui/features/onboarding")
    );
    const importers = keySurfaces.filter((file) =>
      /from\s+["'][^"']*qr[^"']*["']/i.test(readFileSync(file, "utf8"))
    );
    expect(importers).toEqual([]);
  });
});

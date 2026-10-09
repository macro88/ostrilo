/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisclosureGrants } from "@/ui/features/settings/components/shared";
import { click, flush, render, unmountAll } from "./settings-dom";

const NPUB = `npub1${"a".repeat(58)}`;
const identities = [{ id: "key-a", label: "Main", publicKeyBech32: NPUB }];

function copyButton(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>(
    '[aria-label="Copy public key for Main"]'
  )!;
}

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("DisclosureGrants", () => {
  it("copies the full npub, not the truncated one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const container = render(
      <DisclosureGrants keyIds={["key-a"]} identities={identities} />
    );

    await click(copyButton(container));
    await flush();

    expect(writeText).toHaveBeenCalledWith(NPUB);
    vi.unstubAllGlobals();
  });

  it("keeps the npub on screen when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const container = render(
      <DisclosureGrants keyIds={["key-a"]} identities={identities} />
    );

    await click(copyButton(container));
    await flush();

    expect(container.textContent).toContain("npub1aaaaaaa");
    vi.unstubAllGlobals();
  });

  it("offers no Revoke when it is given no handler", () => {
    const container = render(
      <DisclosureGrants keyIds={["key-a"]} identities={identities} />
    );

    expect(container.querySelector("button[aria-label^='Revoke']")).toBeNull();
  });

  it("names a key with no label rather than showing an empty line", () => {
    const container = render(
      <DisclosureGrants
        keyIds={["key-a"]}
        identities={[{ ...identities[0], label: "" }]}
      />
    );

    expect(container.textContent).toContain("Unnamed key");
  });
});

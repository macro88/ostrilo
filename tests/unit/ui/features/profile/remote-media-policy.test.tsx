/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ProfileSummary } from "@/ui/features/profile/components/ProfileSummary";
import { ImageUploadField } from "@/ui/features/profile/components/ImageUploadField";
import { KeySelectorCard } from "@/ui/features/settings/components/shared/KeySelectorCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function render(ui: ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return container;
}

function click(element: Element) {
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

const RELAY_PICTURE = "https://relay-chosen-host.example/avatar.png";

function remoteSources(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll("img, image, video, source, iframe")
  )
    .map((el) => el.getAttribute("src") ?? el.getAttribute("href") ?? "")
    .filter((src) => src.length > 0);
}

describe("privileged pages do not load relay-chosen media", () => {
  it("renders the seal avatar instead of the relay-supplied picture", () => {
    const container = render(
      <ProfileSummary
        profile={{
          name: "Alice",
          about: "Bio",
          website: "https://alice.example.com",
          picture: RELAY_PICTURE,
        }}
        loading={false}
        error={null}
        npub="npub1aliceaaaaaaaaaaaaaaaaaaaaaaa"
        onEdit={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(remoteSources(container)).toEqual([]);
    expect(container.querySelector("img")).toBeNull();

    const seal = container.querySelector(".seal");
    expect(seal).not.toBeNull();
    expect(seal!.textContent).toBe("A");
  });

  it("keeps the picture URL inspectable as monospace text with a copy affordance", () => {
    const container = render(
      <ProfileSummary
        profile={{ name: "Alice", picture: RELAY_PICTURE }}
        loading={false}
        error={null}
        npub="npub1alice"
        onEdit={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const mono = Array.from(container.querySelectorAll(".font-mono")).find(
      (node) => node.textContent === RELAY_PICTURE
    );
    expect(mono).toBeDefined();

    const copy = container.querySelector(
      'button[aria-label="Copy Picture URL"]'
    );
    expect(copy).not.toBeNull();

    const open = container.querySelector(
      'button[aria-label="Open picture in a new tab"]'
    );
    expect(open).not.toBeNull();

    // Opening the image is an explicit action in an ordinary browser tab.
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null as unknown as Window);
    click(open!);
    expect(openSpy).toHaveBeenCalledWith(
      RELAY_PICTURE,
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("renders seal avatars for every key in the settings key list", () => {
    const container = render(
      <KeySelectorCard
        keys={[
          {
            id: "key-1",
            label: "Main",
            publicKeyBech32: "npub1mainaaaaaaaaaaaaaaaaaaaaaaaaa",
            publicKeyHex: "a".repeat(64),
          },
          {
            id: "key-2",
            label: "Alt",
            publicKeyBech32: "npub1altbbbbbbbbbbbbbbbbbbbbbbbbbb",
            publicKeyHex: "b".repeat(64),
          },
        ]}
        selectedKeyId="key-1"
        profiles={
          new Map([
            ["a".repeat(64), { name: "Alice", picture: RELAY_PICTURE }],
            ["b".repeat(64), { name: "Bob", picture: RELAY_PICTURE }],
          ])
        }
      />
    );

    expect(remoteSources(container)).toEqual([]);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain("Bob");
    // Identities stay distinguishable by name and truncated npub.
    expect(container.textContent).toContain("npub1mainaaaaaaa...aaaaaaaa");
    expect(container.textContent).toContain("npub1altbbbbbbbb...bbbbbbbb");
  });
});

describe("outbound upload destination", () => {
  it("offers no upload control when no image host is configured", () => {
    const container = render(
      <ImageUploadField
        id="picture"
        label="Profile Picture URL"
        value=""
        onChange={vi.fn()}
      />
    );

    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toContain("No image host is configured");
    expect(container.textContent).toContain("Paste");
  });

  it("names the configured host on the upload control", () => {
    const container = render(
      <ImageUploadField
        id="picture"
        label="Profile Picture URL"
        value=""
        onChange={vi.fn()}
        uploadEndpoint="https://images.example.com/api/upload"
      />
    );

    expect(container.textContent).toContain("Upload to images.example.com");
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("treats a non-https endpoint as no endpoint at all", () => {
    const container = render(
      <ImageUploadField
        id="picture"
        label="Profile Picture URL"
        value=""
        onChange={vi.fn()}
        uploadEndpoint="http://images.example.com/api/upload"
      />
    );

    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toContain("No image host is configured");
  });

  describe("upload response handling", () => {
    let onChange: ReturnType<typeof vi.fn<(value: string) => void>>;
    let container: HTMLDivElement;

    beforeEach(() => {
      onChange = vi.fn();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      container = render(
        <ImageUploadField
          id="picture"
          label="Profile Picture URL"
          value=""
          onChange={onChange}
          uploadEndpoint="https://images.example.com/api/upload"
        />
      );
    });

    async function upload(responseBody: unknown) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          statusText: "OK",
          json: async () => responseBody,
        })
      );

      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      const file = new File([new Uint8Array([1, 2, 3])], "avatar.png", {
        type: "image/png",
      });
      Object.defineProperty(fileInput, "files", {
        value: [file],
        configurable: true,
      });

      await act(async () => {
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("accepts an https URL returned by the upload service", async () => {
      await upload({
        status: "success",
        data: [{ url: "https://images.example.com/abc.png" }],
      });

      expect(onChange).toHaveBeenCalledWith("https://images.example.com/abc.png");
    });

    it("rejects a non-https URL returned by the upload service", async () => {
      await upload({
        status: "success",
        data: [{ url: "http://images.example.com/abc.png" }],
      });

      expect(onChange).not.toHaveBeenCalled();
      expect(container.textContent).toContain("not an https:// address");
    });

    it("rejects a javascript: URL returned by the upload service", async () => {
      await upload({
        status: "success",
        data: [{ url: "javascript:alert(1)" }],
      });

      expect(onChange).not.toHaveBeenCalled();
      expect(container.textContent).toContain("not an https:// address");
    });
  });
});

describe("identity surfaces carry no remote image sources", () => {
  const SURFACES = [
    "src/ui/features/profile/components/ProfileSummary.tsx",
    "src/ui/features/profile/components/ProfileView.tsx",
    "src/ui/features/profile/components/ProfileEditForm.tsx",
    "src/ui/components/layout/KeySelector.tsx",
    "src/ui/features/settings/components/shared/KeySelectorCard.tsx",
  ];

  it.each(SURFACES)(
    "%s does not render an AvatarImage or img element",
    (relativePath) => {
      const source = readFileSync(
        path.join(process.cwd(), relativePath),
        "utf8"
      );

      // Strip comments so the explanatory notes about why these are absent do
      // not themselves trip the check.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

      expect(code).not.toMatch(/<AvatarImage/);
      expect(code).not.toMatch(/<img\b/);
      expect(code).not.toMatch(/backgroundImage/);
    }
  );
});

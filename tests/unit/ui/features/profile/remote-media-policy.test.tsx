/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { collectSources } from "../../../../helpers/source-scan";
import { OwnAvatarImage } from "@/ui/components/common/OwnAvatarImage";
import { ProfileSummary } from "@/ui/features/profile/components/ProfileSummary";
import { ImageUploadField } from "@/ui/features/profile/components/ImageUploadField";
import { RemoteUrlField } from "@/ui/features/profile/components/RemoteUrlField";
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
        pictureStatus={{ kind: "idle" }}
        onRefreshPicture={vi.fn()}
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
        pictureStatus={{ kind: "idle" }}
        onRefreshPicture={vi.fn()}
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
    expect(container.textContent).toContain("npub1mainaaa…aaaaaa");
    expect(container.textContent).toContain("npub1altbbbb…bbbbbb");
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

/**
 * The one exception to "no remote image in an extension page": the Profile page
 * loads the user's own picture once, when they save the profile or press
 * Refresh picture, and keeps a small local copy. Everything else renders only
 * that copy, as a `data:` URL, or the seal. These checks pin the exception to
 * the place that is allowed to make it.
 */
describe("the only remote image load is the Profile page's explicit save or refresh", () => {
  const sources = collectSources(path.join(process.cwd(), "src"));
  const filesMatching = (pattern: RegExp) =>
    sources.filter((file) => pattern.test(file.code)).map((file) => file.path);

  it("constructs an image from a URL in exactly one place", () => {
    expect(filesMatching(/new Image\(/)).toEqual(["src/ui/lib/avatar-capture.ts"]);
  });

  it("sets no image source from a variable anywhere else, and renders <img> only for the logo and the local copy", () => {
    expect(filesMatching(/<img\b/).sort()).toEqual([
      "src/ui/components/common/OwnAvatarImage.tsx",
      "src/ui/components/logo/Logo.tsx",
    ]);
    expect(filesMatching(/<AvatarImage\b/)).toEqual([]);
  });

  it("imports the capture helper only from the Profile page's picture hook", () => {
    expect(filesMatching(/avatar-capture/).sort()).toEqual([
      "src/ui/features/profile/hooks/useProfilePicture.ts",
    ]);
  });

  it("starts a capture only from the Profile view's save and its Refresh picture control", () => {
    expect(filesMatching(/useProfilePicture\(/).sort()).toEqual([
      "src/ui/features/profile/components/ProfileView.tsx",
      "src/ui/features/profile/hooks/useProfilePicture.ts",
    ]);
    const view = sources.find((file) =>
      file.path.endsWith("features/profile/components/ProfileView.tsx")
    );
    expect(view?.code.match(/picture\.cache\(/g)).toHaveLength(2);

    // Never from an effect: a capture must follow a user action.
    const hook = sources.find((file) =>
      file.path.endsWith("features/profile/hooks/useProfilePicture.ts")
    );
    expect(hook?.code).not.toMatch(/useEffect/);
  });

  it("keeps the header's picture source a stored data URL", () => {
    const element = sources.find((file) =>
      file.path.endsWith("components/common/OwnAvatarImage.tsx")
    );
    expect(element?.code).toContain("isAvatarDataUrl(");
    const header = sources.find((file) => file.path.endsWith("layout/KeySelector.tsx"));
    expect(header?.code).not.toMatch(/\.picture\b/);
    expect(header?.code).not.toMatch(/sourceUrl/);
  });
});

describe("OwnAvatarImage", () => {
  const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const SEAL = <span data-testid="seal">A</span>;
  const row = (dataUrl: string, at = 1) => ({
    pubkey: "a".repeat(64),
    dataUrl,
    sourceUrl: "https://images.example/a.png",
    at,
  });

  it("renders a data: URL at a fixed size, named for the identity", () => {
    const container = render(<OwnAvatarImage avatar={row(PNG)} alt="Alice" size={28} fallback={SEAL} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(PNG);
    expect(img?.getAttribute("alt")).toBe("Alice");
    expect(img?.getAttribute("width")).toBe("28");
    expect(img?.getAttribute("height")).toBe("28");
  });

  it.each([
    ["an https URL", "https://relay-chosen-host.example/a.png"],
    ["an http URL", "http://relay-chosen-host.example/a.png"],
    ["an svg data URL", "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4="],
    ["a javascript: URL", "javascript:alert(1)"],
  ])("renders nothing for %s", (_name, value) => {
    const container = render(<OwnAvatarImage avatar={row(value)} alt="Alice" size={28} fallback={SEAL} />);
    expect(container.querySelector("img")).toBeNull();
    expect(remoteSources(container)).toEqual([]);
  });

  it("renders nothing, leaving the seal, when there is no copy", () => {
    const container = render(<OwnAvatarImage avatar={null} alt="Alice" size={28} fallback={SEAL} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the seal until the copy has loaded, then only the picture", () => {
    const container = render(<OwnAvatarImage avatar={row(PNG)} alt="Alice" size={28} fallback={SEAL} />);
    expect(container.querySelector('[data-testid="seal"]')).not.toBeNull();

    act(() => {
      container.querySelector("img")!.dispatchEvent(new Event("load"));
    });
    // A transparent picture must not have the initial showing through it.
    expect(container.querySelector('[data-testid="seal"]')).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("steps aside for the seal when the copy fails to decode", () => {
    const container = render(<OwnAvatarImage avatar={row(PNG)} alt="Alice" size={28} fallback={SEAL} />);
    act(() => {
      container.querySelector("img")!.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-testid="seal"]')).not.toBeNull();
  });

  it("shows a refreshed copy for the same key after an earlier copy failed to decode", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });

    act(() => root.render(<OwnAvatarImage avatar={row(PNG, 1)} alt="Alice" size={28} fallback={SEAL} />));
    act(() => {
      container.querySelector("img")!.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();

    act(() => root.render(<OwnAvatarImage avatar={row(PNG, 2)} alt="Alice" size={28} fallback={SEAL} />));
    expect(container.querySelector("img")?.getAttribute("src")).toBe(PNG);
  });
});

/**
 * The render boundary, asserted on rendered output rather than on
 * `isAllowedRemoteUrl` directly - the predicate has its own tests in
 * `tests/unit/domain/profile-metadata-bounds.test.ts`. What is covered here is
 * that `RemoteUrlField` applies the allowlist at the point of rendering,
 * independently of whatever validation the value already passed.
 *
 * This is defense in depth behind `validateProfileMetadata`, not a substitute
 * for it: a profile cached before the allowlist existed can still carry an
 * `http:` picture, and reaching a render path is not evidence that a value was
 * validated.
 */
describe("RemoteUrlField applies the https allowlist at the render boundary", () => {
  const REJECTED = [
    ["an http: URL", "http://relay-chosen-host.example/avatar.png"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["a file: URL", "file:///etc/passwd"],
  ] as const;

  function addRow(container: HTMLElement) {
    return container.querySelector('button[aria-label="Add Picture URL"]');
  }

  it.each(REJECTED)(
    "presents %s as an empty field, with no affordance and no leaked text",
    (_name, value) => {
      const container = render(
        <RemoteUrlField
          label="Picture URL"
          value={value}
          onAdd={vi.fn()}
          openLabel="Open picture in a new tab"
        />
      );

      // The empty-field control that invites the user to add a value.
      expect(addRow(container)).not.toBeNull();

      // The value must not be recoverable from the rendered output.
      expect(container.textContent).not.toContain(value);
      expect(container.innerHTML).not.toContain(value);

      expect(
        container.querySelector('button[aria-label="Copy Picture URL"]')
      ).toBeNull();
      expect(
        container.querySelector('button[aria-label="Open picture in a new tab"]')
      ).toBeNull();
    }
  );

  it("renders a rejected value and a genuinely empty field as the same control", () => {
    const rejected = render(
      <RemoteUrlField
        label="Picture URL"
        value="http://relay-chosen-host.example/avatar.png"
        onAdd={vi.fn()}
      />
    );
    const empty = render(
      <RemoteUrlField label="Picture URL" value="" onAdd={vi.fn()} />
    );

    // Neither exposes an inspection affordance...
    for (const container of [rejected, empty]) {
      expect(addRow(container)).not.toBeNull();
      expect(container.querySelectorAll("button")).toHaveLength(1);
    }

    // ...and they are indistinguishable in the output, which is the point: the
    // rejected value leaks nothing, while the field stays one the user may fill.
    expect(rejected.innerHTML).toBe(empty.innerHTML);
  });

  it("opens no tab for a value that fails the allowlist", () => {
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null as unknown as Window);

    const container = render(
      <RemoteUrlField
        label="Picture URL"
        value="javascript:alert(1)"
        onAdd={vi.fn()}
        openLabel="Open picture in a new tab"
      />
    );

    // There is no open control to press, so the only control the field renders
    // is the one that must NOT navigate.
    const controls = container.querySelectorAll("button");
    expect(controls).toHaveLength(1);
    for (const control of controls) click(control);

    expect(openSpy).not.toHaveBeenCalled();
  });

  it("keeps monospace text and both controls for an https value", () => {
    const value = "https://relay-chosen-host.example/avatar.png";
    const container = render(
      <RemoteUrlField
        label="Picture URL"
        value={value}
        onAdd={vi.fn()}
        openLabel="Open picture in a new tab"
      />
    );

    expect(addRow(container)).toBeNull();

    const mono = Array.from(container.querySelectorAll(".font-mono")).find(
      (node) => node.textContent === value
    );
    expect(mono).toBeDefined();

    expect(
      container.querySelector('button[aria-label="Copy Picture URL"]')
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Open picture in a new tab"]')
    ).not.toBeNull();

    // Still no fetch of the remote host to render the row.
    expect(remoteSources(container)).toEqual([]);
  });
});

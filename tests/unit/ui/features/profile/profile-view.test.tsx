/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProfileMetadata } from "@/domain/profile/types";
import type { UIKeyInfo } from "@/ui/state/KeyManagerContext";

type RpcRequest = { type: string; params: { pubkey?: string; forceFetch?: boolean; metadata?: ProfileMetadata } };

const client = vi.hoisted(() => ({
  rpc: vi.fn<(request: RpcRequest) => Promise<unknown>>(),
}));

const keys = vi.hoisted(() => ({ selected: null as unknown }));

vi.mock("@/infrastructure/messaging/client", () => client);

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => ({ selectedUnlockedKey: keys.selected }),
}));

const { ProfileView } = await import("@/ui/features/profile/components/ProfileView");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const HEX = "c".repeat(64);
const NPUB = `npub1${"c".repeat(58)}`;
const ACTIVE = {
  id: "key-main",
  label: "Main",
  publicKeyHex: HEX,
  publicKeyBech32: NPUB,
  isUnreadable: false,
  createdAt: 0,
} as UIKeyInfo;

const PUBLISHED: ProfileMetadata = {
  name: "alice",
  display_name: "Alice",
  about: "Signs things.",
  website: "https://alice.example",
  picture: "https://cdn.example/alice.png",
  nip05: "alice@alice.example",
  lud16: "alice@getalby.com",
};

let stored: ProfileMetadata | null;
let updateOutcome: (metadata: ProfileMetadata) => Promise<unknown>;

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root.render(<ProfileView />);
  });
  await flush();
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text
  );
}

function byLabel(label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`No control labelled ${label}`);
  return found;
}

function field(id: string): HTMLInputElement | HTMLTextAreaElement {
  const found = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!found) throw new Error(`No field ${id}`);
  return found;
}

function type(id: string, value: string) {
  const element = field(id);
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await flush();
}

function requests(type: string): RpcRequest[] {
  return client.rpc.mock.calls.map(([request]) => request).filter((request) => request.type === type);
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  keys.selected = ACTIVE;
  stored = { ...PUBLISHED };
  updateOutcome = async (metadata) => {
    stored = metadata;
    return { ok: true };
  };
  client.rpc.mockReset().mockImplementation(async (request) => {
    if (request.type === "profile.get") return stored;
    if (request.type === "profile.update") return updateOutcome(request.params.metadata!);
    throw new Error(`unexpected ${request.type}`);
  });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  consoleError.mockRestore();
});

describe("ProfileView without a key", () => {
  it("asks for a key and reads no profile", async () => {
    keys.selected = null;
    await mount();
    expect(container.textContent).toContain("Select a key to manage its Nostr profile.");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("ProfileView summary", () => {
  it("reads the active key's profile from cache first", async () => {
    await mount();
    expect(requests("profile.get")[0].params).toEqual({ pubkey: HEX, forceFetch: false });
  });

  it("holds placeholders and disables Edit while the first read is out", async () => {
    client.rpc.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(buttonByText("Edit Profile")?.disabled).toBe(true);
    expect(container.textContent).not.toContain("Publish a name and bio");
  });

  it("shows every published field, with URLs as inspectable text", async () => {
    await mount();
    const text = container.textContent ?? "";
    expect(text).toContain("Alice");
    expect(text).toContain("Signs things.");
    expect(text).toContain("https://alice.example");
    expect(text).toContain("https://cdn.example/alice.png");
    expect(text).toContain("alice@alice.example");
    expect(text).toContain("alice@getalby.com");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('section[aria-label="Active identity"] .seal')?.textContent).toBe("A");
    expect(buttonByText("Edit Profile")?.disabled).toBe(false);
  });

  it("invites publishing when nothing is published", async () => {
    stored = null;
    await mount();
    expect(container.textContent).toContain("Publish a name and bio so apps can show who you are.");
    expect(byLabel("Add Display Name")).toBeDefined();
    expect(byLabel("Add About")).toBeDefined();
    expect(byLabel("Add Website")).toBeDefined();
    expect(byLabel("Add Picture URL")).toBeDefined();
    expect(container.querySelector('section[aria-label="Active identity"] .seal')?.textContent).toBe("?");
  });

  it("treats a non-https website as absent rather than as a link", async () => {
    stored = { name: "alice", website: "http://alice.example" };
    await mount();
    expect(byLabel("Add Website")).toBeDefined();
    expect(container.textContent).not.toContain("http://alice.example");
  });

  it("shows a read failure with a retry that forces a relay fetch", async () => {
    client.rpc.mockRejectedValueOnce(new Error("relays unreachable"));
    await mount();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("relays unreachable");

    await click(buttonByText("Try again")!);
    expect(requests("profile.get").at(-1)?.params).toEqual({ pubkey: HEX, forceFetch: true });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("Alice");
  });

  it("refreshes from relays on demand", async () => {
    await mount();
    stored = { ...PUBLISHED, display_name: "Alice Updated" };
    await click(byLabel("Refresh profile from relays"));
    expect(requests("profile.get").at(-1)?.params.forceFetch).toBe(true);
    expect(container.textContent).toContain("Alice Updated");
  });
});

describe("ProfileView editing", () => {
  it("opens the editor pre-filled with the published values and counts characters", async () => {
    await mount();
    await click(buttonByText("Edit Profile")!);

    expect(container.textContent).toContain("Edit Profile");
    expect(field("name").value).toBe("alice");
    expect(field("about").value).toBe("Signs things.");
    expect(field("picture").value).toBe("https://cdn.example/alice.png");
    expect(field("website").value).toBe("https://alice.example");
    expect(field("nip05").value).toBe("alice@alice.example");
    expect(field("lud16").value).toBe("alice@getalby.com");
    expect(container.textContent).toContain("5/50");
    expect(container.textContent).toContain("13/500");
    expect(field("name").getAttribute("maxLength")).toBe("50");
  });

  it("opens on the field whose Add row was pressed", async () => {
    stored = null;
    await mount();
    await click(byLabel("Add Website"));
    expect(document.activeElement).toBe(field("website"));
  });

  it.each([
    ["Add Display Name", "name"],
    ["Add About", "about"],
    ["Add Picture URL", "picture"],
  ])("focuses the matching input from %s", async (label, id) => {
    stored = null;
    await mount();
    await click(byLabel(label));
    expect(document.activeElement).toBe(field(id));
  });

  it("sends trimmed values and drops cleared fields on save", async () => {
    await mount();
    await click(buttonByText("Edit Profile")!);
    type("name", "  bob  ");
    type("about", "   ");
    type("banner", " https://cdn.example/banner.png ");
    type("nip05", "");
    expect(container.textContent).toContain("7/50");

    await click(buttonByText("Save Changes")!);

    const sent = requests("profile.update");
    expect(sent).toHaveLength(1);
    expect(sent[0].params.metadata).toEqual({
      name: "bob",
      display_name: "Alice",
      picture: "https://cdn.example/alice.png",
      banner: "https://cdn.example/banner.png",
      website: "https://alice.example",
      lud16: "alice@getalby.com",
    });
    expect(requests("profile.get").at(-1)?.params.forceFetch).toBe(true);
    expect(container.textContent).toContain("Profile Settings");
    expect(container.textContent).not.toContain("Signs things.");
  });

  it("shows the refusal and keeps the user's input when save fails", async () => {
    updateOutcome = async () => {
      throw new Error("URL must use the https: scheme");
    };
    await mount();
    await click(buttonByText("Edit Profile")!);
    type("website", "http://alice.example");

    await click(buttonByText("Save Changes")!);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "URL must use the https: scheme"
    );
    expect(field("website").value).toBe("http://alice.example");
    expect(buttonByText("Save Changes")?.disabled).toBe(false);
    expect(requests("profile.update")[0].params.metadata?.website).toBe("http://alice.example");
  });

  it("uses a generic message when the refusal is not an Error", async () => {
    updateOutcome = async () => {
      throw "rejected";
    };
    await mount();
    await click(buttonByText("Edit Profile")!);
    await click(buttonByText("Save Changes")!);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not save the profile. Try again.");
  });

  it("locks the form while saving", async () => {
    let release: () => void = () => {};
    updateOutcome = () => new Promise((resolve) => (release = () => resolve({ ok: true })));
    await mount();
    await click(buttonByText("Edit Profile")!);
    await click(buttonByText("Save Changes")!);

    expect(buttonByText("Saving...")?.disabled).toBe(true);
    expect(buttonByText("Cancel")?.disabled).toBe(true);
    expect(field("name").disabled).toBe(true);
    expect(field("about").disabled).toBe(true);

    await act(async () => release());
    await flush();
    expect(container.textContent).toContain("Profile Settings");
  });

  it("discards edits on cancel without publishing", async () => {
    await mount();
    await click(buttonByText("Edit Profile")!);
    type("name", "mallory");
    await click(buttonByText("Cancel")!);

    expect(requests("profile.update")).toHaveLength(0);
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).not.toContain("mallory");

    await click(buttonByText("Edit Profile")!);
    expect(field("name").value).toBe("alice");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("offers Remove for a filled picture and clears it", async () => {
    await mount();
    await click(buttonByText("Edit Profile")!);
    await click(buttonByText("Remove")!);
    expect(field("picture").value).toBe("");
    expect(buttonByText("Remove")).toBeUndefined();
  });
});

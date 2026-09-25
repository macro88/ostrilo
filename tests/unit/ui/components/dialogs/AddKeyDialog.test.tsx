/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddKeyDialog } from "@/ui/components/dialogs/AddKeyDialog";
import { KeyManagerProvider } from "@/ui/state/KeyManagerContext";
import { background } from "../../features/onboarding/fake-background";
import {
  button,
  click,
  input,
  maybeButton,
  render,
  setValue,
  settle,
  silenceConsole,
  unmountAll,
} from "../../features/onboarding/dom";

vi.mock(
  "wxt/browser",
  async () => (await import("../../features/onboarding/fake-background")).wxtBrowserModule
);

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
const PASSWORD = "Violet-Harbor-Quill-8472-otter";

function Harness({ onSuccess }: { onSuccess?: (keyId: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <KeyManagerProvider>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <AddKeyDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        onSuccess={onSuccess}
      />
    </KeyManagerProvider>
  );
}

const body = () => document.body;

function dialog() {
  return body().querySelector("[role='dialog']");
}

function title() {
  return dialog()?.querySelector("h2")?.textContent ?? "";
}

async function pressEscape() {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
  });
}

beforeEach(() => {
  silenceConsole();
  background.reset();
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("add key dialog", () => {
  it("offers a choice between creating and importing", () => {
    render(<Harness />);

    expect(title()).toBe("Add New Key");
    expect(maybeButton(body(), "Create New KeyGenerate a fresh Nostr key")).toBeDefined();
    expect(body().querySelector("#privateKey")).toBeNull();
    expect(body().querySelector("#password")).toBeNull();
  });

  it("opens the create form and returns to the choice on Back", async () => {
    render(<Harness />);

    await click(button(body(), "Create New KeyGenerate a fresh Nostr key"));
    expect(title()).toBe("Create New Key");
    expect(body().querySelector("#password")).not.toBeNull();
    expect(body().querySelector("#privateKey")).toBeNull();

    await click(button(body(), "Back"));
    expect(title()).toBe("Add New Key");
  });

  it("opens the import form and returns to the choice on Back", async () => {
    render(<Harness />);

    await click(button(body(), "Import Existing KeyPaste an existing nsec or hex key"));
    expect(title()).toBe("Import Existing Key");
    expect(body().querySelector("#privateKey")).not.toBeNull();

    await click(button(body(), "Back"));
    expect(title()).toBe("Add New Key");
  });

  it("starts from the choice again after being dismissed mid-flow", async () => {
    render(<Harness />);
    await click(button(body(), "Import Existing KeyPaste an existing nsec or hex key"));
    setValue(input(body(), "#privateKey"), NSEC);

    await pressEscape();
    expect(dialog()).toBeNull();

    await click(button(body(), "Reopen"));
    expect(title()).toBe("Add New Key");
    expect(body().querySelector("#privateKey")).toBeNull();
  });

  it("closes and reports success once a key is created", async () => {
    const onSuccess = vi.fn();
    render(<Harness onSuccess={onSuccess} />);
    await click(button(body(), "Create New KeyGenerate a fresh Nostr key"));
    setValue(input(body(), "#password"), PASSWORD);
    setValue(input(body(), "#keyName"), "Work");

    await click(button(body(), "Create Key"));
    await settle(() => dialog() === null);

    expect(background.sent("vault.generate")).toEqual([
      { type: "vault.generate", password: PASSWORD, label: "Work" },
    ]);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    await click(button(body(), "Reopen"));
    expect(title()).toBe("Add New Key");
  });

  it("closes after an import even when nobody listens for success", async () => {
    render(<Harness />);
    await click(button(body(), "Import Existing KeyPaste an existing nsec or hex key"));
    setValue(input(body(), "#privateKey"), NSEC);
    setValue(input(body(), "#password"), PASSWORD);
    setValue(input(body(), "#keyName"), "Recovered");

    await click(button(body(), "Import Key"));
    await settle(() => dialog() === null);

    expect(background.sent("vault.import")).toHaveLength(1);
  });
});

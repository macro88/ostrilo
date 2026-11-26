/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadConsentDialog } from "@/ui/features/profile/components/UploadConsentDialog";
import { BLOSSOM_SERVERS } from "@/domain/blossom/servers";
import { button, click, render, unmountAll } from "../onboarding/dom";

afterEach(() => unmountAll());

function mount(props: {
  animated?: boolean;
  remembered?: "primal" | "nostr-build" | "nostrcheck";
} = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <UploadConsentDialog
      animated={props.animated ?? false}
      remembered={props.remembered}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
  return { onConfirm, onCancel };
}

const dialog = () => {
  const found = document.querySelector<HTMLElement>("[role='dialog']");
  if (!found) throw new Error("the dialog is not open");
  return found;
};
const radios = () =>
  Array.from(dialog().querySelectorAll<HTMLInputElement>("input[type='radio']"));
const uploadButton = () => button(dialog(), "Upload");

async function choose(id: string) {
  const radio = radios().find((candidate) => candidate.value === id);
  if (!radio) throw new Error(`no radio for ${id}`);
  await click(radio);
}

describe("UploadConsentDialog", () => {
  it("opens as a labelled dialog with a title and a description", () => {
    mount();

    const element = dialog();
    expect(element.getAttribute("aria-labelledby")).toBeTruthy();
    expect(element.getAttribute("aria-describedby")).toBeTruthy();
    expect(element.textContent).toContain("Upload this image");
  });

  it("offers every curated server, by name and host, in a labelled group", () => {
    mount();

    const group = dialog().querySelector("fieldset");
    expect(group?.querySelector("legend")?.textContent).toBe("Upload to");
    expect(radios().map((radio) => radio.value)).toEqual(
      BLOSSOM_SERVERS.map((server) => server.id)
    );
    for (const server of BLOSSOM_SERVERS) {
      expect(dialog().textContent).toContain(server.name);
      expect(dialog().textContent).toContain(new URL(server.origin).host);
    }
  });

  it("preselects nothing, and keeps Upload disabled, until a host is chosen", async () => {
    const { onConfirm } = mount();

    expect(radios().some((radio) => radio.checked)).toBe(false);
    expect(uploadButton().disabled).toBe(true);

    await click(uploadButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("enables Upload once a host is chosen and confirms exactly that host", async () => {
    const { onConfirm, onCancel } = mount();

    await choose("nostr-build");
    expect(uploadButton().disabled).toBe(false);
    await click(uploadButton());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("nostr-build");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("preselects the remembered host but still waits for confirmation", async () => {
    const { onConfirm } = mount({ remembered: "nostrcheck" });

    expect(radios().find((radio) => radio.checked)?.value).toBe("nostrcheck");
    expect(uploadButton().disabled).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();

    await click(uploadButton());
    expect(onConfirm).toHaveBeenCalledWith("nostrcheck");
  });

  it("lets the user pick another host than the remembered one", async () => {
    const { onConfirm } = mount({ remembered: "primal" });

    await choose("nostrcheck");
    await click(uploadButton());

    expect(onConfirm).toHaveBeenCalledWith("nostrcheck");
  });

  it("says what the host will see, that the image is public, and that hosts may remove files", () => {
    mount();

    const text = dialog().textContent ?? "";
    expect(text).toContain("image");
    expect(text).toContain("IP address");
    expect(text).toContain("public key");
    expect(text).toMatch(/public/i);
    expect(text).toMatch(/remove/i);
    expect(text).toMatch(/keep the original/i);
  });

  it("says a still image is re-encoded and its embedded details removed", () => {
    mount({ animated: false });

    const text = dialog().textContent ?? "";
    expect(text).toContain("re-encoded");
    expect(text).toContain("embedded details");
    expect(text).not.toContain("uploaded unchanged");
  });

  it("says an animated image goes unchanged and keeps its embedded details", () => {
    mount({ animated: true });

    const text = dialog().textContent ?? "";
    expect(text).toContain("animated");
    expect(text).toContain("uploaded unchanged");
    expect(text).toContain("stay in it");
    expect(text).not.toContain("re-encoded");
  });

  it("cancels from the Cancel button, without confirming", async () => {
    const { onConfirm, onCancel } = mount({ remembered: "primal" });

    await click(button(dialog(), "Cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels on Escape", async () => {
    const { onConfirm, onCancel } = mount({ remembered: "primal" });

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels on the Close control", async () => {
    const { onConfirm, onCancel } = mount({ remembered: "primal" });

    await click(button(dialog(), "Close"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("has exactly one primary action, and no emoji or exclamation marks in its copy", () => {
    mount();

    const text = dialog().textContent ?? "";
    expect(text).not.toContain("!");
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(dialog().querySelectorAll(".btn-ink")).toHaveLength(1);
  });
});

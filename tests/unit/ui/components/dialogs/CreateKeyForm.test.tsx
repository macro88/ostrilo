/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateKeyForm } from "@/ui/components/dialogs/CreateKeyForm";
import { KeyManagerProvider } from "@/ui/state/KeyManagerContext";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { background } from "../../features/onboarding/fake-background";
import {
  alertText,
  button,
  click,
  input,
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

const PASSWORD = "Violet-Harbor-Quill-8472-otter";

function mount() {
  const onSuccess = vi.fn();
  const onBack = vi.fn();
  const { container, unmount } = render(
    <KeyManagerProvider>
      <CreateKeyForm onSuccess={onSuccess} onBack={onBack} />
    </KeyManagerProvider>
  );
  return { container, unmount, onSuccess, onBack };
}

async function submitAndSettle(container: HTMLElement) {
  await click(button(container, "Create Key"));
  await settle(() => !container.textContent?.includes("Creating..."));
}

beforeEach(() => {
  silenceConsole();
  background.reset();
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("create key form", () => {
  it("refuses to generate without the vault password", async () => {
    const { container, onSuccess } = mount();
    setValue(input(container, "#keyName"), "Work");

    await submitAndSettle(container);

    expect(alertText(container)).toBe("Password is required");
    expect(background.sent("vault.generate")).toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("refuses to generate a key with a blank name", async () => {
    const { container } = mount();
    setValue(input(container, "#password"), PASSWORD);
    setValue(input(container, "#keyName"), "   ");

    await submitAndSettle(container);

    expect(alertText(container)).toBe("Key name is required");
    expect(background.sent("vault.generate")).toHaveLength(0);
  });

  it("sends the password and trimmed name, then clears the password", async () => {
    const { container, onSuccess } = mount();
    setValue(input(container, "#password"), PASSWORD);
    setValue(input(container, "#keyName"), "  Work  ");

    await submitAndSettle(container);

    expect(background.sent("vault.generate")).toEqual([
      { type: "vault.generate", password: PASSWORD, label: "Work" },
    ]);
    expect(input(container, "#password").value).toBe("");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(alertText(container)).toBe("");
  });

  it("shows the vault's refusal and does not report success", async () => {
    background.fail("vault.generate", RPC_ERROR_CODES.INVALID_PASSWORD);
    const { container, onSuccess } = mount();
    setValue(input(container, "#password"), PASSWORD);
    setValue(input(container, "#keyName"), "Work");

    await submitAndSettle(container);

    expect(alertText(container)).toContain("That is not your vault password.");
    expect(alertText(container)).not.toContain(PASSWORD);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("drops the password after the vault refuses it", async () => {
    background.fail("vault.generate", RPC_ERROR_CODES.INVALID_PASSWORD);
    const { container } = mount();
    setValue(input(container, "#password"), PASSWORD);
    setValue(input(container, "#keyName"), "Work");

    await submitAndSettle(container);

    expect(alertText(container)).toContain("That is not your vault password.");
    expect(input(container, "#password").value).toBe("");
  });

  it("leaves no password in the input once the form unmounts", () => {
    const { container, unmount } = mount();
    setValue(input(container, "#password"), PASSWORD);
    const passwordInput = input(container, "#password");

    unmount();

    expect(passwordInput.value).toBe("");
  });

  it("locks the form while the key is being generated", async () => {
    const release = background.hold("vault.generate");
    const { container } = mount();
    setValue(input(container, "#password"), PASSWORD);
    setValue(input(container, "#keyName"), "Work");

    await click(button(container, "Create Key"));
    await settle(() => background.sent("vault.generate").length === 1);

    expect(button(container, "Creating...").disabled).toBe(true);
    expect(button(container, "Back").disabled).toBe(true);
    expect(input(container, "#password").disabled).toBe(true);
    expect(input(container, "#keyName").disabled).toBe(true);

    release();
    await settle(() => !container.textContent?.includes("Creating..."));
  });

  it("goes back without generating anything", async () => {
    const { container, onBack } = mount();
    setValue(input(container, "#password"), PASSWORD);

    await click(button(container, "Back"));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(background.sent("vault.generate")).toHaveLength(0);
  });
});

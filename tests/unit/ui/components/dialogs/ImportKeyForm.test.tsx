/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportKeyForm } from "@/ui/components/dialogs/ImportKeyForm";
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

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
const HEX = "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa";
const PASSWORD = "Violet-Harbor-Quill-8472-otter";

function mount() {
  const onSuccess = vi.fn();
  const onBack = vi.fn();
  const { container, unmount } = render(
    <KeyManagerProvider>
      <ImportKeyForm onSuccess={onSuccess} onBack={onBack} />
    </KeyManagerProvider>
  );
  return { container, unmount, onSuccess, onBack };
}

function fill(
  container: HTMLElement,
  values: { key?: string; password?: string; name?: string }
) {
  if (values.key !== undefined) setValue(input(container, "#privateKey"), values.key);
  if (values.password !== undefined) {
    setValue(input(container, "#password"), values.password);
  }
  if (values.name !== undefined) setValue(input(container, "#keyName"), values.name);
}

async function submitAndSettle(container: HTMLElement) {
  await click(button(container, "Import Key"));
  await settle(() => !container.textContent?.includes("Importing..."));
}

beforeEach(() => {
  silenceConsole();
  background.reset();
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("import key form requires every field before anything is sent", () => {
  it.each([
    [{ password: PASSWORD, name: "Work" }, "Private key is required"],
    [{ key: NSEC, name: "Work" }, "Password is required"],
    [{ key: NSEC, password: PASSWORD, name: "   " }, "Key name is required"],
  ])("refuses %o with %s", async (values, message) => {
    const { container, onSuccess } = mount();
    fill(container, values);

    await submitAndSettle(container);

    expect(alertText(container)).toBe(message);
    expect(background.sent("crypto.parsePrivateKey")).toHaveLength(0);
    expect(background.sent("vault.import")).toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe("import key form rejects malformed keys before the vault sees them", () => {
  it.each([
    ["an nsec with a broken checksum", `${NSEC.slice(0, -1)}q`],
    ["a hex key one character short", HEX.slice(1)],
    ["hex with a non-hex character", `${HEX.slice(0, -1)}g`],
  ])("rejects %s", async (_label, badKey) => {
    const { container, onSuccess } = mount();
    fill(container, { key: badKey, password: PASSWORD, name: "Work" });

    await submitAndSettle(container);

    expect(alertText(container)).toContain("That is not a valid private key.");
    expect(alertText(container)).not.toContain(badKey);
    expect(background.sent("crypto.parsePrivateKey")).toHaveLength(1);
    expect(background.sent("vault.import")).toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe("import key form hands a valid key to the vault once", () => {
  it.each([
    ["nsec", NSEC],
    ["hex", HEX],
  ])("imports a %s key and clears it from the inputs", async (_format, key) => {
    const { container, onSuccess } = mount();
    fill(container, { key: `  ${key}  `, password: PASSWORD, name: "  Work  " });

    await submitAndSettle(container);

    expect(background.sent("vault.import")).toEqual([
      { type: "vault.import", keyInput: key, password: PASSWORD, label: "Work" },
    ]);
    expect(input(container, "#privateKey").value).toBe("");
    expect(input(container, "#password").value).toBe("");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("shows the vault's refusal and does not report success", async () => {
    background.fail("vault.import", RPC_ERROR_CODES.KEY_ALREADY_EXISTS);
    const { container, onSuccess } = mount();
    fill(container, { key: NSEC, password: PASSWORD, name: "Work" });

    await submitAndSettle(container);

    expect(alertText(container)).toContain("This key is already in your vault.");
    expect(alertText(container)).not.toContain(NSEC);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("drops the password but keeps the key after the vault refuses", async () => {
    background.fail("vault.import", RPC_ERROR_CODES.INVALID_PASSWORD);
    const { container } = mount();
    fill(container, { key: NSEC, password: PASSWORD, name: "Work" });

    await submitAndSettle(container);

    expect(alertText(container)).toContain("That is not your vault password.");
    expect(input(container, "#password").value).toBe("");
    expect(input(container, "#privateKey").value).toBe(NSEC);
  });

  it("leaves no key or password in the inputs once the form unmounts", () => {
    const { container, unmount } = mount();
    fill(container, { key: NSEC, password: PASSWORD, name: "Work" });
    const keyInput = input(container, "#privateKey");
    const passwordInput = input(container, "#password");

    unmount();

    expect(keyInput.value).toBe("");
    expect(passwordInput.value).toBe("");
  });

  it("locks the form while the import is in flight", async () => {
    const release = background.hold("vault.import");
    const { container } = mount();
    fill(container, { key: NSEC, password: PASSWORD, name: "Work" });

    await click(button(container, "Import Key"));
    await settle(() => background.sent("vault.import").length === 1);

    expect(button(container, "Importing...").disabled).toBe(true);
    expect(button(container, "Back").disabled).toBe(true);
    expect(input(container, "#privateKey").disabled).toBe(true);
    expect(input(container, "#password").disabled).toBe(true);

    release();
    await settle(() => !container.textContent?.includes("Importing..."));
    expect(button(container, "Import Key").disabled).toBe(false);
  });
});

describe("import key form controls", () => {
  it("masks the key until the user asks to see it", async () => {
    const { container } = mount();
    const field = input(container, "#privateKey");
    expect(field.type).toBe("password");

    await click(button(container, "Show private key"));
    expect(field.type).toBe("text");

    await click(button(container, "Hide private key"));
    expect(field.type).toBe("password");
  });

  it("leaves without submitting when the user goes back", async () => {
    const { container, onBack } = mount();
    fill(container, { key: NSEC, password: PASSWORD, name: "Work" });

    await click(button(container, "Back"));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(background.sent("crypto.parsePrivateKey")).toHaveLength(0);
    expect(background.sent("vault.import")).toHaveLength(0);
  });
});

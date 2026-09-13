/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ComponentProps, ReactNode } from "react";
import { OnboardingCreateKeyBackupStep } from "@/ui/features/onboarding/components/OnboardingCreateKeyBackupStep";
import { OnboardingImportKeyStep } from "@/ui/features/onboarding/components/OnboardingImportKeyStep";
import { VERIFICATION_SUFFIX_LENGTH } from "@/ui/features/onboarding/components/backup/BackupVerification";
import {
  createKeyBackup,
  serializeKeyBackup,
} from "@/ui/features/onboarding/backup/key-backup-envelope";

vi.mock("@/infrastructure/messaging/client", () => ({
  evaluatePasswordStrength: vi.fn().mockResolvedValue({
    acceptable: true,
    violations: [],
    requirements: [],
    score: 4,
    blocklistChecked: true,
  }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
const HEX = "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa";

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function render(ui: ReactNode): {
  container: HTMLDivElement;
  rerender: (next: ReactNode) => void;
} {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return {
    container,
    rerender: (next: ReactNode) => act(() => root.render(next)),
  };
}

function click(element: Element | null) {
  if (!element) throw new Error("element not found");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.clearAllMocks();
});

const noop = () => {};

function backupStep(overrides: Record<string, unknown> = {}) {
  const props = {
    getNsec: () => NSEC,
    getBackupPayload: () => ({ nsec: NSEC, hex: HEX, name: "k" }),
    revealNonce: 1,
    showPrivateKey: false,
    hasRevealedPrivateKey: true,
    showTranscription: false,
    clipboardStatus: "idle" as const,
    clipboardSecondsRemaining: 0,
    clipboardWindowSeconds: 45,
    backupFileSaved: false,
    verified: false,
    acknowledged: false,
    revealError: "",
    onReveal: noop,
    onToggleShowPrivateKey: noop,
    onToggleTranscription: noop,
    onCopy: noop,
    onClearClipboard: noop,
    onBackupFileSaved: noop,
    onVerifySuffix: (value: string) =>
      value.toLowerCase() === NSEC.slice(-VERIFICATION_SUFFIX_LENGTH),
    onVerifyNsec: (nsec: string) => nsec === NSEC,
    onVerified: noop,
    onAcknowledgedChange: noop,
    onBack: noop,
    onFinish: noop,
    ...overrides,
  };
  return (
    <OnboardingCreateKeyBackupStep
      {...(props as unknown as ComponentProps<typeof OnboardingCreateKeyBackupStep>)}
    />
  );
}

describe("backup step keeps key material out of the browser's machinery", () => {
  it("does not mask the nsec with type=password", () => {
    const { container } = render(backupStep());
    const input = container.querySelector<HTMLInputElement>("#privateKey");

    // `type="password"` is the primary signal browser password managers key
    // off. A read-only field using it to mask an nsec is close to a guarantee
    // of capture into a vault the user never chose.
    expect(input?.getAttribute("type")).toBe("text");
    expect(input?.readOnly).toBe(true);
  });

  it("opts every key field out of autofill, spell-check and managers", () => {
    const { container } = render(backupStep());
    const input = container.querySelector<HTMLInputElement>("#privateKey");

    expect(input?.getAttribute("autocomplete")).toBe("off");
    expect(input?.getAttribute("spellcheck")).toBe("false");
    expect(input?.hasAttribute("data-1p-ignore")).toBe(true);
    expect(input?.getAttribute("data-lpignore")).toBe("true");
    expect(input?.hasAttribute("data-bwignore")).toBe(true);
  });

  it("keeps the nsec out of the DOM while it is masked", () => {
    const { container, rerender } = render(backupStep());
    const input = container.querySelector<HTMLInputElement>("#privateKey");

    expect(input?.value).not.toContain("nsec1");
    expect(input?.value.length).toBe(NSEC.length);
    expect(container.innerHTML).not.toContain(NSEC);

    rerender(backupStep({ showPrivateKey: true }));
    expect(
      container.querySelector<HTMLInputElement>("#privateKey")?.value
    ).toBe(NSEC);
  });

  it("wipes the input value when the step unmounts", () => {
    const { container, rerender } = render(backupStep({ showPrivateKey: true }));
    const input = container.querySelector<HTMLInputElement>("#privateKey");
    expect(input?.value).toBe(NSEC);

    rerender(<div />);

    // The detached node must not still be holding the key.
    expect(input?.value).toBe("");
  });

  it("is not wrapped in a form, so nothing can be submitted or captured", () => {
    const { container } = render(backupStep());
    expect(container.querySelector("form")).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>("#privateKey")?.closest("form")
    ).toBeNull();
  });

  it("offers no QR code for the private key", () => {
    const { container } = render(backupStep({ showPrivateKey: true }));

    expect(container.textContent).not.toMatch(/QR/i);
    // `QRCodeModal` renders a <dialog> labelled by this id; `QRCodeSVG`
    // renders an <svg shape-rendering="crispEdges">. Neither is present, and
    // no control offers to produce one.
    expect(container.querySelector("#qr-code-title")).toBeNull();
    expect(container.querySelector("svg[shape-rendering]")).toBeNull();
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("shows the nsec in grouped mono blocks for transcription", () => {
    const { container } = render(backupStep({ showTranscription: true }));
    const panel = container.querySelector("[data-testid='nsec-transcription']");

    expect(panel?.textContent?.replace(/ /g, "")).toBe(NSEC);
    expect(panel?.textContent).toContain(" ");
    expect(panel?.className).toContain("font-mono");
  });
});

describe("backup step states what the user is risking", () => {
  it("announces the clipboard expiry before the copy, with its interval", () => {
    const { container } = render(backupStep());

    expect(container.textContent).toContain("45");
    expect(container.textContent).toMatch(/clears the clipboard automatically/i);
    expect(container.textContent).toMatch(/replaced/i);
  });

  it("says the identity is unrecoverable and that nobody can restore it", () => {
    const { container } = render(backupStep());

    expect(container.textContent).toMatch(/no recovery service/i);
    expect(container.textContent).toMatch(/permanently/i);
  });

  it("rewords the checkbox as understanding, not as evidence", () => {
    const { container } = render(backupStep());
    const label = container.querySelector("label[for='backupConfirm']");

    expect(label?.textContent).toMatch(/I understand/i);
    expect(label?.textContent).not.toMatch(/I have safely backed up/i);
  });
});

describe("backup verification gates completion", () => {
  function finishButton(container: HTMLElement) {
    return Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Finish")
    );
  }

  it("keeps Finish disabled until verification passes", () => {
    const { container } = render(backupStep());
    expect(finishButton(container)?.disabled).toBe(true);
  });

  it("leaves Finish disabled even when the checkbox is ticked", () => {
    const { container } = render(backupStep({ acknowledged: true }));
    expect(finishButton(container)?.disabled).toBe(true);
  });

  it("enables Finish once verification has passed", () => {
    const { container } = render(backupStep({ verified: true }));
    expect(finishButton(container)?.disabled).toBe(false);
  });

  it("accepts the correct suffix", () => {
    const onVerified = vi.fn();
    const { container } = render(backupStep({ onVerified }));
    const input = container.querySelector<HTMLInputElement>(
      "#backupVerification"
    )!;

    type(input, NSEC.slice(-VERIFICATION_SUFFIX_LENGTH));
    click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Check"
      )!
    );

    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it("rejects an incorrect suffix and invites another reveal", () => {
    const onVerified = vi.fn();
    const { container } = render(backupStep({ onVerified }));
    const input = container.querySelector<HTMLInputElement>(
      "#backupVerification"
    )!;

    type(input, "zzzzzzzz");
    click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Check"
      )!
    );

    expect(onVerified).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent).toMatch(
      /Reveal it again/i
    );
  });

  it("refuses a pasted answer on the verification field", () => {
    const { container } = render(backupStep());
    const input = container.querySelector<HTMLInputElement>(
      "#backupVerification"
    )!;

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(paste);
    });

    expect(paste.defaultPrevented).toBe(true);
  });

  it("offers the file route only after a file has been written", () => {
    const { container, rerender } = render(backupStep());
    expect(container.textContent).not.toContain("Use the saved file");

    rerender(backupStep({ backupFileSaved: true }));
    expect(container.textContent).toContain("Use the saved file");
  });
});

describe("onboarding import key input", () => {
  function importStep(overrides: Record<string, unknown> = {}) {
    const props = {
      keyName: "",
      showPrivateKey: false,
      importError: "",
      isLoading: false,
      privateKeyRef: { current: null },
      backupFileName: "",
      backupPassphrase: "",
      backupError: "",
      backupBusy: false,
      onBack: noop,
      onKeyNameChange: noop,
      onTogglePrivateKey: noop,
      onFileUpload: noop,
      onBackupPassphraseChange: noop,
      onUnlockBackup: noop,
      onCancelBackup: noop,
      onContinue: noop,
      ...overrides,
    };
    return (
      <OnboardingImportKeyStep
        {...(props as unknown as ComponentProps<typeof OnboardingImportKeyStep>)}
      />
    );
  }

  it("excludes the private key input from autofill and managers", () => {
    const { container } = render(importStep());
    const input = container.querySelector<HTMLInputElement>("#privateKey");

    expect(input?.getAttribute("type")).toBe("text");
    expect(input?.getAttribute("autocomplete")).toBe("off");
    expect(input?.getAttribute("spellcheck")).toBe("false");
    expect(input?.hasAttribute("data-1p-ignore")).toBe(true);
    expect(input?.getAttribute("data-lpignore")).toBe("true");
    expect(input?.hasAttribute("data-bwignore")).toBe(true);
  });

  it("asks for the backup passphrase when an encrypted backup is chosen", () => {
    const { container } = render(
      importStep({ backupFileName: "ostrilo-backup-2026-09-13.json" })
    );

    expect(container.textContent).toContain("ostrilo-backup-2026-09-13.json");
    expect(container.textContent).toMatch(/not your master password/i);
    expect(
      container.querySelector("#importBackupPassphrase")
    ).not.toBeNull();
  });

  it("is not wrapped in a form", () => {
    const { container } = render(importStep());
    expect(container.querySelector("form")).toBeNull();
  });
});

describe("backup verification: the encrypted file round-trip", () => {
  const PASSPHRASE = "correct-horse-battery-staple-42";

  /**
   * Argon2id yields to the event loop repeatedly (`asyncTick`), so a single
   * `act` flush is not enough to observe the result of a decrypt.
   */
  async function settle(predicate: () => boolean) {
    for (let i = 0; i < 100; i += 1) {
      if (predicate()) return;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }
    throw new Error("timed out waiting for the decrypt to settle");
  }

  async function chooseFile(container: HTMLElement, contents: string) {
    const input = container.querySelector<HTMLInputElement>("#backupFile")!;
    const file = new File([contents], "ostrilo-backup-2026-09-13.json", {
      type: "application/json",
    });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle(
      () => (container.querySelector("label[for='backupFile']")?.textContent ?? "")
        .includes("ostrilo-backup")
    );
  }

  async function clickCheckFile(container: HTMLElement) {
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent === "Check file")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function openFileRoute(overrides: Record<string, unknown> = {}) {
    const { container } = render(
      backupStep({ backupFileSaved: true, ...overrides })
    );
    click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Use the saved file"
      )!
    );
    return container;
  }

  it("passes verification when the file decrypts to this key", async () => {
    const onVerified = vi.fn();
    const container = openFileRoute({ onVerified });
    const envelope = await createKeyBackup(
      { nsec: NSEC, hex: HEX, name: "k" },
      PASSPHRASE
    );

    await chooseFile(container, serializeKeyBackup(envelope));
    type(
      container.querySelector<HTMLInputElement>("#backupFilePassphrase")!,
      PASSPHRASE
    );
    await clickCheckFile(container);
    await settle(() => onVerified.mock.calls.length > 0);

    expect(onVerified).toHaveBeenCalledTimes(1);
    // The decrypted key is compared and discarded, never rendered.
    expect(container.innerHTML).not.toContain(NSEC);
  });

  it("fails closed on the wrong passphrase without naming what was wrong", async () => {
    const onVerified = vi.fn();
    const container = openFileRoute({ onVerified });
    const envelope = await createKeyBackup(
      { nsec: NSEC, hex: HEX, name: "k" },
      PASSPHRASE
    );

    await chooseFile(container, serializeKeyBackup(envelope));
    type(
      container.querySelector<HTMLInputElement>("#backupFilePassphrase")!,
      "not-the-passphrase"
    );
    await clickCheckFile(container);
    await settle(() => container.querySelector("[role='alert']") !== null);

    expect(onVerified).not.toHaveBeenCalled();
    const alert = container.querySelector("[role='alert']")?.textContent ?? "";
    expect(alert).toContain("Check the passphrase");
    expect(alert).not.toContain("not-the-passphrase");
    expect(alert).not.toContain(NSEC.slice(0, 12));
  });

  it("rejects a file that is not an Ostrilo backup", async () => {
    const onVerified = vi.fn();
    const container = openFileRoute({ onVerified });

    // The legacy plaintext export is not an envelope and must not be accepted.
    await chooseFile(
      container,
      JSON.stringify({ name: "k", privateKey: NSEC, privateKeyHex: HEX })
    );
    type(
      container.querySelector<HTMLInputElement>("#backupFilePassphrase")!,
      PASSPHRASE
    );
    await clickCheckFile(container);
    await settle(() => container.querySelector("[role='alert']") !== null);

    expect(onVerified).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "not an Ostrilo encrypted backup"
    );
  });
});

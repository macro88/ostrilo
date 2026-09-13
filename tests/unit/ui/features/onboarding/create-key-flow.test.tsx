/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
const HEX = "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa";
const PASSWORD = "correct-horse-battery-staple-42";

const revealKey = vi.fn();
const generateKey = vi.fn();
const unlockVault = vi.fn();
const markOnboardingComplete = vi.fn();

vi.mock("@/infrastructure/messaging/client", () => ({
  revealKey: (...args: unknown[]) => revealKey(...args),
  generateKey: (...args: unknown[]) => generateKey(...args),
  unlockVault: (...args: unknown[]) => unlockVault(...args),
  evaluatePasswordStrength: vi.fn().mockResolvedValue({
    acceptable: true,
    violations: [],
    requirements: [],
    score: 4,
    blocklistChecked: true,
  }),
}));

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => ({ isLoading: false }),
}));

vi.mock("@/ui/features/onboarding/hooks/useOnboarding", () => ({
  useOnboarding: () => ({
    markOnboardingComplete: () => markOnboardingComplete(),
  }),
}));

import { OnboardingCreateKey } from "@/ui/features/onboarding/components/OnboardingCreateKey";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Whole-flow assertions for the properties that live in refs rather than state,
 * and therefore cannot be reached by a reducer test.
 *
 * `handleFinish` was the ONLY place that nulled `privateKeyRef` and
 * `passwordBackupRef`. Closing the popup mid-flow, or stepping back off the
 * backup step, left both populated with a live nsec and the master password.
 */

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function render(ui: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return {
    container,
    unmount: () => act(() => root.unmount()),
  };
}

function setValue(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(container: HTMLElement, text: string) {
  const found = Array.from(container.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.includes(text) || b.getAttribute("aria-label") === text
  );
  if (!found) throw new Error(`no button matching ${text}`);
  return found;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Drives input step -> backup step -> revealed. */
async function reachRevealedBackupStep(container: HTMLElement) {
  setValue(container.querySelector<HTMLInputElement>("#keyName")!, "Everyday");
  setValue(container.querySelector<HTMLInputElement>("#password")!, PASSWORD);
  setValue(
    container.querySelector<HTMLInputElement>("#confirm-password")!,
    PASSWORD
  );
  await click(button(container, "Create Key"));
  await click(button(container, "Reveal Private Key"));
}

beforeEach(() => {
  revealKey.mockResolvedValue({ nsec: NSEC, hex: HEX });
  generateKey.mockResolvedValue({ id: "k1" });
  unlockVault.mockResolvedValue(undefined);
  markOnboardingComplete.mockResolvedValue(undefined);
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.clearAllMocks();
});

describe("create-key flow drops key material on every exit", () => {
  it("reveals through the password-verified RPC, never a session-only path", async () => {
    const { container } = render(
      <OnboardingCreateKey onBack={() => {}} onComplete={() => {}} />
    );
    await reachRevealedBackupStep(container);

    // The password the user typed, handed back to `revealKey` for
    // re-verification against the record.
    expect(revealKey).toHaveBeenCalledWith(PASSWORD);
    expect(container.textContent).toContain("Backup Your Key");
  });

  it("clears the revealed key when the user steps back", async () => {
    const { container } = render(
      <OnboardingCreateKey onBack={() => {}} onComplete={() => {}} />
    );
    await reachRevealedBackupStep(container);
    await click(button(container, "Show private key"));
    expect(container.querySelector<HTMLInputElement>("#privateKey")?.value).toBe(
      NSEC
    );

    await click(button(container, "Back"));

    // Back on the input step: no key anywhere, and the password fields that
    // `clearSensitiveState` used to leave populated are empty.
    expect(container.innerHTML).not.toContain(NSEC);
    expect(container.querySelector<HTMLInputElement>("#password")?.value).toBe(
      ""
    );
    expect(
      container.querySelector<HTMLInputElement>("#confirm-password")?.value
    ).toBe("");
  });

  it("requires another password-verified reveal after stepping back", async () => {
    const { container } = render(
      <OnboardingCreateKey onBack={() => {}} onComplete={() => {}} />
    );
    await reachRevealedBackupStep(container);
    await click(button(container, "Back"));

    // The password ref went with the reset, so the flow can no longer reveal.
    setValue(container.querySelector<HTMLInputElement>("#keyName")!, "Everyday");
    setValue(container.querySelector<HTMLInputElement>("#password")!, PASSWORD);
    setValue(
      container.querySelector<HTMLInputElement>("#confirm-password")!,
      PASSWORD
    );
    await click(button(container, "Create Key"));
    expect(container.textContent).toContain("Reveal Private Key");
    expect(container.innerHTML).not.toContain(NSEC);
  });

  it("leaves no key material behind on a failed reveal", async () => {
    revealKey.mockRejectedValue(new Error("incorrect_password"));
    const { container } = render(
      <OnboardingCreateKey onBack={() => {}} onComplete={() => {}} />
    );
    await reachRevealedBackupStep(container);

    expect(container.innerHTML).not.toContain(NSEC);
    // The message comes from the RPC layer and carries no key bytes.
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "incorrect_password"
    );
    // Still offering a reveal, so the flow did not record a phantom success.
    expect(container.textContent).toContain("Reveal Private Key");
  });

  it("clears the clipboard when the document goes away", async () => {
    const { container, unmount } = render(
      <OnboardingCreateKey onBack={() => {}} onComplete={() => {}} />
    );
    await reachRevealedBackupStep(container);
    await click(button(container, "Copy key"));

    const writeText = globalThis.navigator.clipboard.writeText as ReturnType<
      typeof vi.fn
    >;
    expect(writeText).toHaveBeenCalledWith(NSEC);
    writeText.mockClear();

    unmount();

    expect(writeText).toHaveBeenCalledWith("");
  });

  it("will not finish until the backup is verified", async () => {
    const onComplete = vi.fn();
    const { container } = render(
      <OnboardingCreateKey onBack={() => {}} onComplete={onComplete} />
    );
    await reachRevealedBackupStep(container);

    await click(button(container, "Finish"));
    expect(onComplete).not.toHaveBeenCalled();
    expect(markOnboardingComplete).not.toHaveBeenCalled();

    setValue(
      container.querySelector<HTMLInputElement>("#backupVerification")!,
      NSEC.slice(-8)
    );
    await click(button(container, "Check"));
    await click(button(container, "Finish"));

    expect(markOnboardingComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).not.toContain(NSEC);
  });
});

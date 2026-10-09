/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingContainer } from "@/ui/features/onboarding/components/OnboardingContainer";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "@/infrastructure/messaging/error-codes";
import { KeyManagerProvider } from "@/ui/state/KeyManagerContext";
import { background } from "./fake-background";
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
} from "./dom";

const markOnboardingComplete = vi.hoisted(() => vi.fn());

vi.mock("wxt/browser", async () => (await import("./fake-background")).wxtBrowserModule);

vi.mock("@/ui/features/onboarding/hooks/useOnboarding", () => ({
  useOnboarding: () => ({ markOnboardingComplete }),
}));

const PASSWORD = "Violet-Harbor-Quill-8472-otter"; // gitleaks:allow
const QUICK = "Quick startJust a password. Back up later";
const NOTICE =
  "This creates a new identity on this browser. You can back it up later. If you lose access to this browser before making a backup, you may lose access to this identity.";

function mount() {
  const onComplete = vi.fn();
  const view = render(
    <KeyManagerProvider>
      <OnboardingContainer onComplete={onComplete} />
    </KeyManagerProvider>
  );
  return { ...view, onComplete };
}

async function fillPasswords(container: HTMLElement, password = PASSWORD) {
  await settle(() => container.querySelector("#password") !== null);
  setValue(input(container, "#password"), password);
  setValue(input(container, "#confirm-password"), password);
}

async function openQuickStart(container: HTMLElement) {
  await click(button(container, QUICK));
  expect(container.textContent).toContain("Quick start");
}

beforeEach(() => {
  silenceConsole();
  background.reset();
  markOnboardingComplete.mockResolvedValue(undefined);
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("Quick start on the welcome screen", () => {
  it("is offered beside create and import", () => {
    const { container } = mount();

    expect(maybeButton(container, QUICK)).toBeDefined();
    expect(container.textContent).toContain("Create New Key");
    expect(container.textContent).toContain("Import Existing Key");
  });

  it("returns to the welcome screen on Back without touching the vault", async () => {
    const { container } = mount();
    await openQuickStart(container);

    await click(button(container, "Back"));

    expect(container.textContent).toContain("Welcome to Ostrilo");
    expect(background.sent("vault.generate")).toHaveLength(0);
  });
});

describe("Quick start flow", () => {
  it("makes one key, unlocks, shows the notice, and goes to Home with no backup step", async () => {
    const { container, onComplete } = mount();
    await openQuickStart(container);
    await fillPasswords(container);

    await click(button(container, "Create identity"));
    await settle(() => container.textContent?.includes("Your identity is ready") ?? false);

    expect(background.sent("vault.generate")).toHaveLength(1);
    expect(background.sent("vault.generate")[0].password).toBe(PASSWORD);
    expect(background.sent("vault.unlock")).toHaveLength(1);
    expect(container.querySelector("[role='note']")?.textContent).toBe(NOTICE);

    // Nothing that reveals, saves or quizzes, and nothing marks it backed up.
    expect(container.textContent).not.toMatch(/nsec1/i);
    expect(maybeButton(container, "Reveal Private Key")).toBeUndefined();
    expect(background.sent("vault.reveal")).toHaveLength(0);
    expect(background.sent("backup.markVerified")).toHaveLength(0);

    await click(button(container, "Continue"));
    await settle(() => onComplete.mock.calls.length > 0);
    expect(markOnboardingComplete).toHaveBeenCalledTimes(1);
  });

  it("leaves no password in the document once the key exists", async () => {
    const { container } = mount();
    await openQuickStart(container);
    await fillPasswords(container);
    await click(button(container, "Create identity"));
    await settle(() => container.textContent?.includes("Your identity is ready") ?? false);

    expect(container.querySelector("input")).toBeNull();
    expect(container.innerHTML).not.toContain(PASSWORD);
  });

  it("refuses mismatched passwords before any key is made", async () => {
    const { container } = mount();
    await openQuickStart(container);
    await settle(() => container.querySelector("#password") !== null);
    setValue(input(container, "#password"), PASSWORD);
    setValue(input(container, "#confirm-password"), `${PASSWORD}x`);

    await click(button(container, "Create identity"));

    expect(container.textContent).toContain("Passwords do not match");
    expect(background.sent("vault.generate")).toHaveLength(0);
  });

  it("refuses a password the policy rejects before any key is made", async () => {
    const { container } = mount();
    await openQuickStart(container);
    await fillPasswords(container, "password1");

    await click(button(container, "Create identity"));
    await settle(
      () => input(container, "#password").getAttribute("aria-invalid") === "true"
    );

    expect(background.sent("vault.generate")).toHaveLength(0);
    expect(container.textContent).not.toContain("Your identity is ready");
  });

  it("makes one key however many times Create is pressed", async () => {
    const release = background.hold("vault.generate");
    const { container } = mount();
    await openQuickStart(container);
    await fillPasswords(container);
    const create = button(container, "Create identity");

    // Three clicks before React has re-rendered the button as disabled.
    await act(async () => {
      create.click();
      create.click();
      create.click();
    });
    release();
    await settle(() => container.textContent?.includes("Your identity is ready") ?? false);

    expect(background.sent("vault.generate")).toHaveLength(1);
  });

  it("asks the background to generate only into an empty vault", async () => {
    const { container } = mount();
    await openQuickStart(container);
    await fillPasswords(container);

    await click(button(container, "Create identity"));
    await settle(() => container.textContent?.includes("Your identity is ready") ?? false);

    expect(background.sent("vault.generate")[0].onlyIfEmpty).toBe(true);
  });

  it("does not make a second key when a retry follows a failed unlock", async () => {
    let stored = 0;
    background.respond("vault.generate", (request) => {
      if (request.onlyIfEmpty && stored > 0) {
        return createRpcErrorResponse(RPC_ERROR_CODES.KEY_ALREADY_EXISTS, {
          method: "vault.generate",
        });
      }
      stored += 1;
      return { ok: true, data: { id: "k0" } };
    });
    background.fail("vault.unlock", RPC_ERROR_CODES.TIMEOUT);
    const { container } = mount();
    await openQuickStart(container);
    await fillPasswords(container);

    await click(button(container, "Create identity"));
    await settle(() => container.textContent?.includes("Could not create the key") ?? false);
    expect(container.textContent).not.toContain("Your identity is ready");

    background.respond("vault.unlock", () => ({ ok: true, data: {} }));
    await click(button(container, "Create identity"));
    await settle(() => container.textContent?.includes("Your identity is ready") ?? false);

    expect(stored).toBe(1);
  });

  it("unlocks the vault another surface already made instead of failing", async () => {
    background.fail("vault.generate", RPC_ERROR_CODES.KEY_ALREADY_EXISTS);
    const { container } = mount();
    await openQuickStart(container);
    await fillPasswords(container);

    await click(button(container, "Create identity"));
    await settle(() => container.textContent?.includes("Your identity is ready") ?? false);

    expect(background.sent("vault.unlock")).toHaveLength(1);
  });

  it("tells the user this browser already has a vault password when it is not the one typed", async () => {
    background.fail("vault.generate", RPC_ERROR_CODES.INVALID_PASSWORD);
    const { container } = mount();
    await openQuickStart(container);
    await fillPasswords(container);

    await click(button(container, "Create identity"));
    await settle(() => container.textContent?.includes("already has a vault password") ?? false);

    expect(container.textContent).toContain("Use the one you set earlier.");
    expect(container.textContent).not.toContain("Could not create the key");
    expect(background.sent("vault.unlock")).toHaveLength(0);
    expect(container.textContent).not.toContain("Your identity is ready");
    expect(button(container, "Create identity").disabled).toBe(false);
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingContainer } from "@/ui/features/onboarding/components/OnboardingContainer";
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

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
const PASSWORD = "Violet-Harbor-Quill-8472-otter";
const CREATE = "Create New KeyA new key, generated on this device";
const IMPORT = "Import Existing KeyPaste an nsec or open a backup file";

function mount() {
  const onComplete = vi.fn();
  const view = render(
    <KeyManagerProvider>
      <OnboardingContainer onComplete={onComplete} />
    </KeyManagerProvider>
  );
  return { ...view, onComplete };
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

describe("onboarding container routes between the flows", () => {
  it("starts on the welcome screen with both ways in", () => {
    const { container } = mount();

    expect(container.textContent).toContain("Welcome to Ostrilo");
    expect(maybeButton(container, CREATE)).toBeDefined();
    expect(maybeButton(container, IMPORT)).toBeDefined();
  });

  it("opens the create flow and returns to welcome on Back", async () => {
    const { container } = mount();

    await click(button(container, CREATE));
    expect(container.textContent).toContain("Create Your Nostr Key");

    await click(button(container, "Back"));
    expect(container.textContent).toContain("Welcome to Ostrilo");
  });

  it("opens the import flow and returns to welcome on Back", async () => {
    const { container } = mount();

    await click(button(container, IMPORT));
    expect(container.textContent).toContain("Import Your Key");

    await click(button(container, "Back"));
    expect(container.textContent).toContain("Welcome to Ostrilo");
  });

  it("marks onboarding complete before handing off after an import", async () => {
    const order: string[] = [];
    markOnboardingComplete.mockImplementation(async () => {
      order.push("marked");
    });
    const onComplete = vi.fn(() => order.push("completed"));
    const { container } = render(
      <KeyManagerProvider>
        <OnboardingContainer onComplete={onComplete} />
      </KeyManagerProvider>
    );
    await click(button(container, IMPORT));
    await settle(() => maybeButton(container, "Continue")?.disabled === false);
    setValue(input(container, "#keyName"), "Recovered");
    setValue(input(container, "#privateKey"), NSEC);
    await click(button(container, "Continue"));
    await settle(() => container.querySelector("#password") !== null);
    setValue(input(container, "#password"), PASSWORD);
    setValue(input(container, "#confirm-password"), PASSWORD);
    await click(button(container, "Import Key"));
    await settle(() => maybeButton(container, "Get Started") !== undefined);

    await click(button(container, "Get Started"));
    await settle(() => onComplete.mock.calls.length > 0);

    // Once: the container owns the write, and the child flow only reports back.
    expect(order).toEqual(["marked", "completed"]);
  });
});

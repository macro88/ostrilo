/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
const PASSWORD = "correct-horse-battery-staple-42"; // gitleaks:allow

const importKey = vi.fn();
const unlockVault = vi.fn();
const parsePrivateKey = vi.fn();

vi.mock("@/infrastructure/messaging/client", () => ({
  importKey: (...args: unknown[]) => importKey(...args),
  unlockVault: (...args: unknown[]) => unlockVault(...args),
  parsePrivateKey: (...args: unknown[]) => parsePrivateKey(...args),
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

import { OnboardingImportKey } from "@/ui/features/onboarding/components/OnboardingImportKey";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A reducer is a pure function, so `import-key-sensitive-state.test.ts` can
 * prove what `clearSensitiveState` does but not that anything dispatches it.
 * These drive the real component to prove it is dispatched on success, on
 * failure, and on unmount.
 *
 * Every assertion here is about **non-retention** - the flow stops holding a
 * reference - and never about erasure. Clearing an input's `value` overwrites a
 * DOM property and drops a reference; it does not erase the string.
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
    (b) => b.textContent?.includes(text) || b.getAttribute("aria-label") === text
  );
  if (!found) throw new Error(`no button matching ${text}`);
  return found;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Drives the key step, then fills in the password step without submitting. */
async function reachPasswordStep(container: HTMLElement) {
  setValue(container.querySelector<HTMLInputElement>("#keyName")!, "Recovered");
  setValue(container.querySelector<HTMLInputElement>("#privateKey")!, NSEC);
  await click(button(container, "Continue"));

  setValue(container.querySelector<HTMLInputElement>("#password")!, PASSWORD);
  setValue(
    container.querySelector<HTMLInputElement>("#confirm-password")!,
    PASSWORD
  );
}

function passwordFields(container: HTMLElement) {
  return {
    password: container.querySelector<HTMLInputElement>("#password"),
    confirm: container.querySelector<HTMLInputElement>("#confirm-password"),
  };
}

beforeEach(() => {
  parsePrivateKey.mockResolvedValue({ valid: true });
  importKey.mockResolvedValue({ id: "k1" });
  unlockVault.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.clearAllMocks();
});

describe("import-key flow drops the master password on every exit", () => {
  /**
   * ON THE SUCCESS PATH, AND WHY THERE IS NO ASSERTION FOR IT HERE.
   *
   * `handleSetPassword` dispatches `clearSensitiveState` before moving to the
   * success step, and that is the behaviour the reducer test covers. It is not
   * observable from this component:
   *
   *  - the password step unmounts as the step changes, so its inputs leave the
   *    tree whether or not the reducer cleared them;
   *  - the import step unmounted one step earlier, so `#privateKey` is already
   *    gone too;
   *  - the success step renders nothing derived from either value, and there is
   *    no route back from it.
   *
   * So every DOM assertion available on that path holds vacuously - including
   * `expect(container.innerHTML).not.toContain(PASSWORD)`, which passes against
   * a reducer whose clear action does nothing. It is deliberately not written.
   * The failure and unmount paths below are observable, and are where this is
   * actually pinned down.
   */

  it("no longer holds the validated key once the import succeeds", async () => {
    const { container } = render(
      <OnboardingImportKey onBack={() => {}} onComplete={() => {}} />
    );
    await reachPasswordStep(container);

    await click(button(container, "Import Key"));

    // The one consequence of the success-path teardown that does reach the DOM:
    // the flow advanced, having handed the key over exactly once.
    expect(container.textContent).toContain("Recovered");
    expect(importKey).toHaveBeenCalledTimes(1);
    expect(unlockVault).toHaveBeenCalledTimes(1);
  });

  it("no longer holds the password after a failed import", async () => {
    importKey.mockRejectedValue(new Error("Failed to import key"));

    const { container } = render(
      <OnboardingImportKey onBack={() => {}} onComplete={() => {}} />
    );
    await reachPasswordStep(container);
    expect(passwordFields(container).password?.value).toBe(PASSWORD);

    await click(button(container, "Import Key"));

    expect(passwordFields(container).password?.value).toBe("");
    expect(passwordFields(container).confirm?.value).toBe("");
    expect(container.textContent).toContain("Failed to import key");
  });

  it("keeps the validated key available so a failed import can be retried", async () => {
    importKey.mockRejectedValueOnce(new Error("Failed to import key"));

    const { container } = render(
      <OnboardingImportKey onBack={() => {}} onComplete={() => {}} />
    );
    await reachPasswordStep(container);
    await click(button(container, "Import Key"));

    // Retyping the password is enough; the user is not sent back a step.
    setValue(container.querySelector<HTMLInputElement>("#password")!, PASSWORD);
    setValue(
      container.querySelector<HTMLInputElement>("#confirm-password")!,
      PASSWORD
    );
    await click(button(container, "Import Key"));

    expect(importKey).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).not.toContain(PASSWORD);
  });

  it("drops the key material when the document goes away mid-flow", async () => {
    const { container, unmount } = render(
      <OnboardingImportKey onBack={() => {}} onComplete={() => {}} />
    );
    setValue(
      container.querySelector<HTMLInputElement>("#keyName")!,
      "Recovered"
    );
    // Unmounting from the IMPORT step, not the password step. On the password
    // step `#privateKey` has already left the tree, so `querySelector` returns
    // null and every assertion about it holds for the wrong reason.
    const keyField = container.querySelector<HTMLInputElement>("#privateKey")!;
    setValue(keyField, NSEC);
    expect(keyField.value).toBe(NSEC);

    unmount();

    // The file had no `useEffect` at all before this change, so closing the
    // popup here left the nsec in the input element.
    expect(keyField.value).toBe("");
  });
});

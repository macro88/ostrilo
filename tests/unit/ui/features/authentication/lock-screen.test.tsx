/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"http://localhost/options.html"}
 */
/**
 * There was no LockScreen unit test before this file. The only coverage was
 * `tests/e2e/vault-lock.spec.ts:179-215`, which drives the real component but
 * asserts only that it renders and discloses nothing — it never submits a
 * password, so it could not catch a failed unlock being reported as a success.
 *
 * `tests/unit/ui/features/settings/options-app.test.tsx:32-33` stubs the
 * component out entirely.
 *
 * ## Assertions deliberately NOT used as acceptance criteria
 *
 * Each of these passes against the broken code, because the bogus success path
 * cleared the field too:
 *
 *  - that `setPassword("")` runs after an attempt;
 *  - that the rendered HTML no longer contains the entered password;
 *  - that the password is absent from storage.
 *
 * The acceptance criteria are that a wrong password renders an error AND that
 * `onUnlock` is not invoked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const unlock = vi.fn();

const keyManagerState = {
  isLocked: true,
  isLoading: false,
  selectedUnlockedKey: undefined,
  keys: [],
  hasKeys: true,
  lock: vi.fn(),
  unlock,
  generateKey: vi.fn(),
  importKey: vi.fn(),
  selectKey: vi.fn(),
  refreshKeys: vi.fn(),
};

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => keyManagerState,
}));

vi.mock("@/ui/components/logo/Logo", () => ({
  Logo: () => <div aria-label="Ostrilo" />,
}));

const { LockScreen } = await import(
  "@/ui/features/authentication/components/LockScreen"
);

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function render(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(ui);
  });

  mountedRoots.push({ root, container });
  return container;
}

function passwordField(container: HTMLElement): HTMLInputElement {
  const field = container.querySelector<HTMLInputElement>(
    'input[type="password"], input[type="text"]'
  );
  if (!field) throw new Error("password field not found");
  return field;
}

function type(field: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submit(container: HTMLElement) {
  const button = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Unlock")
  );
  if (!button) throw new Error("unlock button not found");
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function attempt(container: HTMLElement, password: string) {
  type(passwordField(container), password);
  submit(container);
  // Let the awaited unlock promise and its follow-on state updates flush.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  unlock.mockReset();
  keyManagerState.isLoading = false;
  keyManagerState.hasKeys = true;
});

afterEach(() => {
  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.clearAllMocks();
});

describe("LockScreen unlock failure reporting", () => {
  it("does not take the success path when the password is wrong", async () => {
    unlock.mockResolvedValue({ ok: false, code: "invalid_password" });
    const onUnlock = vi.fn();

    const container = render(<LockScreen onUnlock={onUnlock} />);
    await attempt(container, "wrong-password");

    expect(onUnlock).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/incorrect password/i);
  });

  it("invokes the success callback exactly once on success", async () => {
    unlock.mockResolvedValue({ ok: true });
    const onUnlock = vi.fn();

    const container = render(<LockScreen onUnlock={onUnlock} />);
    await attempt(container, "correct-password");

    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(passwordField(container).value).toBe("");
  });

  it("reports an absent vault without claiming the password was wrong", async () => {
    unlock.mockResolvedValue({
      ok: false,
      code: "no_key_selected",
      detail: "No vault exists yet. Create or import a key before unlocking.",
    });

    const container = render(<LockScreen />);
    await attempt(container, "anything");

    expect(container.textContent).toMatch(/no vault exists yet/i);
    expect(container.textContent).not.toMatch(/incorrect password/i);
  });

  it("reports a damaged vault without claiming the password was wrong", async () => {
    unlock.mockResolvedValue({
      ok: false,
      code: "vault_unreadable",
      detail:
        "This vault was written by a different version of Ostrilo, or its stored encryption parameters are not acceptable. Update the extension; do not re-create your vault.",
    });

    const container = render(<LockScreen />);
    await attempt(container, "correct-password");

    expect(container.textContent).toMatch(/could not be opened/i);
    expect(container.textContent).not.toMatch(/incorrect password/i);
  });

  it("presents a throttled attempt as a wait, not as a wrong password", async () => {
    unlock.mockResolvedValue({
      ok: false,
      code: "rate_limited",
      detail: "Too many failed attempts. Try again in 30 seconds.",
    });

    const container = render(<LockScreen />);
    await attempt(container, "anything");

    expect(container.textContent).toMatch(/30 seconds/);
    expect(container.textContent).toMatch(/too many failed attempts/i);
    expect(container.textContent).not.toMatch(/incorrect password/i);
  });

  it("shows the countdown the background attaches to a wrong password", async () => {
    unlock.mockResolvedValue({
      ok: false,
      code: "invalid_password",
      detail:
        "Incorrect password. Further attempts are paused for 15 seconds.",
    });

    const container = render(<LockScreen />);
    await attempt(container, "wrong-password");

    expect(container.textContent).toMatch(/15 seconds/);
  });

  it("falls back to generic copy when the code carries no local copy", async () => {
    unlock.mockResolvedValue({
      ok: false,
      code: "invalid_password",
    });

    const container = render(<LockScreen />);
    await attempt(container, "wrong-password");

    expect(container.textContent).toMatch(/incorrect password/i);
  });

  it("never renders background text for an unrecognised code", async () => {
    // What the router returns for any error a handler did not classify
    // (`rpc-router.ts:239-242`), plus a detail string that must not reach the
    // screen: a new background error cannot put unexpected text on this surface.
    unlock.mockResolvedValue({
      ok: false,
      code: "unknown_method",
      detail: "Request could not be handled",
    });

    const container = render(<LockScreen />);
    await attempt(container, "anything");

    expect(container.textContent).toMatch(/could not unlock the vault/i);
    expect(container.textContent).not.toMatch(/request could not be handled/i);
  });

  it("keeps the entered password out of every failure message", async () => {
    const entered = "sphinx-of-black-quartz-judge-my-vow";
    unlock.mockResolvedValue({
      ok: false,
      code: "invalid_password",
      detail: "Incorrect password",
    });

    const container = render(<LockScreen />);
    await attempt(container, entered);

    // Asserted together: without the first, the second would hold vacuously
    // for a screen that rendered no message at all.
    const message = container.querySelector('[role="alert"]');
    expect(message?.textContent).toMatch(/incorrect password/i);
    expect(message?.textContent).not.toContain(entered);
  });
});

describe("LockScreen secret input hygiene", () => {
  it("withholds the password field from autofill and spell-check", async () => {
    const container = render(<LockScreen />);
    const field = passwordField(container);

    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
    expect(field.hasAttribute("data-1p-ignore")).toBe(true);
    expect(field.getAttribute("data-lpignore")).toBe("true");
    expect(field.hasAttribute("data-bwignore")).toBe(true);
  });

  it("clears the input element when the surrounding page is hidden", async () => {
    // The docblock at the top of this file mounts on `/options.html`, which
    // opens in a full tab and is not torn down after an attempt.
    const container = render(<LockScreen />);
    const field = passwordField(container);
    type(field, "correct horse battery staple");
    expect(field.value).toBe("correct horse battery staple");

    act(() => {
      globalThis.dispatchEvent(new Event("pagehide"));
    });

    expect(field.value).toBe("");
  });

  it("clears the input element when the lock screen unmounts", async () => {
    const container = render(<LockScreen />);
    const field = passwordField(container);
    type(field, "correct horse battery staple");

    const entry = mountedRoots.pop()!;
    act(() => entry.root.unmount());
    entry.container.remove();

    // Held by this test, not by the document: React drops the node on unmount,
    // so querying for it afterwards would return null and assert nothing.
    expect(field.value).toBe("");
  });

  it("no longer holds the entered password once an attempt completes", async () => {
    // Non-retention, not erasure: the component drops its reference. Nothing
    // here claims the string is gone from the heap.
    unlock.mockResolvedValue({ ok: false, code: "invalid_password" });

    const container = render(<LockScreen />);
    await attempt(container, "correct horse battery staple");

    expect(passwordField(container).value).toBe("");
  });
});

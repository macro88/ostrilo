/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PasswordInput } from "@/ui/components/ui/password-input";

vi.mock("@/infrastructure/messaging/client", () => ({
  evaluatePasswordStrength: vi.fn().mockResolvedValue(null),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<Parameters<typeof PasswordInput>[0]> = {}) {
  act(() => {
    root.render(
      <PasswordInput label="Master Password" value="" onChange={() => {}} {...props} />
    );
  });
}

const input = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;

describe("PasswordInput error semantics", () => {
  it("announces a submit error as an alert tied to its input", () => {
    render({ error: "Use at least 12 characters." });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Use at least 12 characters.");
    expect(alert?.id).toBeTruthy();

    const field = input("password");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(alert?.id);
    expect(field.getAttribute("aria-errormessage")).toBe(alert?.id);
  });

  it("announces a confirmation mismatch politely, tied to the confirmation input", () => {
    render({
      value: "one-password",
      confirmValue: "another",
      onConfirmChange: () => {},
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Passwords do not match");

    const confirm = input("confirm-password");
    expect(confirm.getAttribute("aria-invalid")).toBe("true");
    expect(confirm.getAttribute("aria-describedby")).toBe(status?.id);
    expect(input("password").getAttribute("aria-describedby")).toBeNull();
  });

  it("keeps two prefixed instances from sharing a message id", () => {
    act(() => {
      root.render(
        <>
          <PasswordInput label="First" idPrefix="a" value="" onChange={() => {}} error="A failed" />
          <PasswordInput label="Second" idPrefix="b" value="" onChange={() => {}} error="B failed" />
        </>
      );
    });

    const first = input("a-password").getAttribute("aria-describedby");
    const second = input("b-password").getAttribute("aria-describedby");
    expect(first).not.toBe(second);
    expect(container.querySelector(`[id="${first}"]`)?.textContent).toBe("A failed");
    expect(container.querySelector(`[id="${second}"]`)?.textContent).toBe("B failed");
  });

  it("points nothing at a message when there is none, and for a caller-owned alert", () => {
    render();
    expect(input("password").getAttribute("aria-describedby")).toBeNull();
    expect(input("password").hasAttribute("aria-invalid")).toBe(false);

    render({ invalid: true });
    const field = input("password");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.hasAttribute("aria-describedby")).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

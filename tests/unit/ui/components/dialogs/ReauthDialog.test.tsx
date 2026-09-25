/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReauthDialog, type ReauthDialogProps } from "@/ui/components/dialogs/ReauthDialog";
import { button, click, input, render, setValue, submit, unmountAll } from "../../features/onboarding/dom";

const PASSWORD = "Violet-Harbor-Quill-8472-otter";

function mount(overrides: Partial<ReauthDialogProps> = {}) {
  const props: ReauthDialogProps = {
    open: true,
    action: "Delete the key Work.",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  const view = render(<ReauthDialog {...props} />);
  return { ...view, props };
}

function passwordField() {
  return input(document.body, "#reauth-password");
}

function form() {
  const found = passwordField().closest("form");
  if (!found) throw new Error("password field is not in a form");
  return found;
}

afterEach(() => {
  unmountAll();
});

describe("reauth dialog", () => {
  it("states the action and its consequence", () => {
    mount({ consequence: "This cannot be undone." });

    const dialog = document.body.querySelector("[role='dialog']");
    expect(dialog?.textContent).toContain(
      "Delete the key Work. This cannot be undone."
    );
  });

  it("keeps Confirm disabled until a password is entered", () => {
    const { props } = mount();
    expect(button(document.body, "Confirm").disabled).toBe(true);

    setValue(passwordField(), PASSWORD);
    expect(button(document.body, "Confirm").disabled).toBe(false);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it("hands the password over once and drops it from the field", async () => {
    const onConfirm = vi.fn();
    mount({ onConfirm });
    setValue(passwordField(), PASSWORD);

    await submit(form());

    expect(onConfirm.mock.calls).toEqual([[PASSWORD]]);
    expect(passwordField().value).toBe("");
  });

  it("does not submit an empty password", async () => {
    const onConfirm = vi.fn();
    mount({ onConfirm });

    await submit(form());

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not submit again while a check is in flight", async () => {
    const onConfirm = vi.fn();
    const { rerender, props } = mount({ onConfirm });
    setValue(passwordField(), PASSWORD);
    rerender(<ReauthDialog {...props} busy />);

    await submit(form());

    expect(onConfirm).not.toHaveBeenCalled();
    expect(button(document.body, "Checking…").disabled).toBe(true);
    expect(button(document.body, "Cancel").disabled).toBe(true);
    expect(passwordField().disabled).toBe(true);
  });

  it("shows the error it is given", () => {
    mount({ error: "That password is not correct." });

    expect(document.body.textContent).toContain("That password is not correct.");
    expect(passwordField().getAttribute("aria-invalid")).toBe("true");
  });

  it("drops the password when cancelled", async () => {
    const onCancel = vi.fn();
    mount({ onCancel });
    setValue(passwordField(), PASSWORD);

    await click(button(document.body, "Cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(passwordField().value).toBe("");
  });

  it("cancels when dismissed with Escape", async () => {
    const onCancel = vi.fn();
    mount({ onCancel });
    setValue(passwordField(), PASSWORD);

    await act(async () => {
      passwordField().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(passwordField().value).toBe("");
  });
});

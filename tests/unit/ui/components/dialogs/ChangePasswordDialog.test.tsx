/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RPC_ERROR_CODES, type RpcErrorCode } from "@/infrastructure/messaging/error-codes";
import {
  alertText,
  button,
  click,
  input,
  render,
  setValue,
  submit,
  unmountAll,
} from "../../features/onboarding/dom";

const client = vi.hoisted(() => ({
  changePassword: vi.fn(),
  evaluatePasswordStrength: vi.fn(),
}));

vi.mock("@/infrastructure/messaging/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/infrastructure/messaging/client")>()),
  changePassword: client.changePassword,
  evaluatePasswordStrength: client.evaluatePasswordStrength,
}));

import { RpcClientError } from "@/infrastructure/messaging/client";
import { ChangePasswordDialog } from "@/ui/components/dialogs/ChangePasswordDialog";

const CURRENT = "Old-Harbour-Lantern-58";
const NEXT = "New-Quartz-Meadow-2026";

const refusal = (errorCode: RpcErrorCode, details?: string) =>
  new RpcClientError("vault.changePassword", {
    code: -32000,
    message: "refused",
    data: { errorCode, details, method: "vault.changePassword" },
  });

const field = (id: string) => input(document.body, `#${id}`);
const current = () => field("change-current-password");
const next = () => field("change-new-password");
const confirm = () => field("change-new-confirm-password");
const form = () => {
  const found = current().closest("form");
  if (!found) throw new Error("no form");
  return found;
};

function mount() {
  const onClose = vi.fn();
  render(<ChangePasswordDialog open onClose={onClose} />);
  return { onClose };
}

function fill(values: { current?: string; next?: string; confirm?: string } = {}) {
  setValue(current(), values.current ?? CURRENT);
  setValue(next(), values.next ?? NEXT);
  setValue(confirm(), values.confirm ?? NEXT);
}

function fieldsAreEmpty() {
  return [current(), next(), confirm()].every((f) => f.value === "");
}

beforeEach(() => {
  client.changePassword.mockReset();
  client.evaluatePasswordStrength.mockResolvedValue(null);
});

afterEach(() => {
  unmountAll();
});

describe("change password dialog", () => {
  it("keeps every field out of autofill and spell-check", () => {
    mount();
    for (const f of [current(), next(), confirm()]) {
      expect(f.getAttribute("autocomplete")).toBe("off");
      expect(f.getAttribute("spellcheck")).toBe("false");
      expect(f.type).toBe("password");
    }
  });

  it("blocks submission until the confirmation matches, and sends nothing", async () => {
    mount();
    fill({ confirm: "Something-Else-Entirely-1" });

    expect(button(document.body, "Change password").disabled).toBe(true);
    await submit(form());

    expect(client.changePassword).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Passwords do not match");
  });

  it("blocks submission without a current password", () => {
    mount();
    fill({ current: "" });
    expect(button(document.body, "Change password").disabled).toBe(true);
  });

  it("sends both passwords once, then shows success and clears the fields", async () => {
    client.changePassword.mockResolvedValue(null);
    mount();
    fill();

    await submit(form());

    expect(client.changePassword.mock.calls).toEqual([[CURRENT, NEXT]]);
    const success = document.body.querySelector("[data-testid='change-password-success']");
    expect(success?.textContent).toContain("Master password changed.");
    expect(success?.textContent).toMatch(/backup files keep the passphrase/i);
    expect(document.body.querySelector("#change-current-password")).toBeNull();
  });

  it("reports a wrong current password and clears every field", async () => {
    client.changePassword.mockRejectedValue(refusal(RPC_ERROR_CODES.INVALID_PASSWORD));
    mount();
    fill();

    await submit(form());

    expect(alertText(document.body)).toBe("That is not your current password.");
    expect(fieldsAreEmpty()).toBe(true);
  });

  it("shows a throttle wait with its remaining time, not an incorrect password", async () => {
    client.changePassword.mockRejectedValue(
      refusal(RPC_ERROR_CODES.RATE_LIMITED, "Too many failed attempts. Try again in 40 seconds.")
    );
    mount();
    fill();

    await submit(form());

    expect(alertText(document.body)).toBe("Too many failed attempts. Try again in 40 seconds.");
    // A wait is a warning, not a failure: the amber panel, not the red one.
    expect(document.body.querySelector("[role='alert']")?.className).toContain("ink-amber-soft");
  });

  it("shows the policy's reason for a weak new password", async () => {
    client.changePassword.mockRejectedValue(
      refusal(RPC_ERROR_CODES.INVALID_PASSWORD, "Use at least 12 characters.")
    );
    mount();
    fill();

    await submit(form());

    expect(alertText(document.body)).toBe("Use at least 12 characters.");
  });

  it.each([
    [RPC_ERROR_CODES.VAULT_MIGRATION_PENDING, /unlock it once to finish migrating/i],
    [RPC_ERROR_CODES.VAULT_RECORDS_DAMAGED, /remove the damaged key/i],
    [RPC_ERROR_CODES.INVALID_PARAMS, /must differ from the current one/i],
  ] as const)("names the next step for %s", async (code, copy) => {
    client.changePassword.mockRejectedValue(refusal(code, "Key records that do not open: abc"));
    mount();
    fill();

    await submit(form());

    expect(alertText(document.body)).toMatch(copy);
    expect(alertText(document.body)).not.toMatch(/^rpc:/);
  });

  it("clears the fields and closes on Cancel", async () => {
    const { onClose } = mount();
    fill();

    await click(button(document.body, "Cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(client.changePassword).not.toHaveBeenCalled();
    // The parent still holds `open`, so the same fields are on screen - empty.
    expect(fieldsAreEmpty()).toBe(true);
  });
  it("clears the fields and closes on Escape", async () => {
    const { onClose } = mount();
    fill();

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fieldsAreEmpty()).toBe(true);
  });
});

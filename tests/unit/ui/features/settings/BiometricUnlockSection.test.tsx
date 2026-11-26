/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buttonByText,
  cancelReauth,
  click,
  confirmReauth,
  flush,
  reauthDialog,
  render,
  unmountAll,
} from "./settings-dom";
import { CeremonyError } from "@/application/ports/webauthn";
import { RPC_ERROR_CODES, createRpcError } from "@/infrastructure/messaging/error-codes";

const deps = vi.hoisted(() => ({
  chromium: true,
  status: vi.fn(),
  enroll: vi.fn(),
  forget: vi.fn(),
  lockState: vi.fn(),
  probe: vi.fn(),
  ceremony: vi.fn(),
  discard: vi.fn(),
}));

vi.mock("@/domain/platform/build-target", () => ({
  get IS_CHROMIUM_BUILD() {
    return deps.chromium;
  },
}));

vi.mock("@/infrastructure/messaging/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/infrastructure/messaging/client")>()),
  biometricStatus: () => deps.status(),
  biometricEnroll: (...args: unknown[]) => deps.enroll(...args),
  biometricForget: () => deps.forget(),
  getLockState: () => deps.lockState(),
}));

vi.mock("@/infrastructure/webauthn/webauthn-ceremony.adapter", () => ({
  BrowserWebAuthnCeremony: {
    probe: () => deps.probe(),
    enroll: (salt: Uint8Array) => deps.ceremony(salt),
    discard: (id: number[]) => deps.discard(id),
  },
}));

const { RpcClientError } = await import("@/infrastructure/messaging/client");
const { BiometricUnlockSection } = await import(
  "@/ui/features/settings/components/BiometricUnlockSection"
);

const FACTOR = {
  credentialId: [1, 2, 3],
  prfSalt: new Array(32).fill(7),
  transports: ["internal"],
  backupEligible: true,
};

let output: Uint8Array;

async function mount() {
  const container = render(<BiometricUnlockSection />);
  await flush();
  return container;
}

beforeEach(() => {
  deps.chromium = true;
  output = new Uint8Array(32).fill(0x5a);
  deps.status.mockReset().mockResolvedValue({ enrolled: false });
  deps.enroll.mockReset().mockResolvedValue(null);
  deps.forget.mockReset().mockResolvedValue(null);
  deps.lockState.mockReset().mockResolvedValue({ isLocked: false, authFactor: "password" });
  deps.probe.mockReset().mockResolvedValue(true);
  deps.ceremony.mockReset().mockImplementation(async () => ({ factor: FACTOR, prfOutput: output }));
  deps.discard.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  unmountAll();
});

describe("BiometricUnlockSection", () => {
  it("renders nothing at all on a build without the feature", async () => {
    deps.chromium = false;
    const container = await mount();
    expect(container.innerHTML).toBe("");
    expect(deps.status).not.toHaveBeenCalled();
    expect(deps.probe).not.toHaveBeenCalled();
  });

  it("renders nothing when the background cannot say", async () => {
    deps.status.mockRejectedValue(new Error("unreachable"));
    const container = await mount();
    expect(container.innerHTML).toBe("");
  });

  it("explains, with no control, when the browser cannot run a ceremony", async () => {
    deps.probe.mockResolvedValue(false);
    const container = await mount();

    expect(container.textContent).toContain("no passkey provider");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[disabled]")).toBeNull();
  });

  it("states what turning it on means before it is turned on", async () => {
    const container = await mount();
    const text = container.textContent ?? "";

    expect(text).toContain("may sync to your other devices");
    expect(text).toContain("master password stays required");
    expect(text).toContain("compelled");
    expect(text).not.toMatch(/fingerprint|face id|touch id/i);
  });

  it("enrols with the re-entered password and the ceremony's output in one request, then clears the output", async () => {
    const container = await mount();
    let sent: number[] = [];
    deps.enroll.mockImplementation(async (_pw: string, _factor: unknown, wire: number[]) => {
      expect(wire).toEqual(new Array(32).fill(0x5a));
      sent = wire;
      return null;
    });
    deps.status.mockResolvedValue({ enrolled: true, enrolledAt: 1_800_000_000_000, synced: true });

    await click(buttonByText(container, "Turn on"));
    expect(deps.ceremony).not.toHaveBeenCalled();
    expect(reauthDialog()?.textContent).toContain("Turn on device unlock.");
    await confirmReauth("pw");
    await flush();

    expect(deps.enroll).toHaveBeenCalledTimes(1);
    expect(deps.enroll.mock.calls[0].slice(0, 2)).toEqual(["pw", FACTOR]);
    expect(output.every((b) => b === 0)).toBe(true);
    expect(sent.every((b) => b === 0)).toBe(true);
    expect(container.textContent).toContain("Device unlock is on");
    expect(container.textContent).toContain("may sync through your passkey provider");
  });

  it("creates nothing when the password prompt is cancelled", async () => {
    const container = await mount();
    await click(buttonByText(container, "Turn on"));
    await cancelReauth();
    await flush();

    expect(deps.ceremony).not.toHaveBeenCalled();
    expect(deps.enroll).not.toHaveBeenCalled();
  });

  it("names a provider that works when the ceremony ends without a credential", async () => {
    deps.ceremony.mockRejectedValue(new CeremonyError("cancelled"));
    const container = await mount();

    await click(buttonByText(container, "Turn on"));
    await confirmReauth("pw");
    await flush();

    expect(deps.enroll).not.toHaveBeenCalled();
    expect(reauthDialog()).toBeNull();
    expect(container.textContent).toContain("Nothing was set up");
    expect(container.textContent).toContain("Apple Passwords");
    expect(container.textContent).not.toContain("may have been saved");
    expect(buttonByText(container, "Turn on")).toBeTruthy();
  });

  it("says a passkey may remain when the authenticator returned no output", async () => {
    deps.ceremony.mockRejectedValue(new CeremonyError("no_output", true));
    const container = await mount();

    await click(buttonByText(container, "Turn on"));
    await confirmReauth("pw");
    await flush();

    expect(container.textContent).toContain("cannot be used to unlock a vault");
    expect(container.textContent).toContain("may have been saved");
  });

  it("keeps the dialog open on a wrong password, and discards the passkey it made", async () => {
    deps.enroll.mockRejectedValue(
      new RpcClientError(
        "vault.biometricEnroll",
        createRpcError(RPC_ERROR_CODES.INVALID_PASSWORD, { details: "Incorrect password" })
      )
    );
    const container = await mount();

    await click(buttonByText(container, "Turn on"));
    await confirmReauth("wrong");
    await flush();

    expect(reauthDialog()?.textContent).toContain("Incorrect password");
    expect(deps.discard).toHaveBeenCalledWith(FACTOR.credentialId);
    expect(output.every((b) => b === 0)).toBe(true);
    expect(container.textContent).not.toContain("Device unlock is on");
  });

  it("turns off without asking for anything", async () => {
    deps.status.mockResolvedValue({ enrolled: true, enrolledAt: 1_800_000_000_000, synced: false });
    const container = await mount();
    expect(container.textContent).toContain("stays on this device");
    deps.status.mockResolvedValue({ enrolled: false });

    await click(buttonByText(container, "Turn off"));
    await flush();

    expect(deps.forget).toHaveBeenCalledTimes(1);
    expect(reauthDialog()).toBeNull();
    expect(buttonByText(container, "Turn on")).toBeTruthy();
  });

  it("explains the password prompt in a session opened with the device", async () => {
    deps.lockState.mockResolvedValue({ isLocked: false, authFactor: "biometric" });
    const container = await mount();

    await click(buttonByText(container, "Turn on"));
    await flush();

    expect(reauthDialog()?.textContent).toContain("You unlocked with your device");
  });

  it("gives no such explanation in a password session", async () => {
    const container = await mount();
    await click(buttonByText(container, "Turn on"));
    await flush();

    expect(reauthDialog()?.textContent).not.toContain("You unlocked with your device");
  });
});

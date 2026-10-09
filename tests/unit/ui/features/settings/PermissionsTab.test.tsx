/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OriginPolicy } from "@/domain/types";
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

const settingsHook = vi.hoisted(() => ({
  isLoading: false,
  origins: [] as OriginPolicy[],
  setSessionGrant: vi.fn(),
  removeOriginPolicy: vi.fn(),
  setPerKindRule: vi.fn(),
  updateOriginTrustLevel: vi.fn(),
  revokeIdentityDisclosure: vi.fn(),
  revokeIdentityDisclosureKey: vi.fn(),
}));

const vaultKeys = vi.hoisted(() => ({
  keys: [] as Array<{
    id: string;
    label: string;
    publicKeyBech32: string;
    isUnreadable?: boolean;
  }>,
}));

const client = vi.hoisted(() => ({
  policyGetSessionGrants: vi.fn(),
  evaluatePasswordStrength: vi.fn(),
}));

vi.mock("@/hooks/useAppSettings", () => ({
  useAppSettings: () => ({
    settings: { origins: settingsHook.origins, mediumAllowKinds: [7] },
    isLoading: settingsHook.isLoading,
    setSessionGrant: settingsHook.setSessionGrant,
    removeOriginPolicy: settingsHook.removeOriginPolicy,
    setPerKindRule: settingsHook.setPerKindRule,
    updateOriginTrustLevel: settingsHook.updateOriginTrustLevel,
    revokeIdentityDisclosure: settingsHook.revokeIdentityDisclosure,
    revokeIdentityDisclosureKey: settingsHook.revokeIdentityDisclosureKey,
  }),
}));

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => ({ keys: vaultKeys.keys }),
}));

vi.mock("@/infrastructure/messaging/client", () => client);

vi.mock("@/ui/features/settings/components/shared/DisclosureHistory", () => ({
  DisclosureHistory: () => <section>Disclosure history</section>,
}));

import { PermissionsTab } from "@/ui/features/settings/components/PermissionsTab";

const ORIGIN = "https://primal.net";
const KEY_A = "0b6d6f5e-7a4c-4a52-8d3c-2f1e9a7c4b10";
const KEY_B = "7c1d3a90-5b2e-4f08-9a63-1d8e4c2b6f77";

function site(overrides: Partial<OriginPolicy> = {}): OriginPolicy {
  return {
    origin: ORIGIN,
    trustLevel: "medium",
    rules: {},
    updatedAt: 1,
    ...overrides,
  };
}

async function mount() {
  const container = render(<PermissionsTab />);
  await flush();
  return container;
}

function trustButton(container: HTMLElement, label: string) {
  return buttonByText(
    container.querySelector(`[data-testid="origin-trust-${ORIGIN}"]`)!,
    label
  );
}

function kindButton(container: HTMLElement, kind: number, label: string) {
  return buttonByText(
    container.querySelector(`[data-testid="origin-policy-kind-${kind}"]`)!,
    label
  );
}

function sessionSwitch(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[role="switch"]')!;
}

beforeEach(() => {
  settingsHook.isLoading = false;
  settingsHook.origins = [site()];
  for (const fn of [
    settingsHook.setSessionGrant,
    settingsHook.removeOriginPolicy,
    settingsHook.setPerKindRule,
    settingsHook.updateOriginTrustLevel,
    settingsHook.revokeIdentityDisclosure,
    settingsHook.revokeIdentityDisclosureKey,
  ]) {
    fn.mockReset().mockResolvedValue(undefined);
  }
  vaultKeys.keys = [];
  client.policyGetSessionGrants.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("PermissionsTab", () => {
  it("shows the settings skeleton while settings load", async () => {
    settingsHook.isLoading = true;
    const container = await mount();

    expect(container.textContent).not.toContain("Permissions");
    expect(container.querySelector('[aria-label="Sites with a stored policy"]')).toBeNull();
  });

  it("lowers trust without asking for a password", async () => {
    settingsHook.origins = [site({ trustLevel: "high" })];
    const container = await mount();

    await click(trustButton(container, "Low"));

    expect(settingsHook.updateOriginTrustLevel).toHaveBeenCalledWith(ORIGIN, "low");
    expect(reauthDialog()).toBeNull();
  });

  it("raises a site to high trust only with the re-entered password", async () => {
    const container = await mount();

    await click(trustButton(container, "High"));

    expect(settingsHook.updateOriginTrustLevel).not.toHaveBeenCalled();
    expect(reauthDialog()?.textContent).toContain(`Raise ${ORIGIN} to high trust.`);

    await confirmReauth("pw");

    expect(settingsHook.updateOriginTrustLevel).toHaveBeenCalledWith(
      ORIGIN,
      "high",
      "pw"
    );
    expect(reauthDialog()).toBeNull();
  });

  it("leaves the trust level alone when raising to high is cancelled", async () => {
    const container = await mount();

    await click(trustButton(container, "High"));
    await cancelReauth();

    expect(settingsHook.updateOriginTrustLevel).not.toHaveBeenCalled();
    expect(trustButton(container, "Medium").getAttribute("aria-pressed")).toBe("true");
  });

  it("stores a deny rule for a kind without a password", async () => {
    const container = await mount();

    await click(kindButton(container, 0, "Deny"));

    expect(settingsHook.setPerKindRule).toHaveBeenCalledWith(ORIGIN, 0, "deny");
    expect(reauthDialog()).toBeNull();
  });

  it("stores an allow rule for a kind only after the password is confirmed", async () => {
    const container = await mount();

    await click(kindButton(container, 0, "Allow"));

    expect(settingsHook.setPerKindRule).not.toHaveBeenCalled();
    expect(reauthDialog()?.textContent).toContain(`Always allow kind 0 for ${ORIGIN}.`);

    await confirmReauth("pw");

    expect(settingsHook.setPerKindRule).toHaveBeenCalledWith(ORIGIN, 0, "allow", "pw");
  });

  it("stores no allow rule when the password dialog is cancelled", async () => {
    const container = await mount();

    await click(kindButton(container, 0, "Allow"));
    await cancelReauth();

    expect(settingsHook.setPerKindRule).not.toHaveBeenCalled();
    expect(kindButton(container, 0, "Ask").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the refusal message inside the dialog when the allow rule is rejected", async () => {
    settingsHook.setPerKindRule.mockRejectedValueOnce(new Error("Incorrect password"));
    const container = await mount();

    await click(kindButton(container, 0, "Allow"));
    await confirmReauth("bad");

    expect(reauthDialog()?.textContent).toContain("Incorrect password");
  });

  it("grants a signing session with the password and re-reads live grants", async () => {
    const container = await mount();
    expect(client.policyGetSessionGrants).toHaveBeenCalledTimes(1);
    client.policyGetSessionGrants.mockResolvedValue([
      { origin: ORIGIN, expiresAt: Date.now() + 60_000 },
    ]);

    await click(sessionSwitch(container));
    expect(settingsHook.setSessionGrant).not.toHaveBeenCalled();
    expect(reauthDialog()?.textContent).toContain(`Grant ${ORIGIN} a signing session.`);

    await confirmReauth("pw");
    await flush();

    expect(settingsHook.setSessionGrant).toHaveBeenCalledWith(ORIGIN, true, "pw");
    expect(client.policyGetSessionGrants).toHaveBeenCalledTimes(2);
    expect(sessionSwitch(container).getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector(`[data-testid="origin-row-${ORIGIN}"]`)?.textContent).toContain(
      "Session"
    );
  });

  it("creates no session grant when the dialog is cancelled", async () => {
    const container = await mount();

    await click(sessionSwitch(container));
    await cancelReauth();

    expect(settingsHook.setSessionGrant).not.toHaveBeenCalled();
    expect(sessionSwitch(container).getAttribute("aria-checked")).toBe("false");
  });

  it("ends a live session grant without a password", async () => {
    client.policyGetSessionGrants.mockResolvedValueOnce([
      { origin: ORIGIN, expiresAt: Date.now() + 60_000 },
    ]);
    const container = await mount();
    expect(sessionSwitch(container).getAttribute("aria-checked")).toBe("true");

    await click(sessionSwitch(container));
    await flush();

    expect(settingsHook.setSessionGrant).toHaveBeenCalledWith(ORIGIN, false);
    expect(reauthDialog()).toBeNull();
    expect(sessionSwitch(container).getAttribute("aria-checked")).toBe("false");
  });

  it("shows no live grant when the background cannot be reached", async () => {
    client.policyGetSessionGrants.mockRejectedValueOnce(new Error("locked"));
    settingsHook.origins = [site({ sessionGrantAll: true })];
    const container = await mount();

    expect(sessionSwitch(container).getAttribute("aria-checked")).toBe("false");
  });

  it("revokes a recorded public-key refusal", async () => {
    settingsHook.origins = [site({ identityDisclosure: "deny" })];
    const container = await mount();

    await click(buttonByText(container, "Revoke"));

    expect(settingsHook.revokeIdentityDisclosure).toHaveBeenCalledWith(ORIGIN);
  });

  it("names the identity each public-key grant belongs to and revokes it alone", async () => {
    vaultKeys.keys = [
      { id: KEY_A, label: "Main", publicKeyBech32: `npub1${"a".repeat(58)}` },
      { id: KEY_B, label: "Work", publicKeyBech32: `npub1${"b".repeat(58)}` },
    ];
    settingsHook.origins = [
      site({
        identityDisclosure: "allow",
        identityDisclosureKeyIds: [KEY_A, KEY_B],
      }),
    ];
    const container = await mount();

    const grantA = container.querySelector(`[data-testid="disclosure-grant-${KEY_A}"]`)!;
    expect(grantA.textContent).toContain("Main");
    expect(grantA.textContent).toContain("npub1aaaaaaa");
    expect(
      container.querySelector(`[data-testid="disclosure-grant-${KEY_B}"]`)!.textContent
    ).toContain("Work");

    await click(buttonByText(grantA, "Revoke"));

    expect(settingsHook.revokeIdentityDisclosureKey).toHaveBeenCalledWith(ORIGIN, KEY_A);
    expect(settingsHook.revokeIdentityDisclosureKey).toHaveBeenCalledTimes(1);
    expect(settingsHook.revokeIdentityDisclosure).not.toHaveBeenCalled();
  });

  it("removes a site only after the removal is confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const container = await mount();

    await click(buttonByText(container, "Remove site"));
    expect(confirm).toHaveBeenCalledWith(
      "Remove policy for https://primal.net? This action cannot be undone."
    );
    expect(settingsHook.removeOriginPolicy).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await click(buttonByText(container, "Remove site"));

    expect(settingsHook.removeOriginPolicy).toHaveBeenCalledWith(ORIGIN);
  });
});

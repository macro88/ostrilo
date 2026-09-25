// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS_V1, type AppSettingsV1 } from "@/domain/types";
import type { KeyListEntry } from "@/infrastructure/messaging/handlers/vault-rpc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  subscribeSettingsChanged: vi.fn(),
  reportActivity: vi.fn(),
  activityClear: vi.fn(),
  getLockState: vi.fn(),
  listKeys: vi.fn(),
}));

vi.mock("@/infrastructure/messaging/client", () => ({
  ...rpc,
  RpcClientError: class extends Error {},
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      onMessage: { addListener: () => undefined, removeListener: () => undefined },
    },
  },
}));

type Onboarding = ReturnType<
  typeof import("@/ui/features/onboarding/hooks/useOnboarding").useOnboarding
>;

const storedKey: KeyListEntry = {
  id: "k1",
  label: "Main",
  pubkey: "ab".repeat(32),
  npub: "npub1main",
  ct: [],
  iv: [],
  createdAt: 1,
};

let container: HTMLDivElement;
let root: Root;
let current: Onboarding | null;

async function mount(settings: Partial<AppSettingsV1>, keys: KeyListEntry[]) {
  rpc.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS_V1, ...settings });
  rpc.listKeys.mockResolvedValue(keys);
  const { useOnboarding } = await import(
    "@/ui/features/onboarding/hooks/useOnboarding"
  );
  const { KeyManagerProvider } = await import("@/ui/state/KeyManagerContext");
  function Harness() {
    current = useOnboarding();
    return null;
  }
  act(() =>
    root.render(
      <KeyManagerProvider>
        <Harness />
      </KeyManagerProvider>
    )
  );
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  if (!current) throw new Error("harness has not rendered");
  return current;
}

describe("useOnboarding", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const fn of Object.values(rpc)) fn.mockReset();
    rpc.getLockState.mockResolvedValue({ isLocked: true });
    rpc.updateSettings.mockResolvedValue(undefined);
    current = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("needs onboarding on a fresh install with no keys", async () => {
    const onboarding = await mount({}, []);

    expect(onboarding).toMatchObject({
      isFirstRun: true,
      needsOnboarding: true,
      hasKeys: false,
    });
  });

  it("skips onboarding once the vault holds a key", async () => {
    const onboarding = await mount({}, [storedKey]);

    expect(onboarding).toMatchObject({
      isFirstRun: false,
      needsOnboarding: false,
      hasKeys: true,
    });
  });

  it("skips onboarding when it was completed, even with no keys left", async () => {
    const onboarding = await mount({ onboardingCompleted: true }, []);

    expect(onboarding.needsOnboarding).toBe(false);
    expect(onboarding.hasKeys).toBe(false);
  });

  it("records completion with a timestamp in epoch seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00.500Z"));
    const onboarding = await mount({}, []);

    await onboarding.markOnboardingComplete();

    expect(rpc.updateSettings).toHaveBeenCalledWith(
      {
        onboardingCompleted: true,
        onboardingCompletedAt: Math.floor(
          Date.parse("2026-09-25T12:00:00Z") / 1000
        ),
      },
      undefined
    );
  });
});

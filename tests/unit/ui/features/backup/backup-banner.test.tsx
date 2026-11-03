/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

const store = vi.hoisted(() => ({
  session: new Map<string, unknown>(),
  failReads: false,
  failWrites: false,
  status: "pending" as "pending" | "verified" | "unknown",
}));

vi.mock("@/infrastructure/storage/adapters", () => ({
  createStorageSuite: () => ({
    session: {
      get: async (key: string) => {
        if (store.failReads) throw new Error("storage unavailable");
        return store.session.get(key);
      },
      set: async (key: string, value: unknown) => {
        if (store.failWrites) throw new Error("storage unavailable");
        store.session.set(key, value);
      },
    },
  }),
}));

vi.mock("@/ui/features/backup/hooks/useKeyBackupStatus", () => ({
  useKeyBackupStatus: () => store.status,
}));

import {
  dismissBackupBanner,
  isBackupBannerVisible,
  readBackupBannerDismissed,
} from "@/ui/features/backup/backup-banner";
import { useBackupBanner } from "@/ui/features/backup/hooks/useBackupBanner";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

beforeEach(() => {
  store.session.clear();
  store.failReads = false;
  store.failWrites = false;
  store.status = "pending";
});

describe("isBackupBannerVisible", () => {
  it.each([
    ["pending", false, true],
    ["pending", true, false],
    ["verified", false, false],
    ["verified", true, false],
    ["unknown", false, false],
    ["unknown", true, false],
  ] as const)("status %s, dismissed %s -> %s", (status, dismissed, expected) => {
    expect(isBackupBannerVisible(status, dismissed)).toBe(expected);
  });
});

describe("banner dismissal storage", () => {
  it("is kept per key", async () => {
    await dismissBackupBanner("key-a");

    expect(await readBackupBannerDismissed("key-a")).toBe(true);
    expect(await readBackupBannerDismissed("key-b")).toBe(false);
  });

  it("reads as not dismissed when the session store cannot be read", async () => {
    store.session.set("backupBannerDismissed:key-a", true);
    store.failReads = true;

    expect(await readBackupBannerDismissed("key-a")).toBe(false);
  });

  it("does not throw when the dismissal cannot be written", async () => {
    store.failWrites = true;

    await expect(dismissBackupBanner("key-a")).resolves.toBeUndefined();
  });
});

describe("useBackupBanner", () => {
  let latest: ReturnType<typeof useBackupBanner>;
  let rerender: (keyId: string | undefined) => Promise<void>;
  let unmount: () => void;

  function Probe({ keyId }: { keyId: string | undefined }) {
    latest = useBackupBanner(keyId);
    return null;
  }

  async function mount(keyId: string | undefined) {
    const root = createRoot(document.createElement("div"));
    rerender = (next) => act(async () => root.render(<Probe keyId={next} />));
    unmount = () => act(() => root.unmount());
    await rerender(keyId);
  }

  afterEach(() => unmount?.());

  it("is hidden for a key that was dismissed earlier, with no flash on mount", async () => {
    store.session.set("backupBannerDismissed:key-a", true);
    const seen: boolean[] = [];
    function Spy() {
      const banner = useBackupBanner("key-a");
      seen.push(banner.visible);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Spy />));

    expect(seen.every((visible) => !visible)).toBe(true);
    act(() => root.unmount());
  });

  it("shows for a pending key and hides on dismiss without hiding another key", async () => {
    await mount("key-a");
    expect(latest.visible).toBe(true);

    await act(async () => latest.dismiss());
    expect(latest.visible).toBe(false);
    expect(store.session.get("backupBannerDismissed:key-a")).toBe(true);

    await rerender("key-b");
    expect(latest.visible).toBe(true);
  });

  it("goes as soon as the status becomes verified", async () => {
    await mount("key-a");
    expect(latest.visible).toBe(true);

    store.status = "verified";
    await rerender("key-a");

    expect(latest.visible).toBe(false);
  });

  it("is hidden when no key is selected", async () => {
    await mount(undefined);

    expect(latest.visible).toBe(false);
  });
});

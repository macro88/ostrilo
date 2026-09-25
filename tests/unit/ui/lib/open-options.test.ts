import { beforeEach, describe, expect, it, vi } from "vitest";

const ext = vi.hoisted(() => ({
  opened: [] as string[],
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: { getURL: (path: string) => `chrome-extension://ostrilo${path}` },
    tabs: {
      create: async ({ url }: { url: string }) => {
        ext.opened.push(url);
      },
    },
  },
}));

const { openOptionsTab } = await import("@/ui/lib/open-options");

describe("openOptionsTab", () => {
  beforeEach(() => {
    ext.opened.length = 0;
  });

  it("deep-links to the named settings tab through the hash", () => {
    openOptionsTab("relays");

    expect(ext.opened).toEqual(["chrome-extension://ostrilo/options.html#relays"]);
  });

  it("opens the settings page on its default tab when none is named", () => {
    openOptionsTab();

    expect(ext.opened).toEqual(["chrome-extension://ostrilo/options.html"]);
  });
});

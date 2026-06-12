import path from "path";
import fs from "node:fs";
import {
  test as base,
  chromium,
  expect as baseExpect,
} from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

type ExtensionFixtures = {
  extensionContext: BrowserContext;
  extensionId: string;
  openPopup: () => Promise<Page>;
  openSidepanel: () => Promise<Page>;
  openOptions: () => Promise<Page>;
};

// Helper to resolve the built extension path (WXT output)
const extensionPath = path.resolve(process.cwd(), ".output", "chrome-mv3");
const isHeaded = process.env.OSTRILO_E2E_HEADED === "1";

export const test = base.extend<ExtensionFixtures>({
  // Launch a persistent Chromium context with the extension loaded
  extensionContext: async ({ browserName }, use, testInfo) => {
    if (browserName !== "chromium") {
      // Provide a dummy context to keep types happy; tests should guard by browser
      // but we won't create non-chromium extension contexts.
      // @ts-expect-error non-chromium skip
      await use(undefined);
      return;
    }

    const userDataDir = path.join(testInfo.outputDir, "chromium-user-data");

    if (!fs.existsSync(extensionPath)) {
      throw new Error(
        `Built extension not found at ${extensionPath}. Run pnpm run build before Playwright, or use pnpm run test:e2e.`
      );
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: !isHeaded,
      viewport: { width: 390, height: 700 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    try {
      await use(context);
    } finally {
      await context.close();
    }
  },

  // Derive the extension ID from the MV3 service worker URL
  extensionId: async ({ extensionContext, browserName }, use) => {
    if (browserName !== "chromium") {
      // @ts-expect-error non-chromium skip
      await use(undefined);
      return;
    }

    // Wait for the background service worker to be ready
    let worker = extensionContext.serviceWorkers()[0];
    if (!worker) {
      worker = await extensionContext.waitForEvent("serviceworker");
    }
    const url = worker.url();
    const match = url.match(/^chrome-extension:\/\/([a-p]{32})\//);
    if (!match)
      throw new Error(`Could not extract extension ID from URL: ${url}`);
    const id = match[1];
    await use(id);
  },

  openPopup: async ({ extensionContext, extensionId, browserName }, use) => {
    if (browserName !== "chromium") {
      // @ts-expect-error non-chromium skip
      await use(undefined);
      return;
    }
    const open = async () => {
      const page = await extensionContext.newPage();
      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      return page;
    };
    await use(open);
  },

  openSidepanel: async (
    { extensionContext, extensionId, browserName },
    use
  ) => {
    if (browserName !== "chromium") {
      // @ts-expect-error non-chromium skip
      await use(undefined);
      return;
    }
    const open = async () => {
      const page = await extensionContext.newPage();
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      return page;
    };
    await use(open);
  },

  openOptions: async ({ extensionContext, extensionId, browserName }, use) => {
    if (browserName !== "chromium") {
      // @ts-expect-error non-chromium skip
      await use(undefined);
      return;
    }
    const open = async () => {
      const page = await extensionContext.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      return page;
    };
    await use(open);
  },
});

export const expect = baseExpect;
export type { Page };

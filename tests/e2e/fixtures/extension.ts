import path from "path";
import {
  test as base,
  chromium,
  expect as baseExpect,
  BrowserContext,
  Page,
} from "@playwright/test";

type ExtensionFixtures = {
  extensionContext: BrowserContext;
  extensionId: string;
  openPopup: () => Promise<Page>;
  openSidepanel: () => Promise<Page>;
};

// Helper to resolve the built extension path (WXT output)
const extensionPath = path.resolve(process.cwd(), ".output", "chrome-mv3");

export const test = base.extend<ExtensionFixtures>({
  // Launch a persistent Chromium context with the extension loaded
  extensionContext: async ({ browserName }, use, workerInfo) => {
    if (browserName !== "chromium") {
      // Provide a dummy context to keep types happy; tests should guard by browser
      // but we won't create non-chromium extension contexts.
      // @ts-expect-error non-chromium skip
      await use(undefined);
      return;
    }

    const userDataDir = path.join(
      workerInfo.project.outputDir,
      "chromium-user-data"
    );
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // Extensions are not supported in headless mode
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
});

export const expect = baseExpect;

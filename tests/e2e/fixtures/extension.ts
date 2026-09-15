import path from "path";
import fs from "node:fs";
import {
  test as base,
  chromium,
  expect as baseExpect,
} from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { attachDiagnostics } from "./diagnostics";

type ExtensionFixtures = {
  extensionContext: BrowserContext;
  extensionId: string;
  openPopup: () => Promise<Page>;
  openSidepanel: () => Promise<Page>;
  openOptions: () => Promise<Page>;
};

// WXT maps {production: "", development: "-dev"} and otherwise `-${mode}` onto
// the output directory. `agent` therefore lands in .output/chrome-mv3-agent,
// which `pnpm dev` can never write to — unlike `-dev`, which it shares.
const buildMode = process.env.OSTRILO_E2E_BUILD_MODE ?? "production";
const outputSuffix = buildMode === "production" ? "" : `-${buildMode}`;
const extensionPath = path.resolve(
  process.cwd(),
  ".output",
  `chrome-mv3${outputSuffix}`
);
const isHeaded = process.env.OSTRILO_E2E_HEADED === "1";

/**
 * `error-context.md` snapshots `context.pages()[0]`. A persistent context opens
 * that page at about:blank and every fixture below used to call `newPage()`, so
 * the snapshot was always empty. Hand the blank page to the first caller.
 */
async function openExtensionPage(
  context: BrowserContext,
  url: string
): Promise<Page> {
  const blank = context.pages().find((p) => p.url() === "about:blank");
  const page = blank ?? (await context.newPage());
  await page.goto(url);
  return page;
}

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

    // A `wxt dev` artifact has no `content_scripts` key: WXT registers the
    // script at runtime over a websocket this repo's connect-src blocks, so
    // window.nostr is never injected. It otherwise looks exactly like a build,
    // and the resulting failure reads as a bug in the code under test.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8")
    );
    if (manifest.content_scripts?.length !== 1) {
      throw new Error(
        `Extension at ${extensionPath} declares ${
          manifest.content_scripts?.length ?? 0
        } content_scripts, expected 1. This is a 'wxt dev' artifact, not a ` +
          `build, so window.nostr will never be injected. Run: pnpm run agent:build`
      );
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: !isHeaded,
      viewport: { width: 390, height: 700 },
      // The fixture server uses a throwaway self-signed certificate for
      // localhost, because the content script matches https:// only. This
      // browser instance is a test artifact and trusts nothing else.
      ignoreHTTPSErrors: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--ignore-certificate-errors",
      ],
    });

    const flush = attachDiagnostics(context, testInfo, {
      extensionPath,
      mode: buildMode,
    });

    try {
      await use(context);
    } finally {
      await flush().catch(() => {});
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
    const open = async () =>
      openExtensionPage(
        extensionContext,
        `chrome-extension://${extensionId}/popup.html`
      );
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
    const open = async () =>
      openExtensionPage(
        extensionContext,
        `chrome-extension://${extensionId}/sidepanel.html`
      );
    await use(open);
  },

  openOptions: async ({ extensionContext, extensionId, browserName }, use) => {
    if (browserName !== "chromium") {
      // @ts-expect-error non-chromium skip
      await use(undefined);
      return;
    }
    const open = async () =>
      openExtensionPage(
        extensionContext,
        `chrome-extension://${extensionId}/options.html`
      );
    await use(open);
  },
});

export const expect = baseExpect;
export type { Page };

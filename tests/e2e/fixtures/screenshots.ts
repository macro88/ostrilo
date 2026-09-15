import fs from "node:fs/promises";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

const DEFAULT_SCREENSHOT_DIR = path.join(
  process.cwd(),
  "test-results",
  "e2e-screenshots"
);

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

/**
 * Absolute artifact directory for one test.
 *
 * `OSTRILO_E2E_SCREENSHOT_DIR` is resolved rather than used verbatim, because
 * `testInfo.attach({ path })` resolves a relative path against the worker's
 * cwd, which is not the repo root when a command is run from a subdirectory.
 */
export function artifactDir(testInfo: TestInfo): string {
  const root = process.env.OSTRILO_E2E_SCREENSHOT_DIR
    ? path.resolve(process.env.OSTRILO_E2E_SCREENSHOT_DIR)
    : DEFAULT_SCREENSHOT_DIR;
  return path.join(
    root,
    testInfo.project.name,
    slug(testInfo.titlePath.join(" "))
  );
}

/**
 * This tree sits outside Playwright's `outputDir`, so Playwright never cleans
 * it. Without this, a renamed or deleted step leaves its PNG behind forever,
 * and anything reading the directory to review the current UI silently sees a
 * screenshot of a flow that no longer exists.
 *
 * Purged once per test per run, on first write, so steps within a test still
 * accumulate normally.
 */
const purged = new Set<string>();

async function purgeOnce(dir: string): Promise<void> {
  if (purged.has(dir)) return;
  purged.add(dir);
  await fs.rm(dir, { recursive: true, force: true });
}

export async function captureStepScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string
): Promise<string> {
  const dir = artifactDir(testInfo);
  await purgeOnce(dir);
  const screenshotPath = path.join(dir, `${slug(name)}.png`);

  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: "image/png",
  });

  return screenshotPath;
}

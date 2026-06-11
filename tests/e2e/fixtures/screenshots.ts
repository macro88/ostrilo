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

export async function captureStepScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string
): Promise<string> {
  const root = process.env.OSTRILO_E2E_SCREENSHOT_DIR ?? DEFAULT_SCREENSHOT_DIR;
  const titleSlug = slug(testInfo.titlePath.join(" "));
  const screenshotPath = path.join(
    root,
    testInfo.project.name,
    titleSlug,
    `${slug(name)}.png`
  );

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
